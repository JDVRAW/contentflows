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

  // 2b. Dusk scene, after Fora's hero: each [data-speed] layer moves translateY = d × (1 − speed/100),
  //     d being how far the page has scrolled past the scene's top, so it rises slower than the page.
  //     The foreground ridge has no speed and so scrolls normally, covering the preview as it goes.
  const scene = document.querySelector('.scene');
  if (scene) {
    const layers = [...scene.querySelectorAll('[data-speed]')].map((el) => ({ el, k: 1 - Number(el.dataset.speed) / 100 }));
    if (!reduced) {
      scene.classList.add('scene-anim');
      const seen = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { scene.classList.add('in'); seen.disconnect(); } }), { threshold: 0.15 });
      seen.observe(scene);
      let queued = false;
      const update = () => {
        queued = false;
        const r = scene.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight) return;
        const d = Math.max(0, -r.top);
        layers.forEach(({ el, k }) => { el.style.transform = d ? `translate3d(0, ${(d * k).toFixed(1)}px, 0)` : ''; });
      };
      const queue = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
      addEventListener('scroll', queue, { passive: true });
      addEventListener('resize', queue);
      update();
    }
  }

  // 2c. Intro text, after Fora's "Intro" block: the statement is split into words that light up one by one
  //     as it travels from 85% to 35% of the viewport height, so reading pace follows scroll pace.
  const statements = [...document.querySelectorAll('[data-words]')];
  if (statements.length && !reduced) {
    const groups = statements.map((el) => {
      const words = [];
      const split = (node) => {
        [...node.childNodes].forEach((n) => {
          if (n.nodeType === 3) {
            const frag = document.createDocumentFragment();
            n.textContent.split(/(\s+)/).forEach((part) => {
              if (!part) return;
              if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
              const w = document.createElement('span');
              w.className = 'w'; w.textContent = part; words.push(w); frag.appendChild(w);
            });
            n.replaceWith(frag);
          } else if (n.nodeType === 1) split(n);
        });
      };
      split(el);
      el.classList.add('words-on');
      return { el, words };
    });
    let queued = false;
    const update = () => {
      queued = false;
      groups.forEach(({ el, words }) => {
        const r = el.getBoundingClientRect();
        const start = innerHeight * 0.85, end = innerHeight * 0.35;
        const p = Math.min(1, Math.max(0, (start - (r.top + r.height / 2)) / (start - end)));
        const lit = p * words.length;
        words.forEach((w, i) => { w.style.opacity = (0.16 + 0.84 * Math.min(1, Math.max(0, lit - i))).toFixed(3); });
      });
    };
    const queue = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
    addEventListener('scroll', queue, { passive: true });
    addEventListener('resize', queue);
    update();
  }

  // 2d. Depth on product previews outside the scene: same Fora rule, translateY = d × (1 − speed/100),
  //     with d measured from the viewport centre so each preview sits in place when it is centred.
  //     Uses the CSS translate property so it stacks with the reveal transform.
  const drift = [...document.querySelectorAll('[data-speed]')].filter((el) => !el.closest('.scene'));
  if (drift.length && !reduced) {
    const items = drift.map((el) => ({ el, k: 1 - Number(el.dataset.speed) / 100 }));
    let queued = false;
    const update = () => {
      queued = false;
      const narrow = innerWidth < 720;
      items.forEach(({ el, k }) => {
        const r = el.getBoundingClientRect();
        if (r.bottom < -200 || r.top > innerHeight + 200) return;
        const d = (r.top + r.height / 2) - innerHeight / 2;
        el.style.translate = `0 ${(d * k * (narrow ? 0.5 : 1)).toFixed(1)}px`;
      });
    };
    const queue = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
    addEventListener('scroll', queue, { passive: true });
    addEventListener('resize', queue);
    update();
  }

  // 2e. Why ContentFlows cards, after SOHub's services stack: the deck pins while each next card slides up
  //     from 120% below; every card it covers moves up 60px and shrinks by .05, so earlier cards peek out
  //     above in a pile. Scrubbed and reversible. Where the browser has scroll-driven animations the CSS
  //     keyframes (deck-a/b/c) run it on the compositor; otherwise this computes the same transforms.
  const track = document.querySelector('.pillar-track');
  if (track && !reduced) {
    const cards = [...track.querySelectorAll('.pillar')];
    const stages = cards.length - 1;
    track.classList.add('stack-on');
    track.style.setProperty('--stages', stages);
    cards.forEach((c) => c.classList.add('in'));
    if (stages === 2 && window.CSS && CSS.supports('animation-timeline: view()')) {
      track.classList.add('stack-css');
    } else {
      const clamp = (v) => Math.min(1, Math.max(0, v));
      const last = cards.map(() => '');
      let cardH = 0, trackH = 0, vh = innerHeight;
      const measure = () => { vh = innerHeight; cardH = cards[0].offsetHeight; trackH = track.offsetHeight; };
      let queued = false;
      const update = () => {
        queued = false;
        const top = track.getBoundingClientRect().top;
        if (top + trackH < -100 || top > vh * 1.2) return;
        const p = clamp(-top / Math.max(1, trackH - vh)) * stages;
        const t = cards.map((_, i) => (i === 0 ? 1 : clamp(p - (i - 1))));
        cards.forEach((c, i) => {
          let covered = 0;
          for (let k = i + 1; k < cards.length; k++) covered += t[k];
          const y = (i === 0 ? 0 : 1.2 * cardH * (1 - t[i])) - 60 * covered;
          const v = `translate3d(0,${y.toFixed(1)}px,0) scale(${(1 - 0.05 * covered).toFixed(4)})`;
          if (v !== last[i]) { c.style.transform = v; last[i] = v; }
        });
      };
      const queue = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
      addEventListener('scroll', queue, { passive: true });
      addEventListener('resize', () => { measure(); queue(); });
      addEventListener('load', () => { measure(); queue(); });
      measure();
      update();
    }
  }

  // 2f. Sections (01) to (05) stack like SOHub's cards: each sticks once its bottom reaches the viewport
  //     bottom (top = min(0, viewport − height)) and the next one slides over it. Pure CSS sticky while
  //     scrolling; JS only measures the sticky offsets on load and resize.
  const stack = document.querySelector('.sec-stack');
  if (stack && !reduced) {
    const secs = [...stack.children].filter((el) => el.tagName === 'SECTION');
    stack.classList.add('stack-on');
    const measure = () => secs.forEach((s) => { s.style.top = `${Math.min(0, innerHeight - s.offsetHeight)}px`; });
    addEventListener('resize', measure);
    addEventListener('load', measure);
    if ('ResizeObserver' in window) new ResizeObserver(measure).observe(stack);
    measure();
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
