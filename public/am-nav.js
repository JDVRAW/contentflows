// Marketing header, adapted from Antimetal (via Details).
// - A 4px dot follows the hovered link: spring (stiffness 240, damping 23); the first reveal jumps
//   straight to place, and the dot scales in/out as the pointer enters/leaves the link group.
// - "Product" opens a two-column mega-menu; leaving schedules a close after 100ms so the pointer
//   can travel from the link into the panel. The panel's spring (400/22) lives in CSS as linear().
// - Header text colour follows what sits under it (data-header-theme or background colour).
(() => {
  const header = document.getElementById('am-header');
  if (!header) return;
  const links = document.getElementById('am-links');
  const dot = document.getElementById('am-dot');
  const product = document.getElementById('am-product');
  const drop = document.getElementById('am-drop');
  const burger = document.getElementById('am-burger');
  const mobile = document.getElementById('am-mobile');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Theme + scrolled state
  const isDark = (c) => { const n = c.match(/\d+/g); if (!n || n.length < 3) return false; const [r, g, b] = n.map(Number); return r < 40 && g < 40 && b < 40; };
  function detectTheme() {
    const y = header.querySelector('.am-bar').getBoundingClientRect().bottom + 2;
    for (const el of document.elementsFromPoint(innerWidth / 2, y)) {
      if (header.contains(el) || el === document.body || el === document.documentElement) continue;
      const t = el.closest('[data-header-theme]')?.dataset.headerTheme;
      if (t) return header.setAttribute('data-theme', t);
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return header.setAttribute('data-theme', isDark(bg) ? 'light' : 'dark');
    }
  }
  let ticking = false;
  const onScroll = () => {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => { ticking = false; header.classList.toggle('is-scrolled', scrollY > 12); detectTheme(); });
  };
  onScroll();
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);

  // Sliding dot
  const K = 240, C = 23;
  let dx = 0, target = 0, v = 0, raf = 0, shown = false, last = 0;
  const step = (t) => {
    const dt = Math.min(0.032, (t - (last || t)) / 1000); last = t;
    v += (K * (target - dx) - C * v) * dt; dx += v * dt;
    dot.style.setProperty('--x', dx.toFixed(2) + 'px');
    if (Math.abs(target - dx) + Math.abs(v) > 0.05) raf = requestAnimationFrame(step); else { raf = 0; last = 0; dx = target; dot.style.setProperty('--x', dx + 'px'); }
  };
  function moveDot(el) {
    target = el.offsetLeft + el.offsetWidth / 2 - dot.offsetWidth / 2;
    if (!shown || reduced) { dx = target; v = 0; dot.style.setProperty('--x', dx + 'px'); return; }
    if (!raf) raf = requestAnimationFrame(step);
  }
  links.querySelectorAll('.am-link').forEach((a) => a.addEventListener('mouseenter', () => { moveDot(a); if (a !== product) setOpen(false, true); }));
  links.querySelectorAll('a.am-link').forEach((a) => {
    a.addEventListener('focus', () => { dot.classList.add('on'); moveDot(a); });
    a.addEventListener('blur', () => { if (!links.matches(':hover')) dot.classList.remove('on'); });
  });
  links.addEventListener('mouseenter', () => { requestAnimationFrame(() => { shown = true; }); dot.classList.add('on'); });
  links.addEventListener('mouseleave', () => { shown = false; dot.classList.remove('on'); });

  // Mega-menu
  let open = false, closeT = 0;
  function setOpen(on, now) {
    if (!drop) return;
    clearTimeout(closeT);
    if (!on && !now) { closeT = setTimeout(() => setOpen(false, true), 100); return; }
    if (open === on) return;
    open = on;
    drop.classList.toggle('open', on);
    product.setAttribute('aria-expanded', String(on));
    header.classList.toggle('drop-open', on);
  }
  if (product && drop) {
    product.addEventListener('mouseenter', () => setOpen(true));
    product.addEventListener('mouseleave', () => setOpen(false));
    drop.addEventListener('mouseenter', () => { clearTimeout(closeT); moveDot(product); });
    drop.addEventListener('mouseleave', () => setOpen(false));
    product.addEventListener('click', () => setOpen(!open, true));
    drop.addEventListener('focusin', () => setOpen(true, true));
    drop.addEventListener('focusout', (e) => { if (!drop.contains(e.relatedTarget) && e.relatedTarget !== product) setOpen(false, true); });
    drop.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setOpen(false, true)));
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { setOpen(false, true); setMobile(false); } });
  document.addEventListener('click', (e) => { if (open && !links.contains(e.target)) setOpen(false, true); });

  // Mobile drawer
  let mOpen = false;
  function setMobile(on) {
    if (mOpen === on) return;
    mOpen = on;
    header.classList.toggle('m-open', on);
    mobile.setAttribute('aria-hidden', String(!on));
    burger.setAttribute('aria-expanded', String(on));
    burger.setAttribute('aria-label', on ? 'Close menu' : 'Open menu');
    document.documentElement.classList.toggle('am-lock', on);
  }
  burger.addEventListener('click', () => setMobile(!mOpen));
  mobile.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setMobile(false)));
  addEventListener('resize', () => { if (innerWidth > 900) setMobile(false); });
})();
