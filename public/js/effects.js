/* =========================================================
   CardGames — victory effects (a skin category).
   Played over the winner's seat when a round is won; everyone at
   the table sees them. Pure DOM + Web Animations, no images.
   Effects.play(kind, container, x, y, { scale }) — x / y in the
   container's own coordinates (the table stage).
   ========================================================= */
(function () {
  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function layerIn(container) {
    let l = container.querySelector(':scope > .fx-layer');
    if (!l) { l = document.createElement('div'); l.className = 'fx-layer'; container.appendChild(l); }
    return l;
  }
  function piece(layer, cls, x, y, css = {}) {
    const e = document.createElement('div');
    e.className = 'fx ' + cls;
    Object.assign(e.style, { left: x + 'px', top: y + 'px', ...css });
    layer.appendChild(e);
    return e;
  }
  const done = (e) => (a) => { a.onfinish = () => e.remove(); };

  // ---------- confetti cannon: pieces shoot up, then flutter down ----------
  function confetti(layer, x, y, s) {
    const colors = ['#F2C14E', '#FF5D8F', '#3FE6FF', '#7CFF8A', '#B36BFF', '#FFFFFF', '#FF8A3D'];
    for (let i = 0; i < 70; i++) {
      const w = rnd(6, 11) * s, h = rnd(10, 18) * s;
      const e = piece(layer, 'fx-conf', x, y, { width: w + 'px', height: h + 'px', background: pick(colors), borderRadius: Math.random() < 0.3 ? '50%' : '2px' });
      const ang = rnd(-150, -30) * Math.PI / 180, v = rnd(140, 300) * s;
      const ax = Math.cos(ang) * v, ay = Math.sin(ang) * v;
      const fall = rnd(160, 320) * s, drift = rnd(-60, 60) * s, rot = rnd(360, 1080);
      done(e)(e.animate([
        { transform: 'translate(-50%,-50%) rotate(0deg) rotateX(0deg)', opacity: 1 },
        { transform: `translate(calc(-50% + ${ax}px), calc(-50% + ${ay}px)) rotate(${rot / 3}deg) rotateX(180deg)`, opacity: 1, offset: 0.35 },
        { transform: `translate(calc(-50% + ${ax + drift}px), calc(-50% + ${ay + fall}px)) rotate(${rot}deg) rotateX(720deg)`, opacity: 0 },
      ], { duration: rnd(1600, 2400), delay: rnd(0, 120), easing: 'cubic-bezier(.15,.7,.4,1)', fill: 'both' }));
    }
  }

  // ---------- fireworks: three rockets, glowing sparks, a flash ----------
  function fireworks(layer, x, y, s) {
    const palettes = [['#FFD86B', '#FF8A3D'], ['#3FE6FF', '#B36BFF'], ['#FF5D8F', '#FFFFFF'], ['#7CFF8A', '#F2C14E']];
    [[-70, -150], [60, -190], [0, -110]].forEach(([dx, dy], b) => {
      const bx = x + dx * s, by = y + dy * s;
      const delay = b * 380;
      // the rocket
      const rk = piece(layer, 'fx-rocket', x + dx * s * 0.2, y, {});
      done(rk)(rk.animate([{ transform: 'translate(-50%,0)', opacity: 1 }, { transform: `translate(calc(-50% + ${bx - (x + dx * s * 0.2)}px), ${by - y}px)`, opacity: 1 }],
        { duration: 420, delay, easing: 'cubic-bezier(.2,.8,.4,1)', fill: 'both' }));
      const [c1, c2] = pick(palettes);
      const flash = piece(layer, 'fx-flash', bx, by, { width: 90 * s + 'px', height: 90 * s + 'px', background: `radial-gradient(circle, ${c1}, transparent 65%)` });
      done(flash)(flash.animate([{ transform: 'translate(-50%,-50%) scale(.2)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 0.9, offset: 0.2 }, { transform: 'translate(-50%,-50%) scale(1.6)', opacity: 0 }],
        { duration: 700, delay: delay + 420, fill: 'both' }));
      const n = 36;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rnd(-0.08, 0.08), r = rnd(70, 110) * s;
        const col = i % 2 ? c1 : c2;
        const e = piece(layer, 'fx-spark', bx, by, { background: col, boxShadow: `0 0 ${10 * s}px ${col}, 0 0 ${22 * s}px ${col}`, width: 8 * s + 'px', height: 8 * s + 'px' });
        done(e)(e.animate([
          { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
          { transform: `translate(calc(-50% + ${Math.cos(a) * r}px), calc(-50% + ${Math.sin(a) * r}px)) scale(.9)`, opacity: 1, offset: 0.6 },
          { transform: `translate(calc(-50% + ${Math.cos(a) * r * 1.15}px), calc(-50% + ${Math.sin(a) * r * 1.15 + 40 * s}px)) scale(.3)`, opacity: 0 },
        ], { duration: 1300, delay: delay + 420, easing: 'cubic-bezier(.1,.8,.3,1)', fill: 'both' }));
      }
    });
  }

  // ---------- gold rain: spinning coins falling around the seat ----------
  function goldrain(layer, x, y, s) {
    for (let i = 0; i < 34; i++) {
      const sx = x + rnd(-130, 130) * s, sy = y - rnd(180, 260) * s;
      const e = piece(layer, 'fx-coin', sx, sy, { width: 22 * s + 'px', height: 22 * s + 'px' });
      const ey = y + rnd(10, 70) * s;
      done(e)(e.animate([
        { transform: 'translate(-50%,-50%) scaleX(1)', opacity: 0 },
        { transform: 'translate(-50%,-50%) scaleX(.15)', opacity: 1, offset: 0.12 },
        { transform: `translate(-50%, calc(-50% + ${(ey - sy) * 0.6}px)) scaleX(1)`, opacity: 1, offset: 0.5 },
        { transform: `translate(-50%, calc(-50% + ${(ey - sy) * 0.9}px)) scaleX(.15)`, opacity: 1, offset: 0.8 },
        { transform: `translate(-50%, calc(-50% + ${ey - sy}px)) scaleX(1)`, opacity: 0 },
      ], { duration: rnd(1300, 1900), delay: rnd(0, 900), easing: 'cubic-bezier(.5,0,.8,1)', fill: 'both' }));
    }
    const glow = piece(layer, 'fx-flash', x, y, { width: 220 * s + 'px', height: 220 * s + 'px', background: 'radial-gradient(circle, rgba(255,216,107,.55), transparent 65%)' });
    done(glow)(glow.animate([{ opacity: 0, transform: 'translate(-50%,-50%) scale(.6)' }, { opacity: 1, offset: 0.3 }, { opacity: 0, transform: 'translate(-50%,-50%) scale(1.3)' }], { duration: 2200, fill: 'both' }));
  }

  // ---------- sakura vortex: petals spiral outwards ----------
  function sakura(layer, x, y, s) {
    for (let i = 0; i < 48; i++) {
      const e = piece(layer, 'fx-petal', x, y, { width: 14 * s + 'px', height: 10 * s + 'px' });
      const a0 = rnd(0, 360), turns = rnd(260, 540), r = rnd(80, 190) * s, dur = rnd(1800, 2600);
      const frames = [];
      for (let k = 0; k <= 8; k++) {
        const f = k / 8;
        const ang = (a0 + turns * f) * Math.PI / 180;
        frames.push({ transform: `translate(calc(-50% + ${Math.cos(ang) * r * f}px), calc(-50% + ${Math.sin(ang) * r * f * 0.7 - 40 * s * f}px)) rotate(${turns * f * 2}deg)`, opacity: k === 8 ? 0 : 1 });
      }
      done(e)(e.animate(frames, { duration: dur, delay: rnd(0, 400), easing: 'ease-out', fill: 'both' }));
    }
  }

  // ---------- dragon: an eastern dragon snakes over the seat and breathes fire ----------
  const DRAGON_HEAD = `<svg viewBox="0 0 80 60" aria-hidden="true">
    <path d="M10 30 Q22 8 48 12 Q70 14 76 30 Q70 46 48 48 Q22 52 10 30 Z" fill="#C8202E" stroke="#7A0B14" stroke-width="2"/>
    <path d="M44 14 Q50 0 62 2 Q54 6 52 16 Z M36 14 Q36 0 46 -2 Q40 4 42 15 Z" fill="#F2C14E" stroke="#9A7420" stroke-width="1"/>
    <path d="M48 46 Q60 58 76 52 Q62 50 56 44 Z" fill="#F2C14E" stroke="#9A7420" stroke-width="1"/>
    <circle cx="54" cy="24" r="5" fill="#FFF3B0"/><circle cx="55.5" cy="24" r="2.4" fill="#1A0505"/>
    <path d="M66 34 Q74 36 78 32" stroke="#7A0B14" stroke-width="2" fill="none"/>
    <path d="M70 28 q8 -6 14 -4 M70 40 q8 4 14 2" stroke="#F2C14E" stroke-width="2" fill="none" stroke-linecap="round"/>
  </svg>`;
  function dragon(layer, x, y, s) {
    const w = 360 * s, h = 120 * s;
    const path = `path('M ${x - w / 2} ${y - 40 * s} C ${x - w / 4} ${y - h - 40 * s}, ${x} ${y + 40 * s}, ${x + w / 6} ${y - 60 * s} S ${x + w / 3} ${y - h}, ${x + w / 2} ${y - 70 * s}')`;
    const segs = 18, dur = 2000;
    for (let i = segs; i >= 0; i--) {
      const head = i === 0;
      const size = (30 - i * 0.9) * s;   // the body tapers towards the tail
      const e = piece(layer, head ? 'fx-dragon-head' : 'fx-dragon-seg', 0, 0, {
        width: (head ? 64 * s : size) + 'px', height: (head ? 48 * s : size) + 'px', offsetPath: path, offsetRotate: 'auto',
      });
      if (head) e.innerHTML = DRAGON_HEAD;
      if (!head && i % 3 === 0) e.classList.add('fin');
      done(e)(e.animate([{ offsetDistance: '0%', opacity: 0 }, { offsetDistance: '8%', opacity: 1, offset: 0.08 }, { offsetDistance: '100%', opacity: 1, offset: 0.92 }, { offsetDistance: '100%', opacity: 0 }],
        { duration: dur, delay: i * 45, easing: 'cubic-bezier(.45,.05,.55,.95)', fill: 'both' }));
    }
    // fire breath at the end of the flight
    const fx = x + w / 2, fy = y - 70 * s;
    for (let i = 0; i < 26; i++) {
      const e = piece(layer, 'fx-fire', fx, fy, { width: rnd(14, 26) * s + 'px', height: rnd(14, 26) * s + 'px' });
      const a = rnd(-35, 35) * Math.PI / 180, r = rnd(60, 130) * s;
      done(e)(e.animate([
        { transform: 'translate(-50%,-50%) scale(.3)', opacity: 0 },
        { transform: 'translate(-50%,-50%) scale(.6)', opacity: 1, offset: 0.1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * r}px), calc(-50% + ${Math.sin(a) * r}px)) scale(1.6)`, opacity: 0 },
      ], { duration: rnd(600, 900), delay: dur * 0.85 + rnd(0, 250), easing: 'ease-out', fill: 'both' }));
    }
  }

  const KINDS = { confetti, fireworks, goldrain, sakura, dragon };
  function play(kind, container, x, y, opts = {}) {
    const fn = KINDS[kind];
    if (!fn || !container) return;
    const layer = layerIn(container);
    const s = opts.scale || 1;
    if (reduced()) {   // no motion: a short, still glow instead
      const g = piece(layer, 'fx-flash', x, y, { width: 160 * s + 'px', height: 160 * s + 'px', background: 'radial-gradient(circle, rgba(242,193,78,.6), transparent 65%)', transform: 'translate(-50%,-50%)' });
      setTimeout(() => g.remove(), 1500);
      return;
    }
    fn(layer, x, y, s);
  }
  window.Effects = { play, kinds: Object.keys(KINDS) };
})();
