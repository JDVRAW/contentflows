// "Add from Vault" on a delivery page: browse the creator's Vault, tick files, and the server copies
// them into this delivery one by one. Progress is polled until every file is done.
(() => {
  const dlg = document.getElementById('vault-picker');
  const openBtn = document.querySelector('[data-vault-open]');
  if (!dlg || !openBtn) return;
  const pid = dlg.dataset.project;
  const list = dlg.querySelector('.vp-list');
  const crumbs = dlg.querySelector('.vp-path');
  const addBtn = dlg.querySelector('[data-vault-add]');
  const folderSel = dlg.querySelector('select[name="folder"]');
  const progress = dlg.querySelector('.vp-progress');
  const picked = new Map(); // vault file id -> { id, name, size }
  let added = 0, polling = null, current = null, sawBusy = false;

  const fmt = (n) => n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.ceil(n / 1e3)) + ' KB';
  const el = (tag, props = {}, kids = []) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const xhr = { 'X-Requested-With': 'XMLHttpRequest' };
  async function getJson(url, init) {
    let r, j = null;
    try { r = await fetch(url, { credentials: 'same-origin', ...init, headers: { ...xhr, ...(init && init.headers) } }); } catch (e) {
      throw new Error('Connection lost. Check your internet and try again.');
    }
    try { j = await r.json(); } catch (e) {}
    if (!r.ok || !j || !j.ok) throw Object.assign(new Error((j && j.error) || `Something went wrong (error ${r.status}).`), { connect: j && j.connect });
    return j;
  }

  function updateButton() {
    const n = picked.size;
    const size = [...picked.values()].reduce((s, f) => s + (f.size || 0), 0);
    addBtn.disabled = !n;
    addBtn.textContent = n ? `Add ${n} file${n === 1 ? '' : 's'} · ${fmt(size)}` : 'Add files';
  }

  async function show(folder) {
    current = folder;
    list.replaceChildren(el('p', { className: 'vp-empty', textContent: 'Opening your Vault…' }));
    let r;
    try { r = await getJson(`/vault/browse${folder ? `?folder=${encodeURIComponent(folder)}` : ''}`); } catch (e) {
      const kids = [document.createTextNode(e.message)];
      if (e.connect) kids.push(document.createTextNode(' '), el('a', { href: e.connect, textContent: 'Open Connect' }));
      list.replaceChildren(el('p', { className: 'vp-empty' }, kids));
      return;
    }
    const home = el('button', { type: 'button', textContent: 'My Vault', onclick: () => show(null) });
    const trail = [home];
    for (const f of r.path) trail.push(el('span', { textContent: '/' }), el('button', { type: 'button', textContent: f.name, onclick: () => show(f.id) }));
    const last = trail[trail.length - 1];
    trail[trail.length - 1] = el('span', { textContent: last.textContent });
    crumbs.replaceChildren(...trail);

    const rows = [];
    for (const f of r.folders) {
      rows.push(el('button', { type: 'button', className: 'vp-row', onclick: () => show(f.id) }, [
        el('span', { className: 'vp-thumb', textContent: 'Folder' }),
        el('span', { className: 'vp-name', textContent: f.name + (f.shared ? ' · shared with you' : '') }),
        el('span', { className: 'vp-size', textContent: '›' }),
      ]));
    }
    for (const f of r.files) {
      const box = el('input', { type: 'checkbox', checked: picked.has(f.id), tabIndex: -1 });
      box.setAttribute('aria-hidden', 'true');
      const thumb = f.thumbnail
        ? el('img', { className: 'vp-thumb', src: `/vault/thumb/${encodeURIComponent(f.id)}`, alt: '', loading: 'lazy' })
        : el('span', { className: 'vp-thumb', textContent: (f.name.split('.').pop() || '').slice(0, 4).toUpperCase() });
      const row = el('button', { type: 'button', className: 'vp-row' + (picked.has(f.id) ? ' picked' : '') }, [
        box, thumb, el('span', { className: 'vp-name', textContent: f.name }), el('span', { className: 'vp-size', textContent: fmt(f.sizeBytes || 0) }),
      ]);
      row.setAttribute('aria-pressed', String(picked.has(f.id)));
      row.addEventListener('click', () => {
        if (picked.has(f.id)) picked.delete(f.id); else picked.set(f.id, { id: f.id, name: f.name, size: f.sizeBytes || 0 });
        const on = picked.has(f.id);
        box.checked = on;
        row.classList.toggle('picked', on);
        row.setAttribute('aria-pressed', String(on));
        updateButton();
      });
      rows.push(row);
    }
    if (r.files.length > 1) {
      const all = el('button', { type: 'button', className: 'link small', textContent: 'Select all files here', onclick: () => {
        for (const f of r.files) picked.set(f.id, { id: f.id, name: f.name, size: f.sizeBytes || 0 });
        updateButton();
        show(folder);
      } });
      rows.unshift(el('p', { className: 'small', style: 'margin:4px 10px 8px' }, [all]));
    }
    list.replaceChildren(...(rows.length ? rows : [el('p', { className: 'vp-empty', textContent: 'This folder is empty.' })]));
  }

  const LABEL = { waiting: 'Waiting', copying: 'Copying…', done: 'Added', failed: 'Failed' };
  function render(job) {
    progress.hidden = !job.items.length;
    const kids = [];
    for (const i of job.items) {
      kids.push(el('div', { className: 'vp-item' }, [
        el('span', { className: 'vp-name', textContent: i.name }),
        el('span', { className: `st-${i.state}`, textContent: LABEL[i.state] || i.state }),
      ]));
      if (i.error) kids.push(el('p', { className: 'vp-err', textContent: i.error }));
    }
    progress.replaceChildren(...kids);
    added = job.items.filter((i) => i.state === 'done').length;
  }

  async function poll() {
    clearTimeout(polling);
    let job;
    try { job = await getJson(`/projects/${pid}/vault`); } catch (e) { polling = setTimeout(poll, 5000); return; }
    const busy = job.running || job.items.some((i) => i.state === 'waiting' || i.state === 'copying');
    // A batch that finished before this page opened is already on the page: don't show it again.
    if (!busy && !sawBusy) return;
    sawBusy = true;
    render(job);
    if (busy) { polling = setTimeout(poll, 2000); return; }
    polling = null;
    // Everything finished: show the new files on the page (unless something failed and needs reading).
    if (added && !job.items.some((i) => i.state === 'failed')) location.reload();
  }

  addBtn.addEventListener('click', async () => {
    const files = [...picked.values()];
    if (!files.length) return;
    addBtn.disabled = true;
    addBtn.textContent = 'Starting…';
    try {
      const job = await getJson(`/projects/${pid}/vault`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files, folder: folderSel ? folderSel.value : '' }),
      });
      picked.clear();
      updateButton();
      show(current);
      sawBusy = true;
      render(job);
      poll();
    } catch (e) {
      updateButton();
      progress.hidden = false;
      progress.replaceChildren(el('p', { className: 'vp-err', textContent: e.message }));
    }
  });

  dlg.querySelector('[data-vault-close]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => { if (added && !polling) location.reload(); });
  openBtn.addEventListener('click', () => {
    dlg.showModal();
    show(null);
    poll(); // picks up copies still running from before
  });
})();
