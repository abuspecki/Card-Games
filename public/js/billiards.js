/* =========================================================
   8-ball pool — the table, the balls, aiming and the replay.

   The table is drawn on a canvas. Drag on the table to aim (the cue
   ball shoots towards your finger / pointer), pick the strength,
   then shoot. With ball in hand, drag the cue ball where you want
   it first. Every shot is replayed here with the same physics the
   server used (billiards-physics.js), so the animation shows exactly
   what happened.
   ========================================================= */
(function () {
  const P = window.PoolPhysics;
  const COLORS = { 1: '#F2C200', 2: '#1D4ED8', 3: '#D42A1E', 4: '#6B2FA8', 5: '#F07F12', 6: '#13894A', 7: '#7E1F22', 8: '#111111' };
  const colorOf = (n) => COLORS[n > 8 ? n - 8 : n] || '#fff';
  const L = {
    land: { W: 1440, H: 780, k: 5.3, rail: 46, fx: 190, fy: 128, rot: false },
    port: { W: 440, H: 872, k: 3.7, rail: 22, fx: 35, fy: 104, rot: true },
  };
  let G = null, ctxRef = null, canvas = null, c2 = null;
  let aim = Math.PI;             // radians, physics space
  let power = 0.55;
  let drag = null;               // 'aim' | 'cue'
  let placed = null;             // [x, y] cue ball placed by you (ball in hand)
  let shown = null;              // balls drawn right now
  let play = null;               // { frames, start, duration, pots, endAt }
  let lastShot = 0;
  let raf = 0;
  let confirmResign = false;
  let spin = { x: 0, y: 0 };      // where the cue hits the cue ball: y > 0 follow, y < 0 draw, x side
  const orient = new Map();      // n → { p: pole, s: number spot, at: [x, y] } — how each ball has rolled

  // physics ↔ stage pixels
  const toS = (x, y) => (G.rot ? [G.fx + y * G.k, G.fy + (P.W - x) * G.k] : [G.fx + x * G.k, G.fy + y * G.k]);
  const toP = (sx, sy) => (G.rot ? [P.W - (sy - G.fy) / G.k, (sx - G.fx) / G.k] : [(sx - G.fx) / G.k, (sy - G.fy) / G.k]);
  const fieldW = () => (G.rot ? P.H : P.W) * G.k, fieldH = () => (G.rot ? P.W : P.H) * G.k;

  function build(ctx) {
    ctxRef = ctx;
    G = L[ctx.layout];
    canvas = document.createElement('canvas');
    canvas.className = 'pool-canvas';
    canvas.width = G.W * 2; canvas.height = G.H * 2;
    Object.assign(canvas.style, { width: G.W + 'px', height: G.H + 'px' });
    c2 = canvas.getContext('2d');
    const ui = ctx.h('div', 'pool-ui'); ui.id = 'pUi';
    ctx.stage.append(canvas, ui);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    ctx.controls.innerHTML = `
      <section class="pool-bar" id="pBar">
        <div class="pb-info"><small>Game for</small><strong id="pAmount">–</strong><em id="pNote"></em></div>
        <div class="pb-target" id="pTargetBar"></div>
        <div class="pb-spin" title="Spin: tap where the cue hits the cue ball (top: follow, bottom: draw, sides: english). Double-tap to reset.">
          <div class="spin-ball" id="pSpin" role="slider" aria-label="Spin" tabindex="0"><i id="pSpinDot"></i><span></span></div><small>Spin</small></div>
        <div class="pb-aim"><button class="pbtn fine" data-fine="-1" aria-label="Aim left">◀</button><button class="pbtn fine" data-fine="1" aria-label="Aim right">▶</button></div>
        <div class="cue-power" id="pPower" role="slider" aria-label="Strength" aria-valuemin="5" aria-valuemax="100" tabindex="0">
          <div class="cp-meter"><i id="pMeter"></i></div><div class="cp-stick" id="pStick"></div><div class="cp-ball"></div>
          <span class="cp-label">Strength <b id="pPow">55</b>%</span></div>
        <button class="pbtn gold shoot" id="pShoot">Shoot</button>
        <button class="pbtn quiet" id="pResign">Concede</button>
      </section>`;
    wirePower(); wireSpin();
    ctx.controls.querySelectorAll('[data-fine]').forEach((b) => { b.onclick = () => { aim += Number(b.dataset.fine) * 0.004 * (G.rot ? -1 : 1); }; });
    document.getElementById('pShoot').onclick = shoot;
    document.getElementById('pResign').onclick = () => {
      if (!confirmResign) { confirmResign = true; paintBar(); setTimeout(() => { confirmResign = false; paintBar(); }, 3500); return; }
      confirmResign = false; ctx.send({ t: 'action', action: 'resign' });
    };
    cancelAnimationFrame(raf);
    const loop = () => { draw(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
  }

  // ----- the strength: a cue you pull back -----
  function setPower(v) {
    power = Math.max(0.05, Math.min(1, v));
    const pct = Math.round(power * 100);
    const box = document.getElementById('pPower');
    if (!box) return;
    document.getElementById('pPow').textContent = pct;
    document.getElementById('pMeter').style.width = pct + '%';
    const travel = box.clientWidth * 0.32;
    document.getElementById('pStick').style.transform = `translateX(${-power * travel}px)`;
    box.setAttribute('aria-valuenow', pct);
    box.classList.toggle('hot', power > 0.8);
  }
  function wirePower() {
    const box = document.getElementById('pPower');
    let start = null;
    box.addEventListener('pointerdown', (e) => { box.setPointerCapture(e.pointerId); start = { x: e.clientX, p: power }; box.classList.add('pulling'); });
    box.addEventListener('pointermove', (e) => { if (start) setPower(start.p + (start.x - e.clientX) / (box.clientWidth * 0.6)); });
    const end = () => { start = null; box.classList.remove('pulling'); };
    box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
    box.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { setPower(power + 0.05); e.preventDefault(); } if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { setPower(power - 0.05); e.preventDefault(); } });
    box.addEventListener('wheel', (e) => { setPower(power - Math.sign(e.deltaY) * 0.03); e.preventDefault(); }, { passive: false });
    requestAnimationFrame(() => setPower(power));
  }
  // ----- spin: tap where the cue hits the cue ball -----
  function setSpin(x, y) {
    const l = Math.hypot(x, y);
    if (l > 0.85) { x *= 0.85 / l; y *= 0.85 / l; }
    if (Math.hypot(x, y) < 0.12) { x = 0; y = 0; }
    spin = { x, y };
    const dot = document.getElementById('pSpinDot');
    if (dot) { dot.style.left = 50 + x * 45 + '%'; dot.style.top = 50 - y * 45 + '%'; }
    const lab = document.querySelector('#pSpin span');
    if (lab) lab.textContent = !x && !y ? '' : y > 0.25 ? 'Follow' : y < -0.25 ? 'Draw back' : x > 0 ? 'Right' : 'Left';
  }
  function wireSpin() {
    const el = document.getElementById('pSpin');
    let down = false;
    const at = (e) => { const r = el.getBoundingClientRect(); setSpin(((e.clientX - r.left) / r.width - 0.5) * 2, -((e.clientY - r.top) / r.height - 0.5) * 2); };
    el.addEventListener('pointerdown', (e) => { down = true; el.setPointerCapture(e.pointerId); at(e); });
    el.addEventListener('pointermove', (e) => { if (down) at(e); });
    el.addEventListener('pointerup', () => { down = false; });
    el.addEventListener('dblclick', () => setSpin(0, 0));
    el.addEventListener('keydown', (e) => {
      const k = { ArrowUp: [0, 0.2], ArrowDown: [0, -0.2], ArrowLeft: [-0.2, 0], ArrowRight: [0.2, 0] }[e.key];
      if (k) { setSpin(spin.x + k[0], spin.y + k[1]); e.preventDefault(); }
    });
    setSpin(spin.x, spin.y);
  }

  const st = () => (window.App && App.S && App.S.state && App.S.state.game === 'billiards' ? App.S.state : null);
  const myTurn = () => { const s = st(); return !!s && s.stage === 'playing' && s.mySeat !== -1 && s.toAct === s.mySeat && !play; };
  function cuePos() {
    const s = st();
    if (placed) return { x: placed[0], y: placed[1] };
    const c = s && (shown || s.balls).find((b) => b.n === 0);
    return c && !c.down ? c : { x: P.HEAD_X - 10, y: 50 };
  }
  function eventPos(e) {
    const r = canvas.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * G.W, sy = ((e.clientY - r.top) / r.height) * G.H;
    return toP(sx, sy);
  }
  function onDown(e) {
    if (!myTurn()) return;
    const [x, y] = eventPos(e);
    const s = st();
    const cue = cuePos();
    canvas.setPointerCapture(e.pointerId);
    if (s.ballInHand && Math.hypot(x - cue.x, y - cue.y) < P.R * 3.2) { drag = 'cue'; return; }
    drag = 'aim';
    aim = Math.atan2(y - cue.y, x - cue.x);
  }
  function onMove(e) {
    if (!drag || !myTurn()) return;
    const [x, y] = eventPos(e);
    if (drag === 'cue') {
      const s = st();
      const nx = Math.max(P.R, Math.min((s.kitchen ? P.HEAD_X : P.W) - P.R, x)), ny = Math.max(P.R, Math.min(P.H - P.R, y));
      if (P.canPlace(s.balls, nx, ny, s.kitchen)) placed = [nx, ny];
      return;
    }
    const cue = cuePos();
    if (Math.hypot(x - cue.x, y - cue.y) > P.R) aim = Math.atan2(y - cue.y, x - cue.x);
  }
  function onUp() { drag = null; }

  function shoot() {
    if (!myTurn()) return;
    const s = st();
    const amount = { angle: aim, power, spin };
    if (s.ballInHand) {
      const c = cuePos();
      if (!P.canPlace(s.balls, c.x, c.y, s.kitchen)) { ctxRef.toast(s.kitchen ? 'Place the cue ball behind the line' : 'Place the cue ball on a free spot', { kind: 'bad' }); return; }
      amount.cue = [c.x, c.y];
    }
    ctxRef.send({ t: 'action', action: 'shoot', amount });
  }

  // ----- a new state: start the replay of a new shot -----
  function render(state, S, ctx) {
    ctxRef = ctx;
    if (state.shot && state.shot.no !== lastShot) {
      const isNew = lastShot !== 0 || state.rolling > 0;
      lastShot = state.shot.no;
      placed = null;
      if (isNew) {
        const r = P.simulate(state.shot.before, { angle: state.shot.angle, power: state.shot.power, spin: state.shot.spin }, { record: true });
        play = { frames: r.frames, start: performance.now(), duration: r.duration * 1000, pots: r.events.pocketed.map((p) => p.t * 1000),
          clicks: [...r.events.hits, ...r.events.cushions].map((x) => x * 1000).sort((a, b) => a - b) };
        if (window.Sound) Sound.play('cue');
      }
    }
    if (!state.shot) { lastShot = 0; play = null; }
    if (!play) shown = null;
    if (state.ballInHand && !placed && state.mySeat === state.toAct) {
      const c = state.balls.find((b) => b.n === 0);
      if (c && P.canPlace(state.balls, c.x, c.y, state.kitchen)) placed = [c.x, c.y];
      else placed = [state.kitchen ? P.HEAD_X - 10 : 50, 50];
    }
    // aim at something sensible at the start of your turn
    if (myTurn() && drag === null && state.targets && state.targets.length && paintUi.turnKey !== `${state.handNo}:${lastShot}`) {
      paintUi.turnKey = `${state.handNo}:${lastShot}`;
      const cue = cuePos();
      const t = state.balls.filter((b) => state.targets.includes(b.n) && !b.down).sort((a, b) => Math.hypot(a.x - cue.x, a.y - cue.y) - Math.hypot(b.x - cue.x, b.y - cue.y))[0];
      if (t) aim = Math.atan2(t.y - cue.y, t.x - cue.x);
      if (state.isBreak) { aim = Math.atan2(P.FOOT.y - cue.y, P.FOOT.x - cue.x); setPower(0.95); setSpin(0, 0); }
    }
    paintUi();
  }

  // ----- drawing (every animation frame) -----
  function draw() {
    const s = st();
    if (!s || !c2) return;
    // replay
    let balls = s.balls;
    if (play) {
      const t = performance.now() - play.start;
      while (play.pots.length && play.pots[0] <= t) { play.pots.shift(); if (window.Sound) Sound.play('pot'); }
      let clicked = 0;
      while (play.clicks.length && play.clicks[0] <= t) { play.clicks.shift(); if (window.Sound && clicked++ < 2) Sound.play('click'); }
      const f = play.frames;
      let i = f.findIndex((fr) => fr.t * 1000 > t);
      if (i === -1) { play = null; shown = null; paintUi(); }
      else {
        const fr = f[Math.max(0, i - 1)];
        balls = fr.p.map(([n, x, y]) => ({ n, x, y, down: false }));
        shown = balls;
      }
    }
    const g = c2;
    g.setTransform(2, 0, 0, 2, 0, 0);
    g.clearRect(0, 0, G.W, G.H);
    drawTable(g, s);
    const [cx, cy] = [cuePos().x, cuePos().y];
    // aiming guide and cue
    if (myTurn()) drawAim(g, s, { x: cx, y: cy });
    // your balls glow while it is your turn
    if (myTurn() && s.targets && s.targets.length) {
      const pulse = 0.55 + 0.35 * Math.sin(performance.now() / 260);
      for (const b of balls) if (!b.down && s.targets.includes(b.n)) {
        const [bx, by] = toS(b.x, b.y);
        g.strokeStyle = `rgba(255, 226, 120, ${pulse})`; g.lineWidth = 3; g.beginPath(); g.arc(bx, by, P.R * G.k + 4, 0, Math.PI * 2); g.stroke();
      }
    }
    for (const b of balls) if (!b.down) roll(b);
    for (const b of balls) if (!b.down && !(b.n === 0 && placed && !play)) drawBall(g, b.n, b.x, b.y);
    if (placed && !play && myTurn()) drawBall(g, 0, placed[0], placed[1], true);
    if (myTurn()) drawCue(g, { x: cx, y: cy });
  }

  // the cloth's weave, drawn once
  let clothTex = null;
  function clothPattern(g) {
    if (clothTex) return clothTex;
    const c = document.createElement('canvas'); c.width = c.height = 96;
    const x = c.getContext('2d');
    let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 2600; k++) { x.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,0,0'},${0.03 + rnd() * 0.05})`; x.fillRect(rnd() * 96, rnd() * 96, 1, 1 + rnd()); }
    clothTex = g.createPattern(c, 'repeat');
    return clothTex;
  }
  // cushions follow the physics: each rail with its jaws, so the mouths look exactly as they play
  function cushionPolys() {
    const S = P.SEGMENTS, rails = S.slice(0, 6), jaws = S.slice(6);
    const same = (ax, ay, bx, by) => Math.abs(ax - bx) < 1e-6 && Math.abs(ay - by) < 1e-6;
    return rails.map(([ax, ay, bx, by]) => {
      const ja = jaws.find((j) => same(j[0], j[1], ax, ay)), jb = jaws.find((j) => same(j[0], j[1], bx, by));
      return [[ja[2], ja[3]], [ax, ay], [bx, by], [jb[2], jb[3]]];
    });
  }
  function drawTable(g, s) {
    const [x0, y0] = [G.fx, G.fy], w = fieldW(), h = fieldH(), r = G.rail;
    const poly = (pts) => { g.beginPath(); pts.forEach(([x, y], k) => { const [a, b] = toS(x, y); if (k) g.lineTo(a, b); else g.moveTo(a, b); }); g.closePath(); };
    // the wooden frame, with a little grain
    const wood = g.createLinearGradient(x0 - r, y0 - r, x0 + w + r, y0 + h + r);
    wood.addColorStop(0, '#7A4A28'); wood.addColorStop(0.45, '#56311B'); wood.addColorStop(1, '#2E1A0C');
    g.fillStyle = wood; roundRect(g, x0 - r, y0 - r, w + 2 * r, h + 2 * r, r * 0.6); g.fill();
    g.save(); roundRect(g, x0 - r, y0 - r, w + 2 * r, h + 2 * r, r * 0.6); g.clip();
    g.globalAlpha = 0.12; g.strokeStyle = '#000'; g.lineWidth = 1;
    for (let k = -h; k < w + h; k += 7) { g.beginPath(); g.moveTo(x0 - r + k, y0 - r); g.bezierCurveTo(x0 + k + 20, y0 + h * 0.3, x0 + k - 20, y0 + h * 0.7, x0 - r + k + 10, y0 + h + r); g.stroke(); }
    g.restore();
    g.strokeStyle = 'rgba(255,220,170,.28)'; g.lineWidth = 2; roundRect(g, x0 - r + 2, y0 - r + 2, w + 2 * r - 4, h + 2 * r - 4, r * 0.55); g.stroke();
    // pocket holes with leather liners
    for (const p of P.POCKETS) {
      const [px, py] = toS(p.x, p.y);
      const pr = p.r * G.k * 1.08;
      g.fillStyle = '#2A1A10'; g.beginPath(); g.arc(px, py, pr + 4, 0, Math.PI * 2); g.fill();
      const hole = g.createRadialGradient(px, py, pr * 0.2, px, py, pr);
      hole.addColorStop(0, '#000'); hole.addColorStop(0.8, '#050505'); hole.addColorStop(1, '#1A1A1A');
      g.fillStyle = hole; g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
    }
    // the cloth
    const cloth = g.createRadialGradient(x0 + w / 2, y0 + h / 2, 10, x0 + w / 2, y0 + h / 2, Math.max(w, h) * 0.7);
    cloth.addColorStop(0, '#22955C'); cloth.addColorStop(0.6, '#167647'); cloth.addColorStop(1, '#0D5534');
    g.fillStyle = cloth; g.fillRect(x0, y0, w, h);
    g.fillStyle = clothPattern(g); g.fillRect(x0, y0, w, h);
    // cushions (rubber noses lit from above)
    for (const pts of cushionPolys()) {
      poly(pts); g.fillStyle = '#0E6238'; g.fill();
      const [[, ], [ax, ay], [bx, by]] = pts;
      const [a1, a2] = toS(ax, ay), [b1, b2] = toS(bx, by);
      g.strokeStyle = 'rgba(160,255,200,.18)'; g.lineWidth = 2; g.beginPath(); g.moveTo(a1, a2); g.lineTo(b1, b2); g.stroke();
    }
    // the cushions' shadow on the cloth
    g.save(); g.beginPath(); g.rect(x0, y0, w, h); g.clip();
    g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 6; g.strokeRect(x0 - 1, y0 - 1, w + 2, h + 2); g.restore();
    // diamonds
    g.fillStyle = '#F3E3BC';
    const dia = (px, py) => { g.save(); g.translate(px, py); g.rotate(Math.PI / 4); g.fillRect(-2.6, -2.6, 5.2, 5.2); g.restore(); };
    const off = r * 0.62 + 0.35 * P.R;
    for (let k = 1; k < 8; k++) { if (k === 4) continue; const [ax, ay] = toS((P.W / 8) * k, 0); const [bx, by] = toS((P.W / 8) * k, P.H); dia(ax + (G.rot ? -off : 0), ay - (G.rot ? 0 : off)); dia(bx + (G.rot ? off : 0), by + (G.rot ? 0 : off)); }
    for (let k = 1; k < 4; k++) { const [ax, ay] = toS(0, (P.H / 4) * k); const [bx, by] = toS(P.W, (P.H / 4) * k); dia(ax - (G.rot ? 0 : off), ay + (G.rot ? off : 0)); dia(bx + (G.rot ? 0 : off), by - (G.rot ? off : 0)); }
    // head string, foot spot, and the kitchen while breaking
    const [hx1, hy1] = toS(P.HEAD_X, 0), [hx2, hy2] = toS(P.HEAD_X, P.H);
    if (s.kitchen && s.ballInHand && s.stage === 'playing') {
      g.fillStyle = 'rgba(255,255,255,.06)';
      const [kx1, ky1] = toS(0, 0); const [kx2, ky2] = toS(P.HEAD_X, P.H);
      g.fillRect(Math.min(kx1, kx2), Math.min(ky1, ky2), Math.abs(kx2 - kx1), Math.abs(ky2 - ky1));
    }
    g.strokeStyle = 'rgba(255,255,255,.16)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(hx1, hy1); g.lineTo(hx2, hy2); g.stroke();
    const [fsx, fsy] = toS(P.FOOT.x, P.FOOT.y); g.fillStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.arc(fsx, fsy, 2.5, 0, Math.PI * 2); g.fill();
    // the lamp: light in the middle, darker towards the rails
    const vig = g.createRadialGradient(x0 + w / 2, y0 + h / 2, Math.min(w, h) * 0.25, x0 + w / 2, y0 + h / 2, Math.max(w, h) * 0.75);
    vig.addColorStop(0, 'rgba(255,250,220,.05)'); vig.addColorStop(1, 'rgba(0,0,0,.3)');
    g.fillStyle = vig; g.fillRect(x0, y0, w, h);
  }

  // ----- rolling: each ball keeps where its number and stripe point, and turns as it moves -----
  function rot(v, k, a) {           // turn v around the unit axis k by angle a
    const c = Math.cos(a), sn = Math.sin(a), d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
    const cx = k[1] * v[2] - k[2] * v[1], cy = k[2] * v[0] - k[0] * v[2], cz = k[0] * v[1] - k[1] * v[0];
    return [v[0] * c + cx * sn + k[0] * d * (1 - c), v[1] * c + cy * sn + k[1] * d * (1 - c), v[2] * c + cz * sn + k[2] * d * (1 - c)];
  }
  function roll(b) {
    let o = orient.get(b.n);
    if (!o) { const a = (b.n * 0.9) % (Math.PI * 2); o = { p: [Math.cos(a), Math.sin(a), 0], s: [0.25 * Math.sin(a), -0.25 * Math.cos(a), 0.97], at: [b.x, b.y] }; orient.set(b.n, o); }
    const dx = b.x - o.at[0], dy = b.y - o.at[1], d = Math.hypot(dx, dy);
    o.at = [b.x, b.y];
    if (d < 1e-4 || d > 25) return;
    const k = [-dy / d, dx / d, 0];
    o.p = rot(o.p, k, d / P.R); o.s = rot(o.s, k, d / P.R);
  }
  // a direction on the ball, as seen on screen (the phone shows the table turned)
  const proj = (v) => (G.rot ? [v[1], -v[0], v[2]] : [v[0], v[1], v[2]]);
  function spot(g, sx, sy, r, v, size, fill) {
    const [px, py, pz] = proj(v);
    if (pz <= 0.02) return false;
    const ang = Math.atan2(py, px);
    g.save(); g.translate(sx + px * r * 0.98, sy + py * r * 0.98); g.rotate(ang);
    g.fillStyle = fill; g.beginPath(); g.ellipse(0, 0, Math.max(0.6, r * size * pz), r * size, 0, 0, Math.PI * 2); g.fill();
    g.restore();
    return true;
  }
  function drawBall(g, n, x, y, ghostly) {
    const [sx, sy] = toS(x, y);
    const r = P.R * G.k;
    const o = orient.get(n) || { p: [1, 0, 0], s: [0, 0, 1] };
    g.save();
    if (ghostly) g.globalAlpha = 0.9;
    // shadow under the lamp
    g.fillStyle = 'rgba(0,0,0,.38)'; g.beginPath(); g.ellipse(sx + r * 0.22, sy + r * 0.34, r * 1.02, r * 0.86, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.closePath();
    g.save(); g.clip();
    if (n === 0) {
      g.fillStyle = '#FBF8EE'; g.fillRect(sx - r, sy - r, 2 * r, 2 * r);
      spot(g, sx, sy, r, o.s, 0.16, '#C8342A');                        // the red dot shows the cue ball turning
    } else if (n > 8) {
      g.fillStyle = colorOf(n); g.fillRect(sx - r, sy - r, 2 * r, 2 * r);
      // the white caps of a stripe, at both poles
      const [px, py, pz] = proj(o.p);
      for (const sg of [1, -1]) {
        const z = pz * sg;
        if (z < -0.55) continue;
        const ang = Math.atan2(py * sg, px * sg);
        g.save(); g.translate(sx + px * sg * r * 0.9, sy + py * sg * r * 0.9); g.rotate(ang);
        g.fillStyle = '#FBF8EE'; g.beginPath(); g.ellipse(0, 0, r * 0.75 * Math.max(0.18, Math.abs(z) * 0.9 + 0.1), r * 0.9, 0, 0, Math.PI * 2); g.fill();
        g.restore();
      }
    } else { g.fillStyle = colorOf(n); g.fillRect(sx - r, sy - r, 2 * r, 2 * r); }
    // the number on its white circle, turning with the ball
    if (n > 0) {
      const [px, py, pz] = proj(o.s);
      if (pz > 0.02) {
        spot(g, sx, sy, r, o.s, 0.46, '#FBF8EE');
        if (pz > 0.4) {
          g.save(); g.translate(sx + px * r * 0.98, sy + py * r * 0.98); g.scale(Math.max(0.5, pz), Math.max(0.5, pz));
          g.fillStyle = '#111'; g.font = `700 ${Math.round(r * 0.6)}px Montserrat, system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(String(n), 0, 0.5); g.restore();
        }
      }
    }
    // light: a bright highlight from the lamp, shade on the far side
    const sh = g.createRadialGradient(sx - r * 0.32, sy - r * 0.38, r * 0.05, sx, sy, r * 1.05);
    sh.addColorStop(0, 'rgba(255,255,255,.75)'); sh.addColorStop(0.18, 'rgba(255,255,255,.18)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(0,0,0,.45)');
    g.fillStyle = sh; g.fillRect(sx - r, sy - r, 2 * r, 2 * r);
    g.restore();
    if (ghostly) { g.strokeStyle = 'rgba(242,193,78,.95)'; g.lineWidth = 2; g.setLineDash([4, 3]); g.beginPath(); g.arc(sx, sy, r + 3, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); }
    g.restore();
  }

  function drawAim(g, s, cue) {
    const live = (shown || s.balls).filter((b) => !b.down && b.n !== 0);
    const hit = P.firstContact(live, cue, aim);
    const [c0x, c0y] = toS(cue.x, cue.y);
    let endX = cue.x + Math.cos(aim) * 400, endY = cue.y + Math.sin(aim) * 400;
    // the line stops at the first ball (or the cushion)
    let tWall = Infinity;
    const dx = Math.cos(aim), dy = Math.sin(aim);
    if (dx > 0) tWall = Math.min(tWall, (P.W - P.R - cue.x) / dx); if (dx < 0) tWall = Math.min(tWall, (P.R - cue.x) / dx);
    if (dy > 0) tWall = Math.min(tWall, (P.H - P.R - cue.y) / dy); if (dy < 0) tWall = Math.min(tWall, (P.R - cue.y) / dy);
    const t = hit ? Math.min(hit.dist, tWall) : tWall;
    endX = cue.x + dx * t; endY = cue.y + dy * t;
    const [ex, ey] = toS(endX, endY);
    g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 1.6; g.setLineDash([6, 5]);
    g.beginPath(); g.moveTo(c0x, c0y); g.lineTo(ex, ey); g.stroke(); g.setLineDash([]);
    const r = P.R * G.k;
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.5; g.beginPath(); g.arc(ex, ey, r, 0, Math.PI * 2); g.stroke();
    if (hit && hit.dist <= tWall) {
      // where the object ball goes
      const b = hit.ball;
      const nx = b.x - hit.x, ny = b.y - hit.y, nl = Math.hypot(nx, ny) || 1;
      const good = s.targets.includes(b.n);
      const [bx, by] = toS(b.x, b.y), [tx, ty] = toS(b.x + (nx / nl) * 24, b.y + (ny / nl) * 24);
      g.strokeStyle = good ? 'rgba(120,255,170,.9)' : 'rgba(255,110,90,.9)'; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(bx, by); g.lineTo(tx, ty); g.stroke();
      if (!good) { g.strokeStyle = 'rgba(255,110,90,.9)'; g.beginPath(); g.arc(bx, by, r + 3, 0, Math.PI * 2); g.stroke(); }
    }
  }

  function drawCue(g, cue) {
    const [cx, cy] = toS(cue.x, cue.y);
    const ang = G.rot ? Math.atan2(-Math.cos(aim), Math.sin(aim)) : aim;     // aim in screen space
    const back = P.R * G.k * 1.6 + power * 34;
    const len = G.rot ? 300 : 420;
    const ux = -Math.cos(ang), uy = -Math.sin(ang);
    const x1 = cx + ux * back, y1 = cy + uy * back, x2 = cx + ux * (back + len), y2 = cy + uy * (back + len);
    g.save();
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 9; g.beginPath(); g.moveTo(x1 + 4, y1 + 6); g.lineTo(x2 + 4, y2 + 6); g.stroke();
    const grad = g.createLinearGradient(x1, y1, x2, y2);
    grad.addColorStop(0, '#F3EEDF'); grad.addColorStop(0.03, '#F3EEDF'); grad.addColorStop(0.035, '#2B6CB0'); grad.addColorStop(0.05, '#E9D3A6');
    grad.addColorStop(0.6, '#C99A5B'); grad.addColorStop(0.62, '#2A160A'); grad.addColorStop(1, '#3A2112');
    g.strokeStyle = grad; g.lineWidth = 6; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    g.restore();
  }

  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  // ----- players, cards and the bar -----
  // Which balls a player still has to pocket: big and clear.
  const ballHtml = (n, gone) => `<i class="tb ${n > 8 ? 'st' : ''}${n === 8 ? ' eight' : ''}${gone ? ' gone' : ''}" style="--c:${colorOf(n)}"><b>${n}</b></i>`;
  function targetHtml(s, i, ctx) {
    const p = s.seats[i];
    if (!p) return '';
    const down = new Set(s.balls.filter((b) => b.down).map((b) => b.n));
    const who = i === s.mySeat ? 'You' : ctx.esc(p.name);
    if (!p.group) return `<span class="tt"><b>${who}</b>: open table</span><span class="tsub">any ball except the 8</span>`;
    const group = p.group === 'solids' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
    if (p.onEight) return `<span class="tt"><b>${who}</b>: now the 8!</span><span class="tballs">${ballHtml(8, false)}</span>`;
    const left = group.filter((n) => !down.has(n)).length;
    return `<span class="tt"><b>${who}</b>: ${p.group === 'solids' ? 'Solids' : 'Stripes'}</span><span class="tballs">${group.map((n) => ballHtml(n, down.has(n))).join('')}</span><span class="tsub">${left} left, then the 8</span>`;
  }

  function paintUi() {
    const s = st(), ctx = ctxRef;
    const ui = document.getElementById('pUi');
    if (!s || !ui) return;
    ui.replaceChildren();
    const me = s.mySeat;
    const port = G.rot;
    const order = me === 1 ? [1, 0] : [0, 1];
    order.forEach((i, k) => {
      const p = s.seats[i];
      const active = !play && s.stage === 'playing' && (s.toAct === i);
      const el = ctx.h('div', `pplate${active ? ' active' : ''}${s.results && s.results.winners[0] && s.results.winners[0].seat === i && !play ? ' winner' : ''}${!p ? ' empty' : ''}`);
      if (p) {
        const balls = p.group ? (p.group === 'solids' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15]) : [];
        const down = new Set(s.balls.filter((b) => b.down).map((b) => b.n));
        const level = p.botLevel ? ['', 'Bot · easy', 'Bot · medium', 'Bot · strong'][p.botLevel] : '';
        el.innerHTML = `<span class="avatar">${ctx.avatarHtml(p)}</span><span class="col"><span class="name">${ctx.nameHtml(p)}</span>
          <span class="sub"><span>${ctx.fmt(p.chips)}</span>${level ? `<span class="lvl">${level}</span>` : ''}${p.group ? `<span class="grp">${p.group === 'solids' ? 'Solids' : 'Stripes'}</span>` : ''}</span>
          <span class="mini">${p.group ? balls.map((n) => `<i class="${down.has(n) ? 'gone' : ''} ${n > 8 ? 'st' : ''}" style="--c:${colorOf(n)}"></i>`).join('') + (p.onEight ? '<i class="eight" style="--c:#111"></i>' : '') : '<em>Open table</em>'}</span></span>
          ${active && s.ballInHand && i === me ? '<span class="bih">Ball in hand</span>' : ''}`;
        if (p.hasAccount && !p.isBot) { el.classList.add('clickable'); el.onclick = () => App.openProfile(p.name); }
      } else el.innerHTML = '<span class="avatar">+</span><span class="col"><span class="name">Open seat</span><span class="sub">Waiting for an opponent</span></span>';
      const w = port ? 200 : 380;
      const x = port ? 14 + k * 212 : (k === 0 ? 190 : 1250 - w);
      Object.assign(el.style, { left: x + 'px', top: (port ? 8 : 14) + 'px', width: w + 'px' });
      ui.appendChild(el);
      if (p) ctx.plates[i] = [x + w / 2, port ? 20 : 30];
    });
    // the overview: whose turn, and which balls must go in
    const turn = s.stage === 'playing' ? (s.toAct !== -1 ? s.toAct : (play && s.shot ? s.shot.seat : -1)) : -1;
    const focus = turn !== -1 ? turn : me;
    const html = focus !== -1 && s.seats[focus] && s.stage === 'playing' ? targetHtml(s, focus, ctx) : '';
    const bar = document.getElementById('pTargetBar');
    if (port) { if (bar) { bar.innerHTML = html; bar.classList.toggle('mine', focus === me); } }
    else {
      if (bar) bar.innerHTML = '';
      if (html) { const t = ctx.h('div', 'ptarget' + (focus === me ? ' mine' : ''), html); ui.appendChild(t); }
    }
    const centre = () => { const [x, y] = [G.fx + fieldW() / 2, G.fy + fieldH() / 2]; return { left: x + 'px', top: y + 'px' }; };
    const card = (cls, html) => { const c = ctx.h('div', 'pcard ' + cls, html); Object.assign(c.style, centre()); ui.appendChild(c); return c; };
    const seated = s.seats.filter(Boolean).length;
    if (s.stage === 'waiting' && me !== -1 && seated < 2) {
      const c = card('wait', `<h4>Waiting for an opponent</h4><p>Invite a friend — or play a bot right away:</p>
        <div class="levels"><button data-l="1">Easy</button><button data-l="2">Medium</button><button data-l="3">Strong</button></div>
        <button class="link" data-invite>Invite a friend</button>`);
      c.querySelectorAll('[data-l]').forEach((b) => { b.onclick = () => ctx.send({ t: 'addBot', level: Number(b.dataset.l) }); });
      c.querySelector('[data-invite]').onclick = () => ctx.openDrawer('table');
    } else if (s.stage === 'waiting' && seated === 2) card('small', '<p>The next game starts in a moment…</p>');
    if (s.stage === 'showdown' && s.results && !play) {
      const w = s.results.winners[0];
      const won = w.seat === me, lost = me !== -1 && w.seat !== me;
      card('result ' + (won ? 'won' : lost ? 'lost' : ''), `<h4>${won ? 'You win!' : lost ? 'You lose' : `${s.seats[w.seat] ? ctx.esc(s.seats[w.seat].name) : 'A player'} wins`}</h4>
        <p class="why"></p><strong>${won ? '+' : lost ? '−' : ''}${ctx.fmt(w.amount)}</strong><small>The next game starts shortly</small>`).querySelector('.why').textContent = s.results.reason;
    }
    if (s.note && s.stage === 'playing' && !play && /^Foul/.test(s.note)) card('small foul', '<p></p>').querySelector('p').textContent = s.note;
    paintBar();
  }

  function paintBar() {
    const s = st(), ctx = ctxRef;
    if (!s || !document.getElementById('pBar')) return;
    const me = s.mySeat;
    document.getElementById('pAmount').textContent = ctx.fmt(s.stake);
    const mine = myTurn();
    let note = `Stake ${ctx.fmt(s.stake)} per game · 8-ball`;
    if (s.stage === 'playing') {
      if (play) note = 'The balls are rolling…';
      else if (mine) note = s.isBreak ? 'Your break — place the cue ball behind the line, aim, shoot.' : s.ballInHand ? 'Ball in hand: drag the cue ball, then aim and shoot.' : 'Your shot — drag on the table to aim.';
      else if (s.toAct !== -1 && s.seats[s.toAct]) note = `${s.seats[s.toAct].name} is at the table…`;
    } else if (me === -1) note = 'You are watching.';
    document.getElementById('pNote').textContent = note;
    document.getElementById('pShoot').disabled = !mine;
    document.querySelectorAll('#pBar .fine').forEach((b) => { b.disabled = !mine; });
    const rs = document.getElementById('pResign');
    rs.disabled = !(s.stage === 'playing' && me !== -1 && s.seats[me]);
    rs.textContent = confirmResign ? `Sure? Lose ${ctx.fmt(s.stake)}` : 'Concede';
    rs.classList.toggle('danger', confirmResign);
    document.getElementById('pBar').classList.toggle('my-turn', mine);
  }

  window.TableUI.billiards = { size: { land: [1440, 780], port: [440, 872] }, build, render };
})();
