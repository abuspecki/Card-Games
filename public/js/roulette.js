/* =========================================================
   Roulette — "The Wheel Room"
   European wheel on the left (on top on phones), the betting
   layout beside it. Pick a chip, tap the layout to bet; everyone
   bets at once until the clock runs out, then the wheel spins.
   ========================================================= */
(function () {
  const { chip, stack, fmt, place } = CardUI;
  const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const color = (n) => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black');
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const COVERS = {
    red: range(1, 36).filter((n) => REDS.has(n)), black: range(1, 36).filter((n) => !REDS.has(n)),
    even: range(1, 36).filter((n) => n % 2 === 0), odd: range(1, 36).filter((n) => n % 2), low: range(1, 18), high: range(19, 36),
    dozen1: range(1, 12), dozen2: range(13, 24), dozen3: range(25, 36),
    col1: range(1, 36).filter((n) => n % 3 === 1), col2: range(1, 36).filter((n) => n % 3 === 2), col3: range(1, 36).filter((n) => n % 3 === 0),
  };
  const covers = (spot, n) => (spot[0] === 'n' ? Number(spot.slice(1)) === n : (COVERS[spot] || []).includes(n));

  const L = {
    land: { W: 1440, H: 780, wheel: { cx: 300, cy: 400, r: 230 }, board: { x: 600, y: 170, cw: 58, ch: 74 } },
    port: { W: 440, H: 920, wheel: { cx: 220, cy: 114, r: 96 }, board: { x: 16, y: 252, cw: 92, ch: 38 } },
  };

  let chipValue = 5;
  let wheelRot = 0;
  let ballRot = 0;
  let spunFor = 0;       // spin number the wheel last animated
  let clock = null;
  let deadlineAt = 0;

  // ---------- cells of the betting layout ----------
  function cells(layout) {
    const B = L[layout].board;
    const out = [];
    if (layout === 'land') {
      const { x, y, cw, ch } = B;
      out.push({ spot: 'n0', label: '0', cls: 'green', x, y, w: cw, h: ch * 3 });
      for (let c = 0; c < 12; c++) for (let r = 0; r < 3; r++) {
        const n = 3 * (c + 1) - r;
        out.push({ spot: 'n' + n, label: String(n), cls: color(n), x: x + cw * (c + 1), y: y + ch * r, w: cw, h: ch });
      }
      ['col3', 'col2', 'col1'].forEach((s, r) => out.push({ spot: s, label: '2 : 1', cls: 'out', x: x + cw * 13, y: y + ch * r, w: cw, h: ch }));
      ['dozen1', 'dozen2', 'dozen3'].forEach((s, k) => out.push({ spot: s, label: ['1st 12', '2nd 12', '3rd 12'][k], cls: 'out', x: x + cw * (1 + 4 * k), y: y + ch * 3, w: cw * 4, h: 56 }));
      [['low', '1–18'], ['even', 'Even'], ['red', ''], ['black', ''], ['odd', 'Odd'], ['high', '19–36']].forEach(([s, label], k) =>
        out.push({ spot: s, label, cls: 'out ' + s, x: x + cw * (1 + 2 * k), y: y + ch * 3 + 56, w: cw * 2, h: 56 }));
    } else {
      const { x, y, cw, ch } = B;
      const nx = x + 48;                     // numbers start after the dozens column
      out.push({ spot: 'n0', label: '0', cls: 'green', x: nx, y, w: cw * 3, h: ch });
      for (let r = 0; r < 12; r++) for (let c = 0; c < 3; c++) {
        const n = 3 * r + c + 1;
        out.push({ spot: 'n' + n, label: String(n), cls: color(n), x: nx + cw * c, y: y + ch * (r + 1), w: cw, h: ch });
      }
      ['col1', 'col2', 'col3'].forEach((s, c) => out.push({ spot: s, label: '2 : 1', cls: 'out', x: nx + cw * c, y: y + ch * 13, w: cw, h: ch }));
      ['dozen1', 'dozen2', 'dozen3'].forEach((s, k) => out.push({ spot: s, label: ['1st', '2nd', '3rd'][k] + ' 12', cls: 'out vert', x, y: y + ch * (1 + 4 * k), w: 48, h: ch * 4 }));
      [['low', '1–18'], ['even', 'Even'], ['red', ''], ['black', ''], ['odd', 'Odd'], ['high', '19–36']].forEach(([s, label], k) =>
        out.push({ spot: s, label, cls: 'out vert ' + s, x: nx + cw * 3, y: y + ch * (1 + 2 * k), w: 52, h: ch * 2 }));
    }
    return out;
  }

  // ---------- the wheel (SVG, built once) ----------
  function wheelSvg(r) {
    const n = WHEEL.length;
    const a = 360 / n;
    const pt = (deg, rad) => { const t = (deg - 90) * Math.PI / 180; return [r + Math.cos(t) * rad, r + Math.sin(t) * rad]; };
    let s = `<svg viewBox="0 0 ${2 * r} ${2 * r}" width="${2 * r}" height="${2 * r}" aria-hidden="true">`;
    s += `<circle cx="${r}" cy="${r}" r="${r}" fill="url(#rimG)"/>`;
    s += `<defs><radialGradient id="rimG"><stop offset="80%" stop-color="#3B2A12"/><stop offset="92%" stop-color="#7A5A22"/><stop offset="100%" stop-color="#2A1D0A"/></radialGradient>
      <radialGradient id="hubG"><stop offset="0%" stop-color="#F6E3A6"/><stop offset="55%" stop-color="#C9A040"/><stop offset="100%" stop-color="#6E5418"/></radialGradient></defs>`;
    const R1 = r * 0.9, R2 = r * 0.62;
    WHEEL.forEach((num, i) => {
      const a0 = i * a - a / 2, a1 = i * a + a / 2;
      const [x0, y0] = pt(a0, R1), [x1, y1] = pt(a1, R1), [x2, y2] = pt(a1, R2), [x3, y3] = pt(a0, R2);
      const fill = num === 0 ? '#1B7A47' : REDS.has(num) ? '#A3202C' : '#121614';
      s += `<path d="M${x0},${y0} A${R1},${R1} 0 0 1 ${x1},${y1} L${x2},${y2} A${R2},${R2} 0 0 0 ${x3},${y3} Z" fill="${fill}" stroke="#C9A040" stroke-width="1"/>`;
      const [tx, ty] = pt(i * a, (R1 + R2) / 2 + r * 0.06);
      s += `<text x="${tx}" y="${ty}" transform="rotate(${i * a} ${tx} ${ty})" text-anchor="middle" dominant-baseline="middle" font-size="${r * 0.085}" fill="#F3E9CC" font-family="Cormorant Garamond, Georgia, serif" font-weight="700">${num}</text>`;
    });
    s += `<circle cx="${r}" cy="${r}" r="${R2}" fill="#0E3A25" stroke="#C9A040" stroke-width="2"/>`;
    s += `<circle cx="${r}" cy="${r}" r="${r * 0.36}" fill="none" stroke="rgba(201,160,64,.5)" stroke-width="1"/>`;
    for (let k = 0; k < 8; k++) { const [x, y] = pt(k * 45, r * 0.5); s += `<line x1="${r}" y1="${r}" x2="${x}" y2="${y}" stroke="#C9A040" stroke-width="${r * 0.025}" stroke-linecap="round"/>`; }
    s += `<circle cx="${r}" cy="${r}" r="${r * 0.14}" fill="url(#hubG)"/></svg>`;
    return s;
  }

  function build(ctx) {
    const G = L[ctx.layout];
    const W = G.wheel;
    const felt = ctx.h('div', 'r-felt');
    const wheel = ctx.h('div', 'r-wheel');
    Object.assign(wheel.style, { left: W.cx - W.r + 'px', top: W.cy - W.r + 'px', width: 2 * W.r + 'px', height: 2 * W.r + 'px' });
    wheel.innerHTML = `<div class="r-disc" id="rDisc">${wheelSvg(W.r)}</div><div class="r-ballring" id="rBall"><i style="top:${W.r * 0.1}px"></i></div><div class="r-pointer"></div>`;
    const board = ctx.h('div', 'r-board');
    board.id = 'rBoard';
    for (const c of cells(ctx.layout)) {
      const b = ctx.h('button', 'r-cell ' + c.cls, c.label ? `<span>${c.label}</span>` : '<span class="diamond"></span>');
      b.dataset.spot = c.spot;
      Object.assign(b.style, { left: c.x + 'px', top: c.y + 'px', width: c.w + 'px', height: c.h + 'px' });
      b.setAttribute('aria-label', `Bet on ${c.label || c.spot}`);
      b.onclick = () => placeOn(ctx, c.spot);
      b.onmouseenter = () => hover(c.spot, true);
      b.onmouseleave = () => hover(c.spot, false);
      board.appendChild(b);
    }
    const layer = ctx.h('div', 'layer');
    layer.id = 'rLayer';
    const hist = ctx.h('div', 'r-history');
    hist.id = 'rHistory';
    const status = ctx.h('div', 'r-status');
    status.id = 'rStatus';
    if (ctx.layout === 'land') {
      place(hist, G.board.x, 92);
      place(status, W.cx, 96).style.transform = 'translateX(-50%)';
    } else {
      place(hist, 16, 8);
      place(status, 220, 232).style.transform = 'translate(-50%,-50%)';
      hist.classList.add('port');
    }
    ctx.stage.append(felt, wheel, board, layer, hist, status);
    // keep the wheel where it was if the layout is rebuilt
    document.getElementById('rDisc').style.transform = `rotate(${wheelRot}deg)`;
    document.getElementById('rBall').style.transform = `rotate(${ballRot}deg)`;

    ctx.controls.innerHTML = `
      <section class="r-bar" id="rBar">
        <div class="col info"><small>Your bets</small><strong id="rBet">0</strong><em id="rAvail"></em></div>
        <div class="r-chips" id="rChips"></div>
        <div class="r-buttons">
          <button class="pill" id="rUndo">Undo</button><button class="pill" id="rClear">Clear</button>
          <button class="pill" id="rRepeat">Repeat</button><button class="pill" id="rDouble">×2</button>
          <button class="btn r-spin" id="rReady">Spin</button>
          <button class="btn r-spin hidden" id="rRebuy">Rebuy</button>
        </div>
      </section>`;
    const $ = (id) => document.getElementById(id);
    // chips from 5 to 5,000; those outside the table's limits are hidden
    $('rChips').replaceChildren(...[5, 25, 100, 500, 1000, 5000].map((v) => {
      const b = ctx.h('button', 'r-chip');
      b.dataset.v = v;
      b.setAttribute('aria-label', `Bet ${v} per tap`);
      b.appendChild(chip(v, { size: ctx.layout === 'port' ? 40 : 50 }));
      b.onclick = () => { chipValue = v; paintChips(ctx); };
      return b;
    }));
    const act = (action) => () => ctx.send({ t: 'action', action });
    $('rUndo').onclick = act('undo');
    $('rClear').onclick = act('clear');
    $('rRepeat').onclick = act('repeat');
    $('rDouble').onclick = act('double');
    $('rReady').onclick = act('ready');
    $('rRebuy').onclick = () => ctx.send({ t: 'rebuy' });
  }

  function placeOn(ctx, spot) {
    const st = ctx.st;
    if (!st || !st.limits) {
      if (st && st.stage === 'spinning') ctx.toast('No more bets — the wheel is spinning');
      return;
    }
    ctx.send({ t: 'action', action: 'bet', amount: { spot, amount: chipValue } });
  }

  function hover(spot, on) {
    if (spot[0] === 'n') return;
    document.querySelectorAll('.r-cell').forEach((c) => {
      const s = c.dataset.spot;
      if (s[0] === 'n') c.classList.toggle('lit', on && covers(spot, Number(s.slice(1))));
    });
  }

  function paintChips(ctx) {
    const lim = ctx.st && ctx.st.limits;
    document.querySelectorAll('.r-chip').forEach((b) => {
      const v = Number(b.dataset.v);
      b.classList.toggle('on', v === chipValue);
      b.disabled = !!lim && (v < lim.minBet || v > lim.available);
      const min = (ctx.st && ctx.st.minBet) || 5, max = (ctx.st && ctx.st.maxSpot) || 500;
      b.hidden = v < min || v > max;
    });
  }

  // ---------- wheel animation ----------
  function spin(st, ctx) {
    const disc = document.getElementById('rDisc');
    const ball = document.getElementById('rBall');
    if (!disc) return;
    const a = 360 / 37;
    const idx = WHEEL.indexOf(st.number);
    const ms = Math.max(1500, st.msLeft || 5000);
    // wheel turns clockwise; the winning pocket ends under the ball at the top
    const target = -idx * a;
    let next = wheelRot + 360 * 4;
    next += ((target - next) % 360 + 360) % 360;
    wheelRot = next;
    ballRot = ballRot - 360 * 6 - (((ballRot % 360) + 360) % 360);
    disc.style.transition = `transform ${ms}ms cubic-bezier(.12,.6,.18,1)`;
    ball.style.transition = `transform ${ms * 0.92}ms cubic-bezier(.2,.65,.25,1)`;
    disc.classList.remove('idle');
    requestAnimationFrame(() => {
      disc.style.transform = `rotate(${wheelRot}deg)`;
      ball.style.transform = `rotate(${ballRot}deg)`;
    });
  }

  function render(st, S, ctx) {
    const G = L[ctx.layout];
    const $ = (id) => document.getElementById(id);
    const layer = $('rLayer');
    layer.replaceChildren();
    const el = ctx.h;
    const me = st.mySeat !== -1 ? st.seats[st.mySeat] : null;

    // spin once per round, as soon as the number is known
    if (st.stage === 'spinning' && st.number !== null && spunFor !== st.handNo) { spunFor = st.handNo; spin(st, ctx); }
    if (st.stage === 'showdown' && spunFor !== st.handNo && st.number !== null) {
      // joined during the result: show it without the long spin
      spunFor = st.handNo;
      const a = 360 / 37;
      wheelRot = -WHEEL.indexOf(st.number) * a; ballRot = 0;
      $('rDisc').style.transition = 'none'; $('rBall').style.transition = 'none';
      $('rDisc').style.transform = `rotate(${wheelRot}deg)`; $('rBall').style.transform = 'rotate(0deg)';
    }

    // chips on the layout: yours as a stack, everyone else's as one small chip
    const mine = {};
    const others = {};
    st.seats.forEach((s, i) => {
      if (!s) return;
      for (const b of s.bets || []) {
        const into = i === st.mySeat ? mine : others;
        into[b.spot] = (into[b.spot] || 0) + b.amount;
      }
    });
    const showdown = st.stage === 'showdown' && st.number !== null;
    document.querySelectorAll('.r-cell').forEach((c) => {
      const s = c.dataset.spot;
      c.classList.toggle('win', showdown && covers(s, st.number));
      c.classList.toggle('has-mine', !!mine[s]);
    });
    for (const c of cells(ctx.layout)) {
      const lowSpot = ctx.layout === 'port' && c.cls.includes('vert');
      const cx = c.x + c.w / 2, cy = lowSpot ? c.y + c.h - 14 : c.y + c.h / 2;
      if (others[c.spot]) {
        const o = chip(others[c.spot] >= 100 ? 100 : others[c.spot] >= 25 ? 25 : 5, { size: ctx.layout === 'port' ? 16 : 22 });
        o.classList.add('r-other');
        o.title = `Other players: ${fmt(others[c.spot])}`;
        place(o, cx + (mine[c.spot] ? (ctx.layout === 'port' ? 14 : 18) : 0), cy - (mine[c.spot] ? 10 : 0)).style.transform = 'translate(-50%,-50%)';
        layer.appendChild(o);
      }
      if (mine[c.spot]) {
        const sk = stack(mine[c.spot], { size: ctx.layout === 'port' ? 22 : 30, maxPer: 5, maxCols: 2 });
        sk.classList.add('r-mine');
        if (showdown) sk.classList.add(covers(c.spot, st.number) ? 'won' : 'lost');
        place(sk, cx, cy).style.transform = 'translate(-50%,-62%)';
        layer.appendChild(sk);
      }
    }

    // players: a small row of name plates
    const plates = el('div', 'r-players');
    let k = 0;
    st.seats.forEach((s, i) => {
      if (!s) return;
      ctx.plates[i] = ctx.layout === 'land' ? [G.board.x + 70 + (k % 6) * 132, 640] : [60 + (k % 4) * 100, 792];
      k++;
      const p = el('div', 'r-plate' + (i === st.mySeat ? ' me' : '') + (s.ready && st.stage === 'betting' ? ' ready' : '') + (showdown && st.results.winners.some((w) => w.seat === i) ? ' winner' : ''),
        `<span class="avatar">${ctx.avatarHtml(s)}</span><span class="col"><span class="name">${ctx.nameHtml(s)}</span><span class="chips">${fmt(s.chips - (st.stage === 'betting' ? s.bet : 0))}${s.bet ? ` · bets ${fmt(s.bet)}` : ''}</span></span>`);
      if (s.hasAccount && !s.isBot) { p.classList.add('clickable'); p.onclick = () => App.openProfile(s.name); }
      plates.appendChild(p);
    });
    if (ctx.layout === 'land') place(plates, G.board.x, 648); else place(plates, 16, 796);
    layer.appendChild(plates);

    // winning number in the middle of the wheel
    if (showdown) {
      const res = el('div', 'r-result ' + st.results.color, `<b>${st.number}</b><small>${st.results.color === 'green' ? 'zero' : st.results.color}</small>`);
      place(res, G.wheel.cx, G.wheel.cy).style.transform = 'translate(-50%,-50%)';
      layer.appendChild(res);
    }

    // history
    $('rHistory').innerHTML = (st.history || []).map((n, k) => `<span class="h ${color(n)}${k === 0 && showdown ? ' last' : ''}">${n}</span>`).join('') || '<em>The wheel awaits its first spin</em>';

    renderStatus(st, ctx);
    renderControls(st, ctx);
  }

  function renderStatus(st, ctx) {
    const box = document.getElementById('rStatus');
    clearInterval(clock);
    const me = st.mySeat !== -1 ? st.seats[st.mySeat] : null;
    if (st.stage === 'betting') {
      deadlineAt = Date.now() + (st.msLeft || 0);
      const paint = () => {
        const s = Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000));
        box.innerHTML = `<small>Place your bets</small><b class="${s <= 5 ? 'soon' : ''}">${s}s</b>`;
      };
      paint();
      clock = setInterval(paint, 250);
    } else if (st.stage === 'spinning') {
      box.innerHTML = '<small>No more bets</small><b>Rien ne va plus</b>';
    } else if (st.stage === 'showdown' && st.results) {
      const w = me && st.results.winners.find((x) => x.seat === st.mySeat);
      box.innerHTML = `<small>${st.number} ${st.results.color === 'green' ? 'zero' : st.results.color}</small><b>${w ? `You win ${fmt(w.amount)}` : me && me.inHand ? 'The house takes this one' : 'Next spin shortly'}</b>`;
    } else {
      box.innerHTML = `<small>The Wheel Room</small><b>${st.seats.filter(Boolean).length ? 'The croupier is ready' : 'Take a seat'}</b>`;
    }
  }

  function renderControls(st, ctx) {
    const $ = (id) => document.getElementById(id);
    const lim = st.limits;
    const me = st.mySeat !== -1 ? st.seats[st.mySeat] : null;
    const betting = !!lim;
    const canRebuy = me && me.chips < st.minBet && !(me.inHand && st.stage === 'spinning') && !(me.bets && me.bets.length);
    if (lim && chipValue < lim.minBet) chipValue = lim.minBet <= 5 ? 5 : lim.minBet <= 25 ? 25 : 100;
    $('rBet').textContent = fmt(me ? me.bet : 0);
    $('rAvail').textContent = me ? `${fmt(lim ? lim.available : me.chips)} chips free` : '';
    $('rRebuy').classList.toggle('hidden', !canRebuy);
    $('rReady').classList.toggle('hidden', !!canRebuy);
    $('rUndo').disabled = !betting || !me.bets.length;
    $('rClear').disabled = !betting || !me.bets.length;
    $('rRepeat').disabled = !betting || !lim.canRepeat;
    $('rDouble').disabled = !betting || !me.bets.length || me.bet > lim.available;
    $('rReady').disabled = !betting || !me.bets.length || lim.ready;
    $('rReady').textContent = lim && lim.ready ? 'Waiting…' : 'Spin';
    $('rBar').classList.toggle('my-turn', betting);
    paintChips(ctx);
  }

  window.TableUI.roulette = { size: { land: [1440, 780], port: [440, 920] }, build, render, dealer: { land: { x: 100, y: 28, size: 124 }, port: { x: 56, y: 40, size: 74 } } };
})();
