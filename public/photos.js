// Save to Photos on iPhone and iPad. A plain download there lands in the Files app, so on those
// devices the delivery page's download buttons for photos and films load the original file in the
// page and hand it to the share sheet instead, where "Save Image" / "Save Video" puts it in the
// photo library. The file is the original, byte for byte, fetched from the same download address
// as before, so each file still counts as a download (and starts the auto-delete countdown).
//
// The share sheet only opens straight after a tap, and loading a big original takes longer than
// that allows, so it is two taps: one to load, one on "Save to Photos" once the file is ready.
// Big sets are loaded and saved in batches that fit in the phone's memory. Anything that can't go
// this way (a file too big to hold in the page, a format the share sheet won't take, a failed load)
// falls back to the ordinary download, and a link under the button always offers that too.
//
// Android is left alone: its downloads already show in Google Photos and the gallery app, under
// the Download folder, and its share sheet has no dependable "save to gallery" target.
(() => {
  const items = window.CF_ITEMS || [];
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!ios || !items.length || !navigator.share || !navigator.canShare) return;

  const MB = 1e6;
  const MAX_FILE = 750 * MB;   // bigger than this, a film goes to Files (a phone browser can't hold it)
  const MAX_BATCH = 400 * MB;  // how much is loaded before each "Save to Photos" tap
  const MAX_COUNT = 20;        // and at most this many files per tap
  const fmt = (n) => n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? Math.round(n / 1e6) + ' MB' : Math.max(1, Math.ceil(n / 1e3)) + ' KB';
  const byId = new Map(items.map((it) => [String(it.id), it]));
  const idFrom = (href) => (String(href || '').match(/\/download\/(\d+)/) || [])[1];

  // Types the share sheet takes, for files saved without one.
  const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif', gif: 'image/gif', webp: 'image/webp',
    tif: 'image/tiff', tiff: 'image/tiff', dng: 'image/x-adobe-dng', mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime' };
  const typeOf = (it) => {
    const m = String(it.mime || '').toLowerCase();
    if (m && m !== 'application/octet-stream') return m;
    return TYPES[(it.name.split('.').pop() || '').toLowerCase()] || (it.kind === 'video' ? 'video/mp4' : 'image/jpeg');
  };
  const shareable = (it) => {
    try { return navigator.canShare({ files: [new File([], it.name, { type: typeOf(it) })] }); } catch (e) { return false; }
  };
  const fits = (it) => it.dl && it.size <= MAX_FILE && shareable(it);

  // ---- The sheet ----
  const sheet = document.createElement('div');
  sheet.className = 'sp-sheet';
  sheet.hidden = true;
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'Save to Photos');
  sheet.innerHTML = `<div class="sp-card">
    <div class="sp-top"><b class="sp-title">Save to Photos</b><button type="button" class="sp-close" aria-label="Close">Close</button></div>
    <p class="sp-what"></p>
    <div class="sp-bar" aria-hidden="true"><i></i></div>
    <p class="sp-status" aria-live="polite"></p>
    <button type="button" class="fs-cta sp-go" disabled>Save to Photos</button>
    <ul class="sp-rest"></ul>
    <a class="sp-alt"></a>
  </div>`;
  document.body.appendChild(sheet);
  const $ = (s) => sheet.querySelector(s);
  const what = $('.sp-what'), fill = $('.sp-bar i'), status = $('.sp-status'), go = $('.sp-go'), rest = $('.sp-rest'), alt = $('.sp-alt');

  let run = 0;          // bumps on every open and close, so an old load can tell it was dropped
  let ctrl = null;      // aborts the load in progress
  let ready = null;     // the files loaded for the next tap
  let queue = [], done = 0, total = 0;

  function close() {
    run++;
    if (ctrl) ctrl.abort();
    ctrl = null; ready = null; queue = [];
    sheet.hidden = true;
    document.documentElement.classList.remove('sp-lock');
  }
  $('.sp-close').addEventListener('click', close);
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
  document.addEventListener('keydown', (e) => { if (!sheet.hidden && e.key === 'Escape') close(); });

  // Next batch: as many files as fit in MAX_BATCH (always at least one), at most MAX_COUNT.
  function nextBatch() {
    const batch = [];
    let bytes = 0;
    while (queue.length && batch.length < MAX_COUNT && (!batch.length || bytes + queue[0].size <= MAX_BATCH)) {
      bytes += queue[0].size;
      batch.push(queue.shift());
    }
    return batch;
  }

  async function load(it, onBytes, signal) {
    const r = await fetch(it.dl, { signal, credentials: 'same-origin' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const chunks = [];
    if (r.body && r.body.getReader) {
      const reader = r.body.getReader();
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        chunks.push(value);
        onBytes(value.length);
      }
    } else {
      const b = await r.blob();
      chunks.push(b);
      onBytes(b.size);
    }
    return new File(chunks, it.name, { type: typeOf(it) });
  }

  async function prepare() {
    const me = run;
    const batch = nextBatch();
    if (!batch.length) {
      status.textContent = total === 1 ? 'Saved.' : `All ${total} saved.`;
      fill.style.transform = 'scaleX(1)';
      go.textContent = 'Done';
      go.disabled = false;
      go.onclick = close;
      return;
    }
    const bytes = batch.reduce((s, it) => s + it.size, 0);
    let got = 0;
    go.disabled = true;
    go.textContent = 'Save to Photos';
    go.onclick = null;
    const label = batch.length === 1 ? batch[0].name : `${done + 1}–${done + batch.length} of ${total}`;
    const tick = () => {
      fill.style.transform = `scaleX(${Math.min(1, got / bytes)})`;
      status.textContent = `Loading ${label} · ${fmt(got)} of ${fmt(bytes)}`;
    };
    fill.style.transform = 'scaleX(0)';
    tick();
    ctrl = new AbortController();
    const files = [];
    try {
      for (const it of batch) files.push(await load(it, (n) => { got += n; tick(); }, ctrl.signal));
    } catch (e) {
      if (me !== run) return;
      console.error('save to photos', e);
      // Loading in the page didn't work (a dropped connection, or the storage not letting the page
      // read the file): the ordinary download still does.
      status.textContent = `${batch.length === 1 ? 'This file' : 'These files'} couldn’t be loaded here. Try again, or use “Save to Files” below.`;
      go.textContent = 'Try again';
      go.disabled = false;
      go.onclick = () => { queue = batch.concat(queue); prepare(); };
      return;
    }
    if (me !== run) return;
    ctrl = null;
    ready = { files, batch };
    fill.style.transform = 'scaleX(1)';
    const photos = batch.filter((it) => it.kind !== 'video').length, films = batch.length - photos;
    const noun = [photos && `${photos} photo${photos === 1 ? '' : 's'}`, films && `${films} film${films === 1 ? '' : 's'}`].filter(Boolean).join(' and ');
    const option = photos && films ? 'Save Items' : `Save ${films ? 'Video' : 'Image'}${batch.length > 1 ? 's' : ''}`;
    status.textContent = `${noun[0].toUpperCase() + noun.slice(1)} ready. Tap below, then “${option}”.`;
    go.textContent = batch.length === 1 ? 'Save to Photos' : `Save ${batch.length} to Photos`;
    go.disabled = false;
    go.onclick = save;
  }

  // Runs straight from the tap, so the share sheet is allowed to open.
  async function save() {
    if (!ready) return;
    const me = run, { files, batch } = ready;
    go.disabled = true;
    try {
      await navigator.share({ files });
    } catch (e) {
      if (me !== run) return;
      go.disabled = false;
      // Closing the share sheet without saving: keep the files ready for another try.
      if (e && e.name === 'AbortError') { status.textContent = 'Not saved yet. Tap to open the share sheet again.'; return; }
      console.error('share', e);
      status.textContent = 'The share sheet didn’t open. Use “Save to Files” below instead.';
      return;
    }
    if (me !== run) return;
    ready = null;
    done += batch.length;
    prepare();
  }

  function start(list, zipHref, othersInZip) {
    run++;
    const ok = list.filter(fits), other = list.filter((it) => !fits(it));
    queue = ok.slice(); done = 0; total = ok.length; ready = null;
    const bytes = ok.reduce((s, it) => s + it.size, 0);
    what.textContent = total === 1 ? `${ok[0].name} · ${fmt(ok[0].size)}, original quality` : `${total} files · ${fmt(bytes)}, original quality`;
    // Files that can't go to Photos from the browser keep their ordinary download.
    rest.textContent = '';
    if (other.length) {
      const head = document.createElement('li');
      head.className = 'sp-rest-head';
      head.textContent = other.length === 1 ? 'This one goes to Files (too large or a format Photos can’t take from a browser):' : `These ${other.length} go to Files (too large or a format Photos can’t take from a browser):`;
      rest.appendChild(head);
      other.filter((it) => it.dl).forEach((it) => {
        const li = document.createElement('li');
        li.innerHTML = '<a></a>';
        li.firstChild.href = it.dl;
        li.firstChild.textContent = `${it.name} · ${fmt(it.size)}`;
        rest.appendChild(li);
      });
    }
    // Documents and audio aren't photos: they stay in the .zip.
    if (othersInZip) {
      const li = document.createElement('li');
      li.className = 'sp-rest-head';
      li.textContent = 'Documents and audio files aren’t photos, so they’re in the .zip below.';
      rest.appendChild(li);
    }
    alt.href = zipHref || (list.length === 1 && list[0].dl) || '#';
    alt.textContent = zipHref ? 'Save to Files instead (.zip)' : 'Save to Files instead';
    alt.hidden = !(zipHref || list.length === 1);
    sheet.hidden = false;
    document.documentElement.classList.add('sp-lock');
    go.hidden = !total;
    $('.sp-bar').hidden = !total;
    if (total) prepare();
    else status.textContent = '';
  }

  // ---- Which download buttons open the sheet ----
  // A photo or film's own download (gallery tile, viewer), the gallery's "Download selected",
  // a gallery folder's "Download folder", and "Download all" when it has photos or films.
  const base = location.pathname.replace(/\/+$/, '');
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a || a.closest('.sp-sheet') || e.defaultPrevented || e.metaKey || e.ctrlKey) return;
    let list = null, zip = null, others = false;
    if (a.matches('.dl-down, .lb-dl')) {
      const it = byId.get(idFrom(a.getAttribute('href')));
      if (it) list = [it];
    } else if (a.id === 'dl-seldl') {
      const ids = (new URL(a.href, location.href).searchParams.get('ids') || '').split(',');
      list = ids.map((id) => byId.get(id)).filter(Boolean);
      zip = a.href;
    } else if (a.matches('.dl-gallery .dl-folder-dl')) {
      const g = a.closest('.dl-group');
      // The folder's .zip has the folders inside it too.
      const inside = (f) => !!g && (f === g.dataset.folder || f.startsWith(g.dataset.folder + '/'));
      list = [...document.querySelectorAll('.dl-group')].filter((x) => inside(x.dataset.folder))
        .flatMap((x) => [...x.querySelectorAll('.dl-tile')]).map((t) => byId.get(t.dataset.id)).filter(Boolean);
      zip = a.href;
      others = [...document.querySelectorAll('.dl-fgroup')].some((f) => inside(f.dataset.folder));
    } else if (a.pathname === `${base}/zip` && !a.search) {
      list = items.filter((it) => it.dl);
      zip = a.href;
      others = !!document.querySelector('.dl-file');
    }
    if (!list || !list.length || !list.some(fits)) return;
    e.preventDefault();
    e.stopPropagation();
    start(list, zip, others);
  }, true);

  // Say where the files go: a phone's download buttons read "Save to Photos".
  document.querySelectorAll('.dl-down').forEach((a) => {
    const it = byId.get(idFrom(a.getAttribute('href')));
    if (it && fits(it)) a.setAttribute('aria-label', `Save ${it.name} to Photos`);
  });
  const lbDl = document.querySelector('.lb-dl');
  if (lbDl) new MutationObserver(() => {
    const it = byId.get(idFrom(lbDl.getAttribute('href')));
    const want = it && fits(it) ? `Save to Photos · ${fmt(it.size)}` : null;
    if (want && lbDl.textContent !== want) lbDl.textContent = want;
  }).observe(lbDl, { attributes: true, attributeFilter: ['href'], childList: true });
})();
