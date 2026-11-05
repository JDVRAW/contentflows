// Client delivery page: gallery filter, pick-and-download selection, hover previews for films,
// the full-screen viewer, and the small audio players in the files list.
(() => {
  const items = window.CF_ITEMS || [];
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const fmt = (n) => n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.ceil(n / 1e3)) + ' KB';
  const tiles = [...document.querySelectorAll('.dl-tile')];
  let open = () => {};

  // ---- Filter: All / Photos / Films, with a dot that slides under the active option ----
  const filter = document.querySelector('.dl-filter');
  let mode = 'all';
  const visible = () => tiles.filter((t) => mode === 'all' || t.dataset.kind === mode).map((t) => +t.dataset.index);

  // ---- Even rows: when the tiles don't fill the last row, the first one widens so every row is full ----
  const grid = document.querySelector('.dl-grid');
  function balance() {
    if (!grid) return;
    tiles.forEach((t) => { t.classList.remove('wide', 'wide-full'); t.style.gridColumn = ''; });
    const shown = tiles.filter((t) => !t.classList.contains('is-out'));
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    const r = shown.length % cols;
    if (!r || shown.length < 2) return;
    const span = cols - r + 1;
    shown[0].style.gridColumn = `span ${span}`;
    shown[0].classList.add(span === cols ? 'wide-full' : 'wide');
  }
  balance();
  let bt = 0;
  addEventListener('resize', () => { clearTimeout(bt); bt = setTimeout(balance, 100); });
  if (filter) {
    const dot = filter.querySelector('.dl-filter-dot');
    const place = (b) => { dot.style.setProperty('--x', `${b.offsetLeft}px`); dot.style.setProperty('--w', `${b.offsetWidth}px`); };
    const buttons = [...filter.querySelectorAll('button')];
    dot.style.transition = 'none'; place(buttons[0]);
    requestAnimationFrame(() => requestAnimationFrame(() => { dot.style.transition = ''; }));
    buttons.forEach((b) => b.addEventListener('click', () => {
      mode = b.dataset.f;
      buttons.forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
      place(b);
      tiles.forEach((t) => t.classList.toggle('is-out', mode !== 'all' && t.dataset.kind !== mode));
      balance();
    }));
    addEventListener('resize', () => place(filter.querySelector('button.on')));
  }

  // ---- Link pill: copies the delivery link so the client can pass it to their team ----
  const link = document.querySelector('.dl-link');
  if (link && !link.hasAttribute('data-preview')) {
    const tip = link.querySelector('.dl-link-tip');
    let t = 0;
    link.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(location.origin + location.pathname); }
      catch (e) { const r = document.createRange(); r.selectNodeContents(link.querySelector('.dl-link-text')); getSelection().removeAllRanges(); getSelection().addRange(r); return; }
      link.classList.add('copied'); tip.textContent = 'Copied';
      clearTimeout(t); t = setTimeout(() => { link.classList.remove('copied'); tip.textContent = 'Copy'; }, 1800);
    });
  }

  // ---- Selection ----
  const bar = document.getElementById('dl-selbar');
  const picked = new Set();
  function syncBar() {
    if (!bar) return;
    const n = picked.size;
    const bytes = tiles.filter((t) => picked.has(t.dataset.id)).reduce((s, t) => s + +t.dataset.size, 0);
    document.getElementById('dl-selcount').textContent = `${n} selected · ${fmt(bytes)}`;
    const a = document.getElementById('dl-seldl');
    a.href = `${a.dataset.base}?ids=${[...picked].join(',')}`;
    bar.classList.toggle('on', n > 0);
    document.body.classList.toggle('is-picking', n > 0);
  }
  function toggle(t, on = !picked.has(t.dataset.id)) {
    on ? picked.add(t.dataset.id) : picked.delete(t.dataset.id);
    t.classList.toggle('is-picked', on);
    t.querySelector('.dl-check')?.setAttribute('aria-pressed', String(on));
    syncBar();
  }
  document.getElementById('dl-selclear')?.addEventListener('click', () => tiles.forEach((t) => toggle(t, false)));

  // ---- Tiles ----
  tiles.forEach((t) => {
    t.addEventListener('click', (e) => {
      if (e.target.closest('.dl-down')) return;
      if (e.target.closest('.dl-check') || document.body.classList.contains('is-picking')) { toggle(t); return; }
      open(+t.dataset.index);
    });
    t.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === t) open(+t.dataset.index); });
    // Films preview on hover (desktop): a muted loop over the poster.
    if (fine && t.dataset.kind === 'video') {
      let v;
      t.addEventListener('mouseenter', () => {
        const it = items[+t.dataset.index];
        v = Object.assign(document.createElement('video'), { src: it.src, muted: true, loop: true, playsInline: true, className: 'dl-preview' });
        v.addEventListener('playing', () => v && v.classList.add('on'), { once: true });
        t.querySelector('img, .dl-noimg').after(v);
        v.play().catch(() => {});
      });
      t.addEventListener('mouseleave', () => { if (v) { v.pause(); v.remove(); v = null; } });
    }
  });

  // ---- Viewer ----
  const lb = document.getElementById('lightbox');
  if (lb && items.length) {
    const stage = lb.querySelector('.lb-stage');
    const count = lb.querySelector('.lb-count');
    const name = lb.querySelector('.lb-name');
    const dl = lb.querySelector('.lb-dl');
    let list = [], pos = 0, lastFocus = null;
    const pad = (n) => String(n).padStart(2, '0');
    function show(p) {
      pos = (p + list.length) % list.length;
      const it = items[list[pos]];
      stage.textContent = '';
      let el;
      if (it.kind === 'video') {
        el = Object.assign(document.createElement('video'), { controls: true, autoplay: true, playsInline: true, preload: 'metadata' });
        if (it.poster) el.poster = it.poster;
      } else {
        el = Object.assign(document.createElement('img'), { alt: it.name, decoding: 'async' });
        const next = items[list[(pos + 1) % list.length]];
        if (next && next.kind !== 'video') new Image().src = next.src;
      }
      el.src = it.src;
      stage.appendChild(el);
      requestAnimationFrame(() => el.classList.add('in'));
      count.textContent = `${pad(pos + 1)} / ${pad(list.length)}`;
      name.textContent = it.name;
      dl.hidden = !it.dl;
      if (it.dl) { dl.href = it.dl; dl.textContent = `Download · ${fmt(it.size)}`; }
    }
    open = (i) => {
      list = visible();
      if (!list.includes(i)) list = items.map((_, k) => k);
      lastFocus = document.activeElement;
      lb.hidden = false;
      document.documentElement.classList.add('am-lock');
      show(list.indexOf(i));
      lb.focus();
    };
    function close() {
      lb.hidden = true; stage.textContent = '';
      document.documentElement.classList.remove('am-lock');
      lastFocus?.focus?.();
    }
    lb.querySelector('.lb-close').onclick = close;
    lb.querySelector('.lb-prev').onclick = () => show(pos - 1);
    lb.querySelector('.lb-next').onclick = () => show(pos + 1);
    lb.addEventListener('click', (e) => { if (e.target === lb || e.target === stage) close(); });
    document.addEventListener('keydown', (e) => {
      if (lb.hidden) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') show(pos - 1);
      if (e.key === 'ArrowRight') show(pos + 1);
    });
    let x0 = null;
    stage.addEventListener('touchstart', (e) => (x0 = e.touches[0].clientX), { passive: true });
    stage.addEventListener('touchend', (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 50) show(pos + (dx < 0 ? 1 : -1));
      x0 = null;
    });
  }

  // ---- Audio players ----
  const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  let playing = null;
  document.querySelectorAll('.dl-player').forEach((pl) => {
    const btn = pl.querySelector('.dl-pp');
    const bar = pl.querySelector('.dl-track');
    const fill = bar.querySelector('i');
    const time = pl.querySelector('.dl-time');
    let audio = null;
    const ensure = () => {
      if (audio) return audio;
      audio = new Audio(pl.dataset.src);
      audio.preload = 'metadata';
      audio.addEventListener('timeupdate', () => { fill.style.transform = `scaleX(${audio.currentTime / (audio.duration || 1)})`; time.textContent = clock(audio.currentTime); });
      audio.addEventListener('play', () => pl.classList.add('on'));
      audio.addEventListener('pause', () => pl.classList.remove('on'));
      audio.addEventListener('ended', () => { pl.classList.remove('on'); fill.style.transform = 'scaleX(0)'; });
      return audio;
    };
    btn.addEventListener('click', () => {
      const a = ensure();
      if (a.paused) { if (playing && playing !== a) playing.pause(); playing = a; a.play(); } else a.pause();
    });
    bar.addEventListener('click', (e) => {
      const a = ensure();
      const r = bar.getBoundingClientRect();
      const go = () => { a.currentTime = ((e.clientX - r.left) / r.width) * a.duration; };
      a.duration ? go() : a.addEventListener('loadedmetadata', go, { once: true });
    });
  });
})();
