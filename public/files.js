// Project page: pick several files, move them into folders (with the Move menu or by dragging
// onto a folder) and delete only the picked ones.
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
  let dragIds = null;
  root.addEventListener('dragstart', (e) => {
    const card = e.target.closest?.('.asset');
    if (!card) return;
    const box = card.querySelector('.pick input');
    dragIds = box.checked ? picked().map((b) => b.value) : [box.value];
    root.querySelectorAll('.asset').forEach((a) => dragIds.includes(a.dataset.id) && a.classList.add('dragging'));
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/x-contentflows-files', dragIds.join(','));
  });
  root.addEventListener('dragend', () => {
    dragIds = null;
    root.querySelectorAll('.dragging, .drop-on').forEach((x) => x.classList.remove('dragging', 'drop-on'));
  });
  const groupAt = (e) => (dragIds ? e.target.closest?.('.file-group') : null);
  root.addEventListener('dragover', (e) => {
    const g = groupAt(e);
    if (!g) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
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
    // Dropped back where they already are: nothing to do.
    if (ids.every((id) => root.querySelector(`.asset[data-id="${id}"]`)?.closest('.file-group') === g)) return;
    try {
      const r = await fetch(bar.action, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
        body: new URLSearchParams([['folder', folder], ...ids.map((id) => ['ids', id])]),
      });
      const j = await r.json();
      location.href = j.redirect || location.pathname + '#files';
      if (j.redirect && j.redirect.split('#')[0] === location.pathname + location.search) location.reload();
    } catch (err) { alert('Those files could not be moved. Check your connection and try again.'); }
  });

  // The note about the last move or delete is for this visit only; an upload's reload shouldn't repeat it.
  if (new URLSearchParams(location.search).has('notice')) history.replaceState(null, '', location.pathname + location.hash);
  sync();
})();
