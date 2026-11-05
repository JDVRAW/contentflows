// Landing page motion: section reveals, the cube spiral drop demo, the scroll-driven arch
// before the footer (adapted from the Hasan Wali site), and a small square that follows the pointer.
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 1. Fade-and-rise reveals. Content stays visible without JS or with reduced motion.
  if (!window.CF_NO_REVEAL && !reduced && 'IntersectionObserver' in window) {
    document.documentElement.classList.add('reveal-on');
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    document.querySelectorAll('.reveal').forEach((el, i) => { el.style.setProperty('--rd', `${(i % 4) * 70}ms`); io.observe(el); });
  }

  // 2. Arch: unfolds from edge-on (rotateX 90 -> 0) while sliding down (-H/2 -> 0)
  //    over the scroll range from "section top meets viewport bottom" to one section height later.
  const arch = document.querySelector('.arch');
  const layer = arch && arch.querySelector('.arch-layer');
  if (layer && !reduced) {
    let queued = false;
    const update = () => {
      queued = false;
      const h = arch.offsetHeight;
      const p = Math.min(1, Math.max(0, (innerHeight - arch.getBoundingClientRect().top) / h));
      layer.style.transform = p >= 1 ? 'none' : `translateY(${(-h / 2) * (1 - p)}px) rotateX(${90 * (1 - p)}deg)`;
    };
    const queue = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
    addEventListener('scroll', queue, { passive: true });
    addEventListener('resize', queue);
    update();
  }

  // 3. Pointer square: sprung follow (stiffness 600, damping 60, mass 1), difference-blended.
  if (!reduced && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    const sq = document.createElement('div');
    sq.className = 'cursor-sq';
    sq.setAttribute('aria-hidden', 'true');
    document.body.appendChild(sq);
    const K = 600, C = 60, M = 1, OFFSET = 16;
    let tx = 0, ty = 0, x = 0, y = 0, vx = 0, vy = 0, last = 0, running = false, seen = false;
    const step = (t) => {
      const dt = Math.min(0.032, (t - (last || t)) / 1000); last = t;
      vx += ((K * (tx - x) - C * vx) / M) * dt; x += vx * dt;
      vy += ((K * (ty - y) - C * vy) / M) * dt; y += vy * dt;
      sq.style.transform = `translate3d(${x + OFFSET}px, ${y + OFFSET}px, 0)`;
      if (Math.abs(tx - x) + Math.abs(ty - y) + Math.abs(vx) + Math.abs(vy) > 0.1) requestAnimationFrame(step);
      else { running = false; last = 0; }
    };
    addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      tx = e.clientX; ty = e.clientY;
      if (!seen) { x = tx; y = ty; seen = true; }
      sq.classList.add('on');
      if (!running) { running = true; requestAnimationFrame(step); }
    }, { passive: true });
    document.documentElement.addEventListener('mouseleave', () => sq.classList.remove('on'));
  }
  // 4. Drop demo: files dragged onto the spiral section fly in as cubes and are counted in the centre.
  //    Nothing is uploaded; the files only live in the page.
  const flow = document.getElementById('try');
  const sp = flow && flow.querySelector('[data-spiral]');
  if (flow && sp && sp.cfSpiral) {
    const input = document.getElementById('flow-input');
    const pick = document.getElementById('flow-pick');
    const title = document.getElementById('flow-title');
    const ready = document.getElementById('flow-ready');
    const count = document.getElementById('flow-count');
    let n = 0, bytes = 0, depth = 0;
    const idle = matchMedia('(hover: none)').matches ? 'Add your files' : 'Drop your files';
    title.textContent = idle;
    const fmt = (b) => b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.ceil(b / 1e3)) + ' KB';
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    const take = (fl) => [...fl].slice(0, 60).forEach((f, i) => setTimeout(() => sp.cfSpiral.add(f), i * 140));
    const over = (on) => { sp.cfSpiral.setOver(on); flow.classList.toggle('is-over', on); title.textContent = on ? 'Let go' : n ? `${n} ${n === 1 ? 'file' : 'files'}` : idle; };
    sp.addEventListener('cf:land', (e) => {
      n++; bytes += e.detail.size;
      title.textContent = `${n} ${n === 1 ? 'file' : 'files'}`;
      count.textContent = fmt(bytes);
      ready.hidden = false;
      flow.classList.remove('is-landed'); void flow.offsetWidth; flow.classList.add('is-landed');
    });
    pick.addEventListener('click', () => input.click());
    pick.addEventListener('pointerenter', () => sp.cfSpiral.setHover(true));
    pick.addEventListener('pointerleave', () => sp.cfSpiral.setHover(false));
    input.addEventListener('change', () => { take(input.files); input.value = ''; });
    flow.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); if (depth++ === 0) over(true); });
    flow.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    flow.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; over(false); } });
    flow.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; over(false); take(e.dataTransfer.files); });
    // A file dropped just outside the section should not replace the page.
    ['dragover', 'drop'].forEach((t) => addEventListener(t, (e) => { if (hasFiles(e)) e.preventDefault(); }));
  }
})();
