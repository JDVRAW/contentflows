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

  function send(file) {
    const row = document.createElement('div');
    row.className = 'q-row';
    row.innerHTML = `<span class="q-name"></span><span class="q-size muted small"></span><div class="bar"><i></i></div>`;
    row.querySelector('.q-name').textContent = file.name;
    row.querySelector('.q-size').textContent = fmt(file.size);
    queue.appendChild(row);
    const bar = row.querySelector('i');
    const fd = new FormData();
    fd.append('files', file);
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/projects/${pid}/upload`);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) bar.style.width = (e.loaded / e.total) * 100 + '%'; };
      xhr.onloadend = () => {
        const ok = xhr.status === 200;
        row.classList.add(ok ? 'done' : 'failed');
        if (!ok) row.querySelector('.q-size').textContent = 'Upload failed';
        resolve(ok);
      };
      xhr.send(fd);
    });
  }
  // Upload three at a time so big batches don't saturate the connection.
  async function sendAll(files) {
    const list = [...files];
    if (!list.length) return;
    const busy = document.getElementById('uploading');
    const label = document.getElementById('uploading-text');
    const total = list.length; let done = 0;
    const started = Date.now();
    const spiral = drop.querySelector('[data-spiral]')?.cfSpiral;
    if (spiral) list.slice(0, 40).forEach((f, i) => setTimeout(() => spiral.add(f), i * 140));
    const tick = () => { label.textContent = done < total ? `Uploading ${done + 1 > total ? total : done + 1} of ${total}` : 'Finishing up'; };
    if (busy) { busy.hidden = false; tick(); }
    const sendOne = async (f) => { await send(f); done++; if (busy) tick(); };
    const worker = async () => { while (list.length) await sendOne(list.shift()); };
    await Promise.all([worker(), worker(), worker()]);
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
