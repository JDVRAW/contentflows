// Header + Explore menu, ported from the 1367 Studio Header script (GSAP timelines
// replaced by CSS transitions with the same durations, eases and stagger).
(() => {
  const header = document.getElementById('site-header');
  const panel = document.getElementById('menu-panel');
  if (!header || !panel) return;
  const btn = document.getElementById('menu-btn');
  const closeBtn = document.getElementById('menu-close');
  const iconMenu = btn.querySelector('.icon-menu');
  const iconClose = btn.querySelector('.icon-close');

  requestAnimationFrame(() => setTimeout(() => header.classList.add('is-visible'), 200));

  // Pick header text colour from whatever sits under it: an explicit data-header-theme,
  // else the first opaque background colour (dark background -> light text).
  const isDark = (c) => { const n = c.match(/\d+/g); if (!n || n.length < 3) return false; const [r, g, b] = n.map(Number); return r < 30 && g < 30 && b < 30; };
  function detectTheme() {
    if (header.classList.contains('is-scrolled')) return;
    const y = header.getBoundingClientRect().bottom + 4;
    for (const el of document.elementsFromPoint(innerWidth / 2, y)) {
      if (header.contains(el) || panel.contains(el) || el === document.body || el === document.documentElement) continue;
      const t = el.closest('[data-header-theme]')?.dataset.headerTheme;
      if (t) return header.setAttribute('data-theme', t);
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return header.setAttribute('data-theme', isDark(bg) ? 'light' : 'dark');
    }
    header.setAttribute('data-theme', isDark(getComputedStyle(document.body).backgroundColor) ? 'light' : 'dark');
  }
  function onScroll() { header.classList.toggle('is-scrolled', scrollY > 80); detectTheme(); }
  onScroll();
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', detectTheme);

  let open = false;
  let hideTimer = null;
  function setIcons(o) { iconMenu.classList.toggle('hidden', o); iconClose.classList.toggle('hidden', !o); btn.setAttribute('aria-expanded', String(o)); }
  function openMenu() {
    if (open) return; open = true;
    clearTimeout(hideTimer);
    panel.classList.add('is-open');
    panel.setAttribute('aria-hidden', 'false');
    header.classList.add('menu-open');
    setIcons(true);
  }
  function closeMenu() {
    if (!open) return; open = false;
    panel.classList.remove('is-open');
    header.classList.remove('menu-open');
    setIcons(false);
    hideTimer = setTimeout(() => panel.setAttribute('aria-hidden', 'true'), 500);
  }
  btn.addEventListener('click', () => (open ? closeMenu() : openMenu()));
  closeBtn.addEventListener('click', closeMenu);
  document.addEventListener('click', (e) => { if (open && !panel.contains(e.target) && !btn.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  panel.querySelectorAll('a').forEach((a) => a.addEventListener('click', closeMenu));
})();
