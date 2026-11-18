// Project page: pick several files, move them into folders (with the Move menu or by dragging
// onto a folder) and delete only the picked ones.
// Renaming a folder: the name turns into a small form in place.
(() => {
  const root = document.getElementById('files');
  if (!root) return;
  const show = (head, on) => {
    head.querySelector('.folder-rename').hidden = !on;
    head.querySelector('.fold-name').hidden = on;
    head.querySelector('[data-rename]').hidden = on;
    if (on) { const i = head.querySelector('.folder-rename input[name="name"]'); i.focus(); i.select(); }
  };
  root.addEventListener('click', (e) => {
    const open = e.target.closest('[data-rename]'), cancel = e.target.closest('[data-rename-cancel]');
    if (open || cancel) show((open || cancel).closest('.folder-head'), !!open);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && e.target.closest('.folder-rename')) { e.stopPropagation(); show(e.target.closest('.folder-head'), false); }
  });
})();

(() => {
  const bar = document.getElementById('bulk');
  const root = document.getElementById('files');
  if (!bar || !root) return;
  const boxes = () => [...root.querySelectorAll('.asset .pick input')];
  const picked = () => boxes().filter((b) => b.checked);
  const count = bar.querySelector('[data-count]');
  const select = bar.querySelector('select[name="folder"]');
  const newName = bar.querySelector('input[name="new_folder"]');
  const allBtn = root.querySelector('[data-select-all]');

  function sync() {
    const n = picked().length;
    boxes().forEach((b) => b.closest('.asset').classList.toggle('picked', b.checked));
    root.querySelectorAll('.file-group').forEach((g) => {
      const own = [...g.querySelectorAll('.asset .pick input')], on = own.filter((b) => b.checked).length;
      const gb = g.querySelector('.pick-group');
      if (gb) { gb.checked = own.length > 0 && on === own.length; gb.indeterminate = on > 0 && on < own.length; }
    });
    root.classList.toggle('picking', n > 0);
    bar.hidden = n === 0;
    count.textContent = `${n} selected`;
    if (allBtn) allBtn.textContent = n && n === boxes().length ? 'Select none' : 'Select all';
  }

  // Shift-click picks every file between the last one clicked and this one.
  let last = null;
  root.addEventListener('click', (e) => {
    const box = e.target.closest('.asset .pick input');
    if (box) {
      if (e.shiftKey && last && last !== box) {
        const all = boxes(), [a, b] = [all.indexOf(last), all.indexOf(box)].sort((x, y) => x - y);
        all.slice(a, b + 1).forEach((x) => (x.checked = box.checked));
      }
      last = box; return sync();
    }
    // While picking, a click anywhere on a file's picture toggles it.
    const thumb = e.target.closest('.asset .thumb');
    if (thumb && root.classList.contains('picking')) {
      const b = thumb.closest('.asset').querySelector('.pick input');
      b.checked = !b.checked; last = b; sync();
    }
  });
  root.addEventListener('change', (e) => {
    if (!e.target.matches('.pick-group')) return;
    e.target.closest('.file-group').querySelectorAll('.asset .pick input').forEach((b) => (b.checked = e.target.checked));
    sync();
  });
  allBtn?.addEventListener('click', () => {
    const on = !(picked().length === boxes().length);
    boxes().forEach((b) => (b.checked = on)); sync();
  });
  bar.querySelector('[data-clear]').addEventListener('click', () => { boxes().forEach((b) => (b.checked = false)); sync(); });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && picked().length && !e.target.closest('input, select, textarea')) { boxes().forEach((b) => (b.checked = false)); sync(); }
  });

  select.addEventListener('change', () => {
    const isNew = select.value === '__new';
    newName.hidden = !isNew; newName.required = isNew;
    if (isNew) newName.focus();
  });
  bar.addEventListener('submit', (e) => {
    if (e.submitter?.hasAttribute('data-delete')) {
      const n = picked().length;
      if (!confirm(`Delete ${n} file${n === 1 ? '' : 's'}? This can't be undone.`)) e.preventDefault();
    }
  });

  // Dragging: a file (or every picked file, when the dragged one is picked) onto a folder.
  // Inside a folder sorted by "Custom order", dragging a file among its own files reorders them instead.
  let dragIds = null, reorder = null, dropped = false;
  const post = (url, body) => fetch(url, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
    body: new URLSearchParams(body),
  });
  root.addEventListener('dragstart', (e) => {
    const card = e.target.closest?.('.asset');
    if (!card) return;
    const box = card.querySelector('.pick input');
    dragIds = box.checked ? picked().map((b) => b.value) : [box.value];
    root.querySelectorAll('.asset').forEach((a) => dragIds.includes(a.dataset.id) && a.classList.add('dragging'));
    const grid = card.closest('.asset-grid');
    const own = [...grid.querySelectorAll('.asset')];
    // Reordering needs every dragged file to come from this one custom-ordered folder.
    reorder = grid.hasAttribute('data-custom') && dragIds.every((id) => own.some((a) => a.dataset.id === id))
      ? { grid, before: own.map((a) => a.dataset.id) } : null;
    dropped = false;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/x-contentflows-files', dragIds.join(','));
  });
  root.addEventListener('dragend', () => {
    // Let go outside a folder: the files go back where they were.
    if (reorder && !dropped) reorder.before.forEach((id) => reorder.grid.append(reorder.grid.querySelector(`.asset[data-id="${id}"]`)));
    dragIds = null; reorder = null;
    root.querySelectorAll('.dragging, .drop-on').forEach((x) => x.classList.remove('dragging', 'drop-on'));
  });
  const groupAt = (e) => (dragIds ? e.target.closest?.('.file-group') : null);
  // While reordering, the dragged files slide in before or after the file under the pointer.
  function slide(e) {
    const over = e.target.closest?.('.asset');
    if (!over || over.classList.contains('dragging') || over.parentNode !== reorder.grid) return;
    const r = over.getBoundingClientRect();
    const after = e.clientY > r.bottom ? true : e.clientY < r.top ? false : e.clientX > r.left + r.width / 2;
    const moving = [...reorder.grid.querySelectorAll('.asset.dragging')];
    if (after) over.after(...moving); else over.before(...moving);
  }
  root.addEventListener('dragover', (e) => {
    const g = groupAt(e);
    if (!g) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    if (reorder && g.contains(reorder.grid)) { root.querySelectorAll('.drop-on').forEach((x) => x.classList.remove('drop-on')); return slide(e); }
    root.querySelectorAll('.drop-on').forEach((x) => x !== g && x.classList.remove('drop-on'));
    g.classList.add('drop-on');
  });
  root.addEventListener('dragleave', (e) => {
    const g = groupAt(e);
    if (g && !g.contains(e.relatedTarget)) g.classList.remove('drop-on');
  });
  root.addEventListener('drop', async (e) => {
    const g = groupAt(e);
    if (!g) return;
    e.preventDefault();
    const ids = dragIds, folder = g.dataset.folder;
    g.classList.remove('drop-on');
    if (reorder && g.contains(reorder.grid)) {
      dropped = true;
      const grid = reorder.grid, order = [...grid.querySelectorAll('.asset')].map((a) => a.dataset.id);
      if (order.join() === reorder.before.join()) return;
      syncNudges(grid);
      try {
        const r = await post(`${root.dataset.base}/assets/order`, [['folder', folder], ...order.map((id) => ['ids', id])]);
        if (!r.ok) throw new Error(r.status);
      } catch (err) { alert('The new order could not be saved. Check your connection and try again.'); location.reload(); }
      return;
    }
    // Dropped back where they already are: nothing to do.
    if (ids.every((id) => root.querySelector(`.asset[data-id="${id}"]`)?.closest('.file-group') === g)) return;
    try {
      const r = await post(bar.action, [['folder', folder], ...ids.map((id) => ['ids', id])]);
      const j = await r.json();
      location.href = j.redirect || location.pathname + '#files';
      if (j.redirect && j.redirect.split('#')[0] === location.pathname + location.search) location.reload();
    } catch (err) { alert('Those files could not be moved. Check your connection and try again.'); }
  });
  // After a drag, the first file can't move earlier and the last can't move later.
  function syncNudges(grid) {
    const cards = [...grid.querySelectorAll('.asset')];
    cards.forEach((c, i) => {
      const [up, down] = c.querySelectorAll('.nudge button');
      if (up) up.disabled = i === 0;
      if (down) down.disabled = i === cards.length - 1;
    });
  }

  // Changing a folder's Sort menu saves it and shows the new order.
  root.addEventListener('change', (e) => {
    if (e.target.matches('select[data-autosubmit]')) e.target.form.requestSubmit();
  });

  // Folding folders shut. Each change is saved, so the page opens the same way next time.
  const foldBtn = root.querySelector('[data-fold-all]');
  const groups = () => [...root.querySelectorAll('.file-group')].filter((g) => g.querySelector('.fold'));
  const syncFoldAll = () => { if (foldBtn) foldBtn.textContent = groups().every((g) => g.classList.contains('collapsed')) ? 'Open all' : 'Close all'; };
  function fold(g, shut) {
    if (g.classList.contains('collapsed') === shut) return;
    g.classList.toggle('collapsed', shut);
    const b = g.querySelector('.fold'), name = g.querySelector('.fold-name')?.textContent || 'folder';
    b.setAttribute('aria-expanded', String(!shut)); b.setAttribute('aria-label', `${shut ? 'Open' : 'Close'} ${name}`);
    fetch(`${root.dataset.base}/folders/collapse`, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
      body: new URLSearchParams({ folder: g.dataset.folder, collapsed: shut ? '1' : '0' }),
    }).catch(() => {});
  }
  root.addEventListener('click', (e) => {
    const t = e.target.closest('.fold, .fold-name');
    if (!t) return;
    const g = t.closest('.file-group');
    fold(g, !g.classList.contains('collapsed')); syncFoldAll();
  });
  foldBtn?.addEventListener('click', () => {
    const shut = !groups().every((g) => g.classList.contains('collapsed'));
    groups().forEach((g) => fold(g, shut)); syncFoldAll();
  });
  syncFoldAll();

  // The note about the last move or delete is for this visit only; an upload's reload shouldn't repeat it.
  if (new URLSearchParams(location.search).has('notice')) history.replaceState(null, '', location.pathname + location.hash);
  sync();
})();
