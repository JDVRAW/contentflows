// Cube spiral: rounded cubes travel along spiral arms into the centre of every [data-spiral] element.
// Each element gets el.cfSpiral = { setOver(bool), setHover(bool), add(file) }. On desktop the cursor pushes cubes aside. A file added with add() becomes a cube
// wearing its thumbnail that flies in to the centre, then the element fires a 'cf:land' event with the file.
(() => {
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // face, top, side, bottom
  const PALETTE = [
    ['#e6e1cb', '#f3efe2', '#cbc5ab', '#aea88f'],
    ['#e6e1cb', '#f3efe2', '#cbc5ab', '#aea88f'],
    ['#e6e1cb', '#f3efe2', '#cbc5ab', '#aea88f'],
    ['#2c2c31', '#3b3b42', '#212125', '#18181b'],
    ['#2c2c31', '#3b3b42', '#212125', '#18181b'],
    ['#E5402A', '#f0634e', '#c4321f', '#9e2616'],
  ];
  const RED = PALETTE[5];
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const ease = (x) => x * x * (3 - 2 * x);

  function cube(size, colors, img, label) {
    const c = document.createElement('div');
    c.className = 'cube' + (img ? ' has-img' : '');
    c.style.cssText = `--s:${size}px;--c0:${colors[0]};--c1:${colors[1]};--c2:${colors[2]};--c3:${colors[3]}` + (img ? `;--img:url("${img}")` : '');
    for (let k = 0; k < 6; k++) {
      const f = document.createElement('i');
      f.className = 'f f' + k;
      if (label && k < 2) f.textContent = label;
      c.appendChild(f);
    }
    return c;
  }

  function thumbOf(file) {
    return new Promise((done) => {
      const url = URL.createObjectURL(file);
      const finish = (src) => { URL.revokeObjectURL(url); done(src); };
      const draw = (source, w, h) => {
        try {
          const s = 160, k = s / Math.min(w, h), cv = document.createElement('canvas');
          cv.width = cv.height = s;
          cv.getContext('2d').drawImage(source, (s - w * k) / 2, (s - h * k) / 2, w * k, h * k);
          finish(cv.toDataURL('image/jpeg', 0.82));
        } catch (e) { finish(null); }
      };
      setTimeout(() => finish(null), 4000);
      if (/^image\//.test(file.type) && file.size < 60e6) {
        const im = new Image();
        im.onload = () => draw(im, im.naturalWidth, im.naturalHeight);
        im.onerror = () => finish(null);
        im.src = url;
      } else if (/^video\//.test(file.type)) {
        const v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.preload = 'auto';
        v.onloadeddata = () => { v.currentTime = Math.min(1, (v.duration || 0) / 3); };
        v.onseeked = () => draw(v, v.videoWidth, v.videoHeight);
        v.onerror = () => finish(null);
        v.src = url;
      } else finish(null);
    });
  }

  function mount(root) {
    const world = root.querySelector('.spiral-world') || root.appendChild(Object.assign(document.createElement('div'), { className: 'spiral-world' }));
    const arms = +root.dataset.arms || 3;
    const sizeK = +root.dataset.size || 1;
    let W = 0, H = 0, items = [], raf = 0, visible = true, last = 0;
    let rot = 0, boost = 1, boostTo = 1, tx = 0, ty = 0, px = 0, py = 0;
    let over = false, hover = false, pin = false, mx = 0, my = 0, P = 1100;
    const REACH = 180, PUSH = 120; // cursor pushes cubes within REACH px up to PUSH px away
    const setBoost = () => { boostTo = over ? 5 : hover ? 2.2 : 1; };

    const measure = () => { W = root.clientWidth; H = root.clientHeight; P = parseFloat(getComputedStyle(root).perspective) || 1100; };
    const scale = () => Math.max(0.55, Math.min(1, W / 1440)) * sizeK;

    // Cubes are spaced evenly along each arm so the arms read as continuous curves.
    function ambient(i, n) {
      const per = Math.ceil(n / arms), k = Math.floor(i / arms);
      const size = Math.round(rand(24, 46) * scale());
      const el = cube(size, PALETTE[(Math.random() * PALETTE.length) | 0]);
      world.appendChild(el);
      return { el, u: (k + rand(0.3, 0.7)) / per, arm: i % arms, jit: rand(-0.05, 0.05), spinA: rand(-60, 60), spinB: rand(25, 70), a: rand(0, 360), b: rand(0, 360), ox: 0, oy: 0, kick: 0 };
    }

    function build() {
      measure();
      world.textContent = '';
      const n = +root.dataset.count || (W < 768 ? 36 : 66);
      items = Array.from({ length: n }, (_, i) => ambient(i, n));
      items.forEach(place);
    }

    function place(it, dt = 0) {
      const u = it.u;
      const th = it.arm * (TAU / arms) + it.jit + 1.7 * Math.PI * u + rot;
      const r = Math.pow(1 - u, 1.15);
      const x = Math.cos(th) * r * W * 0.6;
      const y = Math.sin(th) * r * H * 0.62;
      const z = 240 - 940 * u;
      // Push away from the cursor, measured where the cube appears on screen.
      let gx = 0, gy = 0;
      if (pin && dt) {
        const k = P / (P - z), dx = x * k - mx, dy = y * k - my, d = Math.hypot(dx, dy);
        if (d < REACH && d > 0.01) {
          const f = (1 - d / REACH) ** 2;
          gx = (dx / d) * f * PUSH / k; gy = (dy / d) * f * PUSH / k;
          it.kick = Math.max(it.kick, f);
        }
      }
      if (dt) {
        const e = Math.min(1, dt * 7);
        it.ox += (gx - it.ox) * e; it.oy += (gy - it.oy) * e;
        it.kick = Math.max(0, it.kick - dt * 1.2);
        const spin = dt * (0.6 + 0.4 * boost) * (1 + 5 * it.kick);
        it.a += it.spinA * spin; it.b += it.spinB * spin;
      }
      const grow = ease(Math.max(0, Math.min(1, u / 0.07, (1 - u) / 0.14)));
      it.el.style.transform = `translate3d(${(x + it.ox).toFixed(1)}px,${(y + it.oy).toFixed(1)}px,${z.toFixed(1)}px) rotateX(${it.a.toFixed(1)}deg) rotateY(${it.b.toFixed(1)}deg) scale(${((1 - 0.4 * u) * grow).toFixed(3)})`;
    }

    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000 || 0);
      last = now;
      boost += (boostTo - boost) * Math.min(1, dt * 3);
      rot += dt * 0.11 * boost;
      tx += (px - tx) * Math.min(1, dt * 4);
      ty += (py - ty) * Math.min(1, dt * 4);
      world.style.transform = `rotateX(${(-ty * 7).toFixed(2)}deg) rotateY(${(tx * 9).toFixed(2)}deg)`;
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        it.u += dt * (it.file ? 0.42 : 0.032 * boost);
        if (it.u >= 1) {
          if (it.file) { it.el.remove(); items.splice(i, 1); root.dispatchEvent(new CustomEvent('cf:land', { detail: it.file })); continue; }
          it.u -= 1;
        }
        place(it, dt);
      }
      raf = requestAnimationFrame(frame);
    }

    const start = () => { if (!raf && visible && !REDUCED && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };

    build();
    start();
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? start() : stop(); }).observe(root);
    }
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
    let rw = W;
    addEventListener('resize', () => { measure(); if (Math.abs(W - rw) > 120) { rw = W; build(); } else items.forEach(place); });
    const host = root.closest('[data-spiral-host]') || root.parentElement;
    if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
      host.addEventListener('pointermove', (e) => {
        const b = root.getBoundingClientRect();
        px = (e.clientX - b.left) / b.width - 0.5; py = (e.clientY - b.top) / b.height - 0.5;
        mx = e.clientX - b.left - b.width / 2; my = e.clientY - b.top - b.height / 2; pin = true;
      });
      host.addEventListener('pointerleave', () => { px = py = 0; pin = false; });
    }

    return {
      setOver(on) { over = on; setBoost(); root.classList.toggle('is-over', on); },
      setHover(on) { hover = on; setBoost(); },
      async add(file) {
        const img = await thumbOf(file);
        const ext = (file.name.split('.').pop() || 'file').slice(0, 4).toUpperCase();
        if (REDUCED) { root.dispatchEvent(new CustomEvent('cf:land', { detail: file })); return; }
        const el = cube(Math.round(66 * scale()), img ? PALETTE[0] : RED, img, img ? '' : ext);
        world.appendChild(el);
        const it = { el, file, u: 0.04, arm: (Math.random() * arms) | 0, jit: rand(-0.3, 0.3), spinA: rand(-90, 90), spinB: rand(60, 120), a: rand(0, 360), b: rand(0, 360), ox: 0, oy: 0, kick: 0 };
        items.push(it);
        place(it);
        start();
      },
    };
  }

  document.querySelectorAll('[data-spiral]').forEach((el) => { el.cfSpiral = mount(el); });
})();
