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
    port: { W: 440, H: 920, k: 3.9, rail: 22, fx: 25, fy: 110, rot: true },
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
        <div class="pb-aim"><button class="pbtn fine" data-fine="-1" aria-label="Aim left">◀</button><button class="pbtn fine" data-fine="1" aria-label="Aim right">▶</button></div>
        <label class="pb-power"><span>Strength <b id="pPow">55</b>%</span><input type="range" id="pPower" min="5" max="100" value="55"></label>
        <button class="pbtn gold shoot" id="pShoot">Shoot</button>
        <button class="pbtn quiet" id="pResign">Concede</button>
      </section>`;
    const pw = document.getElementById('pPower');
    pw.oninput = () => { power = Number(pw.value) / 100; document.getElementById('pPow').textContent = pw.value; };
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
    const amount = { angle: aim, power };
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
        const r = P.simulate(state.shot.before, { angle: state.shot.angle, power: state.shot.power }, { record: true });
        play = { frames: r.frames, start: performance.now(), duration: r.duration * 1000, pots: r.events.pocketed.map((p) => p.t * 1000), hits: 0 };
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
      if (state.isBreak) { aim = Math.atan2(P.FOOT.y - cue.y, P.FOOT.x - cue.x); power = 0.95; const pw = document.getElementById('pPower'); if (pw) { pw.value = 95; document.getElementById('pPow').textContent = 95; } }
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
    for (const b of balls) if (!b.down && !(b.n === 0 && placed && !play)) drawBall(g, b.n, b.x, b.y);
    if (placed && !play && myTurn()) drawBall(g, 0, placed[0], placed[1], true);
    if (myTurn()) drawCue(g, { x: cx, y: cy });
  }

  function drawTable(g, s) {
    const [x0, y0] = [G.fx, G.fy], w = fieldW(), h = fieldH(), r = G.rail;
    // wooden frame
    const wood = g.createLinearGradient(x0 - r, y0 - r, x0 + w + r, y0 + h + r);
    wood.addColorStop(0, '#6B3F22'); wood.addColorStop(0.5, '#4A2A16'); wood.addColorStop(1, '#2E1A0C');
    g.fillStyle = wood; roundRect(g, x0 - r, y0 - r, w + 2 * r, h + 2 * r, r * 0.6); g.fill();
    g.strokeStyle = 'rgba(255,220,170,.25)'; g.lineWidth = 2; roundRect(g, x0 - r + 2, y0 - r + 2, w + 2 * r - 4, h + 2 * r - 4, r * 0.55); g.stroke();
    // cushions
    g.fillStyle = '#0D5A35'; roundRect(g, x0 - r * 0.35, y0 - r * 0.35, w + r * 0.7, h + r * 0.7, 6); g.fill();
    // cloth with the lamp above
    const cloth = g.createRadialGradient(x0 + w / 2, y0 + h / 2, 10, x0 + w / 2, y0 + h / 2, Math.max(w, h) * 0.7);
    cloth.addColorStop(0, '#1E8A55'); cloth.addColorStop(0.6, '#147044'); cloth.addColorStop(1, '#0C5232');
    g.fillStyle = cloth; g.fillRect(x0, y0, w, h);
    // diamonds
    g.fillStyle = '#F3E3BC';
    const dia = (px, py) => { g.beginPath(); g.ellipse(px, py, 3, 3, 0, 0, Math.PI * 2); g.fill(); };
    for (let k = 1; k < 8; k++) { if (k === 4) continue; const [ax, ay] = toS((P.W / 8) * k, 0); const [bx, by] = toS((P.W / 8) * k, P.H); dia(ax + (G.rot ? -r * 0.68 : 0), ay - (G.rot ? 0 : r * 0.68)); dia(bx + (G.rot ? r * 0.68 : 0), by + (G.rot ? 0 : r * 0.68)); }
    for (let k = 1; k < 4; k++) { const [ax, ay] = toS(0, (P.H / 4) * k); const [bx, by] = toS(P.W, (P.H / 4) * k); dia(ax - (G.rot ? 0 : r * 0.68), ay + (G.rot ? r * 0.68 : 0)); dia(bx + (G.rot ? 0 : r * 0.68), by - (G.rot ? r * 0.68 : 0)); }
    // head string and the kitchen while breaking
    const [hx1, hy1] = toS(P.HEAD_X, 0), [hx2, hy2] = toS(P.HEAD_X, P.H);
    if (s.kitchen && s.ballInHand && s.stage === 'playing') {
      g.fillStyle = 'rgba(255,255,255,.06)';
      const [kx1, ky1] = toS(0, 0); const [kx2, ky2] = toS(P.HEAD_X, P.H);
      g.fillRect(Math.min(kx1, kx2), Math.min(ky1, ky2), Math.abs(kx2 - kx1), Math.abs(ky2 - ky1));
    }
    g.strokeStyle = 'rgba(255,255,255,.16)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(hx1, hy1); g.lineTo(hx2, hy2); g.stroke();
    const [fsx, fsy] = toS(P.FOOT.x, P.FOOT.y); g.fillStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.arc(fsx, fsy, 2.5, 0, Math.PI * 2); g.fill();
    // pockets
    for (const p of P.POCKETS) {
      const [px, py] = toS(p.x, p.y);
      const pr = p.r * G.k * 1.05;
      const rim = g.createRadialGradient(px, py, pr * 0.5, px, py, pr * 1.25);
      rim.addColorStop(0, '#000'); rim.addColorStop(0.75, '#0a0a0a'); rim.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rim; g.beginPath(); g.arc(px, py, pr * 1.25, 0, Math.PI * 2); g.fill();
    }
    // light falloff
    const vig = g.createRadialGradient(x0 + w / 2, y0 + h / 2, Math.min(w, h) * 0.3, x0 + w / 2, y0 + h / 2, Math.max(w, h) * 0.75);
    vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,.28)');
    g.fillStyle = vig; g.fillRect(x0, y0, w, h);
  }

  function drawBall(g, n, x, y, ghostly) {
    const [sx, sy] = toS(x, y);
    const r = P.R * G.k;
    g.save();
    if (ghostly) g.globalAlpha = 0.9;
    g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(sx + r * 0.25, sy + r * 0.35, r, r * 0.85, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.closePath();
    g.save(); g.clip();
    if (n === 0) { g.fillStyle = '#FBF8EE'; g.fill(); }
    else if (n > 8) {
      g.fillStyle = '#FBF8EE'; g.fillRect(sx - r, sy - r, 2 * r, 2 * r);
      g.fillStyle = colorOf(n); if (G.rot) g.fillRect(sx - r * 0.55, sy - r, r * 1.1, 2 * r); else g.fillRect(sx - r, sy - r * 0.55, 2 * r, r * 1.1);
    } else { g.fillStyle = colorOf(n); g.fillRect(sx - r, sy - r, 2 * r, 2 * r); }
    // shading and a highlight
    const sh = g.createRadialGradient(sx - r * 0.35, sy - r * 0.4, r * 0.1, sx, sy, r * 1.05);
    sh.addColorStop(0, 'rgba(255,255,255,.55)'); sh.addColorStop(0.35, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(0,0,0,.38)');
    g.fillStyle = sh; g.fillRect(sx - r, sy - r, 2 * r, 2 * r);
    g.restore();
    if (n > 0) {
      g.fillStyle = '#FBF8EE'; g.beginPath(); g.arc(sx, sy, r * 0.46, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#111'; g.font = `700 ${Math.round(r * 0.62)}px Montserrat, system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(n), sx, sy + 0.5);
    }
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

  window.TableUI.billiards = { size: { land: [1440, 780], port: [440, 920] }, build, render };
})();
