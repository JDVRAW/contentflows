(() => {
  document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => {
    const el = document.querySelector(b.dataset.copy);
    navigator.clipboard?.writeText(el.value).then(() => { b.textContent = 'Copied'; setTimeout(() => (b.textContent = 'Copy'), 1500); })
      .catch(() => { el.select(); document.execCommand('copy'); });
  }));

  const drop = document.getElementById('drop');
  if (!drop) return;
  const input = document.getElementById('file-input');
  const queue = document.getElementById('queue');
  const pid = drop.dataset.project;
  const fmt = (n) => n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.ceil(n / 1e3) + ' KB';

  const direct = drop.dataset.direct === '1';
  const STATUS = {
    0: 'Connection lost before the upload finished. Check your internet and try again.',
    401: 'You were logged out. Log in again and retry.',
    413: 'This file is too large for the server.',
    502: 'The server stopped responding. Try again, or upload fewer files at once.',
    503: 'The server is restarting. Try again in a minute.',
    504: 'The server took too long to answer. Try again, or upload fewer files at once.',
  };
  // upgrade: set when the file doesn't fit in the creator's storage plan, so the row can link to the plans.
  const fail = (message, fatal, upgrade) => Object.assign(new Error(message), { fatal, upgrade });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // The folder each file came from ("BTS" or "BTS/Raw"), so the delivery keeps the uploader's folders.
  const folderOf = new WeakMap();

  // A dropped connection or a server that's busy or restarting is worth waiting out: these get
  // a few more tries, a little further apart each time, before the file is marked as failed.
  const TRANSIENT = new Set([0, 408, 429, 502, 503, 504]);
  async function retrying(job, tries = 5) {
    for (let attempt = 1; ; attempt++) {
      try { return await job(); } catch (e) {
        if (!e.transient || attempt >= tries) throw e;
        await sleep(2000 * 2 ** (attempt - 1)); // 2, 4, 8, 16 s
      }
    }
  }

  // Classic upload: the file goes to this server in one request.
  const sendForm = (file, progress) => retrying(() => sendFormOnce(file, progress), 3);
  function sendFormOnce(file, progress) {
    const fd = new FormData();
    if (folderOf.get(file)) fd.append('folder', folderOf.get(file)); // before the file, so the server has it when the file arrives
    fd.append('files', file);
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/projects/${pid}/upload`);
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      xhr.responseType = 'json';
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) progress(e.loaded / e.total); };
      xhr.onloadend = () => {
        const body = xhr.response;
        if (xhr.status === 200 && body && body.ok && body.files && body.files.length > 0) return resolve(body);
        reject(Object.assign(fail((body && body.error) || STATUS[xhr.status] || `Upload failed (error ${xhr.status}).`, false, body && body.upgrade),
          { transient: TRANSIENT.has(xhr.status) }));
      };
      xhr.send(fd);
    });
  }

  // Direct upload: the file goes straight to cloud storage in parts; this server only signs the parts.
  const api = (step, body) => retrying(() => apiOnce(step, body));
  async function apiOnce(step, body) {
    let r, j = null;
    try {
      r = await fetch(`/projects/${pid}/uploads/${step}`, {
        method: 'POST', credentials: 'same-origin', body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      });
    } catch (e) { throw Object.assign(fail(STATUS[0]), { transient: true }); }
    try { j = await r.json(); } catch (e) {}
    if (!r.ok || !j || !j.ok) {
      throw Object.assign(fail((j && j.error) || STATUS[r.status] || `Upload failed (error ${r.status}).`, r.status < 500, j && j.upgrade),
        { transient: TRANSIENT.has(r.status) });
    }
    return j;
  }

  function putPart(url, blob, onprogress, xhrs) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      xhrs.add(x);
      x.open('PUT', url);
      x.upload.onprogress = (e) => onprogress(e.loaded);
      x.onloadend = () => {
        xhrs.delete(x);
        if (x.status >= 200 && x.status < 300) {
          const etag = x.getResponseHeader('ETag');
          if (etag) return resolve(etag);
          return reject(fail('Cloud storage hid the upload receipt. Add "ExposeHeaders": ["ETag"] to the bucket’s CORS policy.', true));
        }
        reject(fail(x.status ? `Cloud storage refused part of the file (error ${x.status}).`
          : 'Couldn’t reach cloud storage. Check your internet. If it keeps failing, check the bucket’s CORS policy.'));
      };
      x.send(blob);
    });
  }

  async function sendDirect(file, progress, saving) {
    const { key, uploadId, partSize } = await api('start', { name: file.name, size: file.size, type: file.type });
    const count = Math.max(1, Math.ceil(file.size / partSize));
    const loaded = new Array(count + 1).fill(0);
    const report = () => progress(loaded.reduce((a, b) => a + b, 0) / Math.max(file.size, 1));
    // Part URLs are signed 20 at a time, when they're needed, so they don't expire on slow connections.
    const batches = {};
    const urlFor = (n) => {
      const b = Math.floor((n - 1) / 20);
      if (!batches[b]) {
        const nums = [];
        for (let i = b * 20 + 1; i <= Math.min(count, b * 20 + 20); i++) nums.push(i);
        batches[b] = api('sign', { key, uploadId, parts: nums }).then((j) => j.urls);
        batches[b].catch(() => delete batches[b]);
      }
      return batches[b].then((u) => u[n]);
    };
    const parts = [], xhrs = new Set();
    let next = 1, stop = false;
    const worker = async () => {
      while (next <= count && !stop) {
        const n = next++;
        const blob = file.slice((n - 1) * partSize, Math.min(file.size, n * partSize));
        for (let attempt = 1; ; attempt++) {
          try {
            const etag = await putPart(await urlFor(n), blob, (l) => { loaded[n] = l; report(); }, xhrs);
            loaded[n] = blob.size; report();
            parts.push({ PartNumber: n, ETag: etag });
            break;
          } catch (e) {
            loaded[n] = 0; report();
            if (stop) return;
            if (e.fatal || attempt >= 6) { stop = true; throw e; }
            delete batches[Math.floor((n - 1) / 20)]; // re-sign in case the link expired
            await sleep(1500 * 2 ** Math.min(attempt, 4));
          }
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(4, count) }, worker));
      saving();
      return await api('complete', { key, uploadId, name: file.name, type: file.type, folder: folderOf.get(file) || '', parts });
    } catch (e) {
      stop = true;
      xhrs.forEach((x) => x.abort());
      api('abort', { key, uploadId }).catch(() => {});
      throw e;
    }
  }

  // A folder dropped in a browser that can't open it, or a file that was moved or deleted after it was
  // picked, can't be read: catch that here instead of failing later as a network error.
  const readable = (file) => file.slice(0, 1).arrayBuffer().catch(() => {
    throw fail(`“${file.name}” can’t be read. If it’s a folder, open it and drop the files inside instead.`, true);
  });

  // Dropped folders arrive as File objects that can't be read, so open them and take the files inside,
  // remembering which folder each one was in.
  // Entries must be taken during the drop event, before the browser clears the drop data.
  async function dropped(dt) {
    const files = [...dt.files];
    const entries = [...(dt.items || [])].filter((i) => i.kind === 'file').map((i) => i.webkitGetAsEntry?.());
    if (!entries.length || entries.some((e) => !e)) return files;
    const list = (dir) => new Promise((resolve, reject) => {
      const reader = dir.createReader(), all = [];
      const more = () => reader.readEntries((batch) => (batch.length ? (all.push(...batch), more()) : resolve(all)), reject);
      more();
    });
    const out = [];
    const walk = async (e, folder) => {
      if (folder && e.name.startsWith('.')) return; // .DS_Store and other hidden files inside folders
      if (e.isFile) {
        const file = await new Promise((resolve, reject) => e.file(resolve, reject));
        if (folder) folderOf.set(file, folder);
        out.push(file);
      } else if (e.isDirectory) {
        for (const child of await list(e)) await walk(child, folder ? `${folder}/${e.name}` : e.name);
      }
    };
    try {
      for (const e of entries) await walk(e, '');
      return out;
    } catch (err) {
      return files;
    }
  }

  const progress = new Map();
  function send(file) {
    const row = document.createElement('div');
    row.className = 'q-row';
    row.innerHTML = `<span class="q-name"></span><span class="q-size muted small"></span><div class="bar"><i></i></div>`;
    row.querySelector('.q-name').textContent = file.name;
    const size = row.querySelector('.q-size');
    size.textContent = fmt(file.size);
    queue.appendChild(row);
    const bar = row.querySelector('i');
    const onProgress = (f) => { bar.style.width = Math.min(100, f * 100) + '%'; progress.set(file, f); };
    const job = readable(file).then(() => (direct ? sendDirect(file, onProgress, () => { size.textContent = 'Saving'; }) : sendForm(file, onProgress)));
    return job.then(() => {
      row.classList.add('done');
      size.textContent = fmt(file.size);
      progress.set(file, 1);
      return true;
    }, (e) => {
      row.classList.add('failed');
      size.textContent = 'Failed';
      const msg = document.createElement('p');
      msg.className = 'q-error';
      msg.textContent = e.message;
      if (e.upgrade) {
        const a = document.createElement('a');
        a.href = e.upgrade; a.textContent = 'See plans';
        msg.append(' ', a);
      }
      row.appendChild(msg);
      return false;
    });
  }

  // A warning if the page is closed while files are still uploading.
  const holdPage = (e) => { e.preventDefault(); e.returnValue = ''; };

  // Upload a few at a time so big batches don't saturate the connection.
  async function sendAll(files) {
    const list = [...files];
    if (!list.length) return;
    const busy = document.getElementById('uploading');
    const label = document.getElementById('uploading-text');
    const total = list.length; let done = 0;
    const bytes = list.reduce((a, f) => a + f.size, 0) || 1;
    const started = Date.now();
    const spiral = drop.querySelector('[data-spiral]')?.cfSpiral;
    if (spiral) list.slice(0, 40).forEach((f, i) => setTimeout(() => spiral.add(f), i * 140));
    const tick = () => {
      let sent = 0;
      progress.forEach((f, file) => { sent += f * file.size; });
      const pct = Math.min(99, Math.floor((sent / bytes) * 100));
      label.textContent = done < total ? `Uploading ${Math.min(done + 1, total)} of ${total} · ${pct}%` : 'Finishing up';
    };
    progress.clear();
    const timer = setInterval(() => busy && tick(), 500);
    if (busy) { busy.hidden = false; tick(); }
    window.addEventListener('beforeunload', holdPage);
    let failed = 0;
    const sendOne = async (f) => { if (!(await send(f))) failed++; done++; if (busy) tick(); };
    const worker = async () => { while (list.length) await sendOne(list.shift()); };
    await Promise.all(Array.from({ length: direct ? 2 : 3 }, worker));
    clearInterval(timer);
    window.removeEventListener('beforeunload', holdPage);
    if (failed) {
      // Keep the page as it is so the reason stays visible on each failed row.
      if (busy) busy.hidden = true;
      const note = document.createElement('p');
      note.className = 'q-summary';
      note.innerHTML = `<span></span> <a href="">Refresh the page</a> to see what was saved.`;
      note.querySelector('span').textContent = failed === total
        ? `None of the ${total} file${total === 1 ? '' : 's'} uploaded.`
        : `${total - failed} of ${total} files uploaded, ${failed} failed.`;
      queue.prepend(note);
      return;
    }
    // Let the file cubes finish flying in before the page refreshes with the new files.
    setTimeout(() => location.reload(), Math.max(600, (spiral ? 2900 + Math.min(total, 40) * 140 : 0) - (Date.now() - started)));
  }

  input.addEventListener('change', () => sendAll(input.files));
  // "Browse a folder": the browser gives each file its path inside the picked folder.
  const folderInput = document.getElementById('folder-input');
  folderInput?.addEventListener('change', () => {
    const files = [...folderInput.files].filter((f) => {
      const parts = (f.webkitRelativePath || '').split('/');
      if (parts.some((p) => p.startsWith('.'))) return false;
      if (parts.length > 1) folderOf.set(f, parts.slice(0, -1).join('/'));
      return true;
    });
    sendAll(files);
  });
  // Count enter/leave so moving over the card inside the zone doesn't flicker the highlight.
  let depth = 0;
  const over = (on) => { drop.classList.toggle('over', on); drop.querySelector('[data-spiral]')?.cfSpiral?.setOver(on); };
  drop.addEventListener('dragenter', (e) => { e.preventDefault(); if (depth++ === 0) over(true); });
  drop.addEventListener('dragover', (e) => e.preventDefault());
  drop.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; over(false); } });
  drop.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; over(false); dropped(e.dataTransfer).then(sendAll); });
})();
