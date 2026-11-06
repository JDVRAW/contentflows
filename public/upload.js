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
  const fail = (message, fatal) => Object.assign(new Error(message), { fatal });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Classic upload: the file goes to this server in one request.
  function sendForm(file, progress) {
    const fd = new FormData();
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
        reject(fail((body && body.error) || STATUS[xhr.status] || `Upload failed (error ${xhr.status}).`));
      };
      xhr.send(fd);
    });
  }

  // Direct upload: the file goes straight to cloud storage in parts; this server only signs the parts.
  async function api(step, body) {
    let r, j = null;
    try {
      r = await fetch(`/projects/${pid}/uploads/${step}`, {
        method: 'POST', credentials: 'same-origin', body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      });
    } catch (e) { throw fail(STATUS[0]); }
    try { j = await r.json(); } catch (e) {}
    if (!r.ok || !j || !j.ok) throw fail((j && j.error) || STATUS[r.status] || `Upload failed (error ${r.status}).`, r.status < 500);
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
            if (e.fatal || attempt >= 4) { stop = true; throw e; }
            delete batches[Math.floor((n - 1) / 20)]; // re-sign in case the link expired
            await sleep(1500 * 2 ** attempt);
          }
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(4, count) }, worker));
      saving();
      return await api('complete', { key, uploadId, name: file.name, type: file.type, parts });
    } catch (e) {
      stop = true;
      xhrs.forEach((x) => x.abort());
      api('abort', { key, uploadId }).catch(() => {});
      throw e;
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
    const job = direct ? sendDirect(file, onProgress, () => { size.textContent = 'Saving'; }) : sendForm(file, onProgress);
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
  // Count enter/leave so moving over the card inside the zone doesn't flicker the highlight.
  let depth = 0;
  const over = (on) => { drop.classList.toggle('over', on); drop.querySelector('[data-spiral]')?.cfSpiral?.setOver(on); };
  drop.addEventListener('dragenter', (e) => { e.preventDefault(); if (depth++ === 0) over(true); });
  drop.addEventListener('dragover', (e) => e.preventDefault());
  drop.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; over(false); } });
  drop.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; over(false); sendAll(e.dataTransfer.files); });
})();
