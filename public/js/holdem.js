/* =========================================================
   Texas Hold'em — "The Club Room"
   Draws the table from the server state. Seats sit on an
   ellipse around the felt, you always at the bottom, so the
   same code serves the wide (desktop / tablet) and the
   upright (phone) layouts.
   ========================================================= */
(function () {
  const { card, back, chip, chipsFor, stack, fromCode, fmt, place } = CardUI;
  const PLAYING = ['preflop', 'flop', 'turn', 'river'];
  // Upright layout: keep side seats clear of the board row.
  // Seat angles (k = 0 is you). On a computer the top centre stays free for the dealer;
  // on a phone the dealer stands in the top-left corner instead.
  const PORT_ANGLES = [90, 140, 200, 238, 270, 302, 340, 40];
  const LAND_ANGLES = [90, 140, 180, 215, 250, 290, 335, 20];

  const L = {
    land: { W: 1440, H: 780, table: [160, 96, 1120, 548], cx: 720, cy: 370, rx: 610, ry: 318, me: [720, 706],
      board: { size: 96, gap: 12, y: 296 }, potY: 236, hole: 52, mine: { size: 104, y: 516 }, msgY: 468, label: [720, 660], angles: LAND_ANGLES,
      dealer: { x: 720, y: -6, size: 132 } },
    port: { W: 440, H: 760, table: [28, 58, 384, 600], cx: 220, cy: 352, rx: 168, ry: 300, me: [220, 704],
      board: { size: 54, gap: 6, y: 322 }, potY: 276, hole: 30, mine: { size: 82, y: 560 }, msgY: 432, label: [220, 532], angles: PORT_ANGLES,
      dealer: { x: 40, y: 2, size: 62 } },
  };

  let raiseTouched = false;
  let lastTurnKey = '';
  let pre = null;
  let prevView = null;  // last hand / street, its bets and seat positions (for the chip animations)   // a move chosen in advance: { kind: checkfold | call | callany, hand, amount }

  function build(ctx) {
    const G = L[ctx.layout];
    const t = ctx.h('div', 'table');
    const [x, y, w, hh] = G.table;
    Object.assign(t.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px' });
    t.innerHTML = '<div class="rail"></div><div class="trim"></div><div class="felt"></div><div class="print"></div><div class="monogram">CardGames</div>';
    const layer = ctx.h('div', 'layer');
    layer.id = 'hLayer';
    const fly = ctx.h('div', 'layer fly-layer');   // chips in flight; not cleared by each redraw
    fly.id = 'hFly';
    ctx.stage.append(t, layer, fly);
    buildDealer(ctx, G);

    // Controls (design: action panel)
    ctx.controls.innerHTML = `
      <section class="action-panel" id="hPanel">
        <p class="panel-note" id="hNote"></p>
        <div class="row sizing" id="hSizing">
          <button class="preset" data-preset="min">Min</button>
          <button class="preset" data-preset="half">½ Pot</button>
          <button class="preset" data-preset="threeq">¾ Pot</button>
          <button class="preset" data-preset="pot">Pot</button>
          <button class="preset allin" data-preset="allin">All-in</button>
        </div>
        <div class="row chip-row" id="hChipRow">
          <span class="chip-adds" id="hAdds"></span>
          <input type="range" id="hSlider" aria-label="Raise amount">
        </div>
        <div class="row pre hidden" id="hPre" role="group" aria-label="Choose your move in advance">
          <button class="pre-btn" data-pre="checkfold">Check / Fold</button>
          <button class="pre-btn" data-pre="call">Check</button>
          <button class="pre-btn" data-pre="callany">Call any</button>
        </div>
        <div class="row buttons">
          <button class="act act-fold" id="hFold">Fold</button>
          <button class="act act-call" id="hCall">Check</button>
          <button class="act act-raise" id="hRaise">Raise</button>
          <button class="act act-raise hidden" id="hRebuy">Rebuy</button>
        </div>
      </section>`;
    const $ = (id) => document.getElementById(id);
    const slider = $('hSlider');
    slider.addEventListener('input', () => { raiseTouched = true; setRaise(ctx, +slider.value); });
    ctx.controls.querySelectorAll('.preset').forEach((b) => b.addEventListener('click', () => {
      const st = ctx.st, lim = st.limits;
      if (!lim) return;
      raiseTouched = true;
      const p = b.dataset.preset;
      const potAfterCall = st.pot + lim.toCall;
      setRaise(ctx, p === 'min' ? lim.minTo : p === 'half' ? st.currentBet + potAfterCall / 2 : p === 'threeq' ? st.currentBet + potAfterCall * 0.75
        : p === 'pot' ? st.currentBet + potAfterCall : lim.maxTo);
    }));
    // Chip buttons: each tap adds that chip to the raise.
    $('hAdds').replaceChildren(...[5, 25, 100, 500].map((v) => {
      const b = ctx.h('button', 'chip-add');
      b.dataset.v = v;
      b.setAttribute('aria-label', `Add ${v}`);
      b.appendChild(chip(v, { size: ctx.layout === 'port' ? 34 : 42 }));
      b.onclick = () => {
        const lim = ctx.st.limits;
        if (!lim) return;
        const cur = raiseTouched ? +slider.value : lim.minTo - v;
        raiseTouched = true;
        setRaise(ctx, cur + v);
      };
      return b;
    }));
    $('hFold').onclick = () => ctx.send({ t: 'action', action: 'fold' });
    $('hCall').onclick = () => { const lim = ctx.st.limits; if (lim) ctx.send({ t: 'action', action: lim.toCall > 0 ? 'call' : 'check' }); };
    $('hRaise').onclick = () => ctx.send({ t: 'action', action: 'raise', amount: +slider.value });
    $('hRebuy').onclick = () => ctx.send({ t: 'rebuy' });
    // Pre-select: tap again to cancel.
    ctx.controls.querySelectorAll('.pre-btn').forEach((b) => b.addEventListener('click', () => {
      const st = ctx.st;
      const me = st && st.mySeat !== -1 ? st.seats[st.mySeat] : null;
      if (!me) return;
      const kind = b.dataset.pre;
      pre = pre && pre.kind === kind ? null : { kind, hand: st.handNo, amount: Math.max(0, st.currentBet - (me.bet || 0)) };
      renderControls(st, ctx);
    }));
  }

  function setRaise(ctx, v) {
    const lim = ctx.st.limits;
    const slider = document.getElementById('hSlider');
    if (!lim) return;
    v = Math.max(lim.minTo, Math.min(lim.maxTo, Math.round(v)));
    slider.min = lim.minTo; slider.max = lim.maxTo; slider.step = 1;
    slider.value = v;
    slider.style.setProperty('--p', ((v - lim.minTo) / Math.max(1, lim.maxTo - lim.minTo)) * 100 + '%');
    const me = ctx.st.seats[ctx.st.mySeat];
    const allIn = v >= lim.maxTo && lim.maxTo === lim.bet + me.chips;
    document.getElementById('hRaise').textContent = allIn ? `All-in ${fmt(v)}` : ctx.st.currentBet === 0 ? `Bet ${fmt(v)}` : `Raise to ${fmt(v)}`;
  }

  // Position of seat slot k (0 = you, then clockwise).
  function slot(G, k) {
    if (k === 0) return { plate: G.me };
    const a = (G.angles ? G.angles[k] : 90 + k * 45) * Math.PI / 180;
    const at = (f) => [G.cx + Math.cos(a) * G.rx * f, G.cy + Math.sin(a) * G.ry * f];
    const d = (f, turn) => { const b = a + turn; return [G.cx + Math.cos(b) * G.rx * f, G.cy + Math.sin(b) * G.ry * f]; };
    return { plate: at(1), hole: at(0.74), bet: at(0.52), dealer: d(0.6, 0.22) };
  }

  function render(st, S, ctx) {
    const G = L[ctx.layout];
    const layer = document.getElementById('hLayer');
    layer.replaceChildren();
    const el = ctx.h;
    const port = ctx.layout === 'port';
    const meIdx = st.mySeat === -1 ? 0 : st.mySeat;
    const showdown = st.stage === 'showdown' && st.results;
    const winCards = new Set();
    const winSeats = new Set();
    const betsNow = new Map();
    const platesNow = new Map();
    if (showdown) for (const w of st.results.winners) { winSeats.add(w.seat); (w.cards || []).forEach((c) => winCards.add(c)); }

    // Pot
    if (st.pot) {
      const pot = el('div', 'pot');
      pot.append(stack(st.pot, { size: port ? 28 : 46, maxPer: 8, maxCols: 4, label: false }), el('div', '', `<small>POT</small><strong>${fmt(st.pot)}</strong>`));
      place(pot, 0, G.potY).style.width = G.W + 'px';
      layer.appendChild(pot);
    }

    // Board
    const board = el('div', 'board');
    const bw = 5 * G.board.size + 4 * G.board.gap;
    place(board, (G.W - bw) / 2, G.board.y);
    // After everyone folded, the rest of the board (up to the river) is laid out
    // dimmed: what would have come. It changes nothing about the result.
    const runout = st.runout || [];
    for (let i = 0; i < 5; i++) {
      const c = st.board[i];
      const r = !c ? runout[i - st.board.length] : null;
      const e = c || r ? fromCode(c || r, { size: G.board.size }) : el('div', 'slot');
      if (!c && !r) { e.style.width = G.board.size + 'px'; e.style.height = G.board.size * 1.4 + 'px'; }
      if (c && winCards.has(c)) e.classList.add('win');
      if (r) { e.classList.add('runout'); e.style.animationDelay = `${(i - st.board.length) * 0.25}s`; }
      board.appendChild(e);
    }
    if (runout.length) board.appendChild(el('div', 'runout-note', 'What would have come'));
    layer.appendChild(board);

    // Seats
    st.seats.forEach((s, i) => {
      const k = (i - meIdx + 8) % 8;
      const P = slot(G, k);
      const [px, py] = P.plate;
      if (!s) {
        if (k === 0) return;
        const p = el('div', 'seat empty', `<span class="avatar">+</span>${port ? '' : '<span class="name">Open seat</span>'}`);
        place(p, px, py).style.transform = 'translate(-50%,-50%)';
        layer.appendChild(p);
        return;
      }
      ctx.plates[i] = [px, py - (port ? 30 : 40)];
      platesNow.set(i, [px, py]);
      const inPlay = s.inHand && st.stage !== 'waiting';

      // opponents' hole cards (face down, or face up at showdown)
      if (k !== 0 && inPlay && !s.folded && P.hole) {
        const [hx, hy] = P.hole;
        const cards = s.hole || [null, null];
        cards.slice(0, 2).forEach((c, j) => {
          const e = c ? fromCode(c, { size: G.hole }) : back('holdem', { size: G.hole, skin: (s.skin && s.skin.back) || '' });
          if (c && winCards.has(c)) e.classList.add('win');
          place(e, hx - G.hole * 0.75 + j * G.hole * 0.5, hy - G.hole * 0.7 + j * 2, j ? 6 : -10);
          layer.appendChild(e);
        });
      }
      // bet in front of the seat
      if (s.bet > 0) {
        const b = el('div', 'bet');
        b.append(stack(s.bet, { size: port ? 22 : 36, maxPer: 6, maxCols: 3, set: (s.skin && s.skin.chips) || '' }));
        const [bx, by] = k === 0 ? [G.cx, G.board.y + G.board.size * 1.4 + (port ? 14 : 22)] : P.bet;
        place(b, bx, by).style.transform = 'translate(-50%,-50%)';
        layer.appendChild(b);
        betsNow.set(i, { amount: s.bet, at: [bx, by], set: (s.skin && s.skin.chips) || '' });
      }
      // dealer button
      if (i === st.button && st.stage !== 'waiting') {
        const d = el('div', 'dealer-btn', 'D');
        const [dx, dy] = k === 0 ? [G.me[0] + (port ? 70 : 110), G.me[1] - (port ? 30 : 40)] : P.dealer;
        place(d, dx, dy).style.transform = 'translate(-50%,-50%)';
        layer.appendChild(d);
      }
      // nameplate
      const status = !inPlay ? (s.sitOut ? 'Sitting out' : s.chips === 0 ? 'Out of chips' : fmt(s.chips)) : s.folded ? 'Folded' : s.allIn ? `All-in` : fmt(s.chips);
      const cls = ['seat', k === 0 && 'me', s.folded && inPlay && 'folded', st.toAct === i && 'active', winSeats.has(i) && 'winner', !s.connected && 'away'].filter(Boolean).join(' ');
      const p = el('div', cls,
        `<span class="avatar">${ctx.avatarHtml(s)}</span><span class="col"><span class="name">${ctx.nameHtml(s)}</span><span class="chips">${status}</span></span>`);
      p.title = s.name;
      if (s.hasAccount && !s.isBot) { p.classList.add('clickable'); p.onclick = () => App.openProfile(s.name); }
      place(p, px, py).style.transform = 'translate(-50%,-50%)';
      layer.appendChild(p);
      if (s.lastAction && inPlay) {
        const tag = el('span', 'act-tag', ctx.esc(s.lastAction));
        place(tag, px, py + (port ? 26 : 36)).style.transform = 'translateX(-50%)';
        layer.appendChild(tag);
      }
    });

    // Your cards + hand name
    const me = st.mySeat !== -1 ? st.seats[st.mySeat] : null;
    if (me && me.hole && me.inHand && st.stage !== 'waiting') {
      const sz = G.mine.size;
      me.hole.forEach((c, j) => {
        const e = fromCode(c, { size: sz });
        if (me.folded) e.classList.add('folded-card');
        if (winCards.has(c)) e.classList.add('win');
        place(e, G.cx - sz * 0.95 + j * sz * 0.82, G.mine.y + (j ? 4 : 0), j ? 6 : -8);
        layer.appendChild(e);
      });
      if (me.handName && !me.folded) {
        const lab = el('div', 'hand-label', ctx.esc(me.handName));
        place(lab, port ? G.label[0] : G.cx - sz * 1.9, port ? G.label[1] : G.mine.y + sz * 1.1).style.transform = 'translate(-50%,-50%)';
        layer.appendChild(lab);
      }
    }

    // Centre message
    const msg = message(st, S);
    if (msg) {
      const m = el('div', 'center-msg' + (showdown ? ' result' : ''), ctx.esc(msg));
      place(m, G.cx, G.msgY).style.transform = 'translate(-50%,-50%)';
      layer.appendChild(m);
    }

    animateChips(st, G, port, betsNow, platesNow);
    dealCards(st, G, port, platesNow);
    const tipBtn = document.getElementById('hTip');
    if (tipBtn) tipBtn.hidden = st.mySeat === -1 || !!(S && S.watching) || !!(S && S.tourney);
    renderControls(st, ctx);
  }

  // Chips move like at a real table: the bets slide into the pot when a street
  // ends, and the pot slides to the winner. Display only.
  function animateChips(st, G, port, betsNow, platesNow) {
    const flyLayer = document.getElementById('hFly');
    const prev = prevView;
    prevView = { hand: st.handNo, stage: st.stage, bets: betsNow, plates: platesNow };
    if (!flyLayer || !prev || prev.hand !== st.handNo || prev.stage === st.stage) return;
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const potAt = [G.W / 2 - (port ? 22 : 36), G.potY + (port ? 16 : 26)];
    const flyTo = (amount, from, to, delay, size, set) => {
      const f = document.createElement('div');
      f.className = 'chip-fly';
      f.append(stack(amount, { size, maxPer: 5, maxCols: 2, set }));
      place(f, from[0], from[1]).style.transform = 'translate(-50%,-50%)';
      flyLayer.appendChild(f);
      const dx = to[0] - from[0], dy = to[1] - from[1];
      const a = f.animate([
        { transform: 'translate(-50%,-50%)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`, opacity: 1, offset: 0.85 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.8)`, opacity: 0 },
      ], { duration: 650, delay, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'both' });
      a.onfinish = () => f.remove();
    };
    // 1. the street is over: its bets into the pot
    let delay = 0;
    for (const [, b] of prev.bets) { flyTo(b.amount, b.at, potAt, delay, port ? 22 : 34, b.set); delay += 40; }
    // 2. showdown: the pot to the winner(s)
    if (st.stage === 'showdown' && st.results && prev.stage !== 'showdown') {
      const start = prev.bets.size ? 600 : 150;
      st.results.winners.forEach((w, n) => {
        const to = platesNow.get(w.seat);
        if (to && w.amount > 0) flyTo(w.amount, potAt, to, start + n * 150, port ? 26 : 40);
      });
      if (window.Sound) setTimeout(() => Sound.play('chips'), start + 200);
    }
  }

  // ---------- the dealer: an animated croupier at the top of the table ----------
  const DEALER_SVG = `<svg viewBox="0 0 120 120" aria-hidden="true">
    <defs><linearGradient id="dVest" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1F5C40"/><stop offset="1" stop-color="#0E3324"/></linearGradient>
      <linearGradient id="dHair" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2B2F55"/><stop offset="1" stop-color="#151833"/></linearGradient></defs>
    <g class="d-body">
      <path d="M22 120 Q24 86 60 80 Q96 86 98 120 Z" fill="url(#dVest)"/>
      <path d="M48 82 L60 104 L72 82 Z" fill="#F7F3EA"/>
      <path d="M52 86 L60 92 L68 86 L68 94 L60 90 L52 94 Z" fill="#F2C14E" stroke="#9A7420" stroke-width=".8"/>
      <circle cx="60" cy="100" r="1.6" fill="#C9A45C"/><circle cx="60" cy="108" r="1.6" fill="#C9A45C"/>
      <g class="d-head">
        <rect x="53" y="66" width="14" height="16" rx="6" fill="#F3CDB5"/>
        <ellipse cx="60" cy="50" rx="21" ry="23" fill="#F8DCC8"/>
        <path d="M37 50 Q34 24 58 22 Q86 20 84 50 Q80 36 72 33 Q70 42 62 38 Q58 44 50 38 Q44 44 37 50 Z" fill="url(#dHair)"/>
        <path d="M38 48 Q36 60 40 66 Q39 56 42 48 Z M82 48 Q85 60 80 66 Q82 56 78 48 Z" fill="url(#dHair)"/>
        <g class="d-eyes">
          <ellipse cx="51" cy="53" rx="4.2" ry="5.4" fill="#2A2350"/><ellipse cx="69" cy="53" rx="4.2" ry="5.4" fill="#2A2350"/>
          <circle cx="52.3" cy="51" r="1.6" fill="#fff"/><circle cx="70.3" cy="51" r="1.6" fill="#fff"/>
        </g>
        <path d="M46 46 Q51 43 56 46 M64 46 Q69 43 74 46" stroke="#1C1F3D" stroke-width="1.6" fill="none" stroke-linecap="round"/>
        <path class="d-mouth" d="M55 63 Q60 66.5 65 63" stroke="#B5525A" stroke-width="1.8" fill="none" stroke-linecap="round"/>
        <ellipse cx="45" cy="60" rx="3.5" ry="1.8" fill="#F4A7A7" opacity=".55"/><ellipse cx="75" cy="60" rx="3.5" ry="1.8" fill="#F4A7A7" opacity=".55"/>
      </g>
    </g>
    <g class="d-arm d-arm-l"><path d="M30 106 Q18 112 22 120 L36 120 Z" fill="#163F2C"/><ellipse cx="26" cy="116" rx="7" ry="4.5" fill="#F8DCC8"/></g>
    <g class="d-arm d-arm-r"><path d="M90 106 Q102 112 98 120 L84 120 Z" fill="#163F2C"/><ellipse cx="94" cy="116" rx="7" ry="4.5" fill="#F8DCC8"/></g>
  </svg>`;
  const THANKS = ['Thank you!', 'Much appreciated!', 'Good luck at the table!', 'May the river be kind!', 'You are too generous!'];
  let lastDealtHand = 0;

  function buildDealer(ctx, G) {
    const D = G.dealer;
    const d = ctx.h('div', 'dealer-figure');
    d.id = 'hDealer';
    d.innerHTML = DEALER_SVG + '<span class="d-bubble"></span>';
    Object.assign(d.style, { left: D.x - D.size / 2 + 'px', top: D.y + 'px', width: D.size + 'px', height: D.size + 'px' });
    // tipping: seated players only
    const tip = ctx.h('button', 'tip-btn', '💰');
    tip.id = 'hTip';
    tip.title = 'Tip the dealer';
    tip.setAttribute('aria-label', 'Tip the dealer');
    Object.assign(tip.style, { left: D.x + D.size * 0.42 + 'px', top: D.y + D.size * 0.5 + 'px' });
    tip.onclick = (e) => { e.stopPropagation(); tipMenu(ctx, tip); };
    ctx.stage.append(d, tip);
  }
  function tipMenu(ctx, anchor) {
    document.querySelectorAll('.tip-menu').forEach((x) => x.remove());
    const st = ctx.st;
    const bb = st.settings.bigBlind;
    const menu = ctx.h('div', 'tip-menu');
    menu.innerHTML = `<b>Tip the dealer</b><small>🐷 goes into the piggy bank</small>${[1, 5, 25].map((x) => `<button data-a="${bb * x}">${fmt(bb * x)}</button>`).join('')}`;
    menu.querySelectorAll('button').forEach((b) => { b.onclick = () => { ctx.send({ t: 'tip', amount: Number(b.dataset.a) }); menu.remove(); }; });
    const r = anchor.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(window.innerWidth - 220, r.left - 80)) + 'px';
    menu.style.top = r.bottom + 8 + 'px';
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', function close(ev) { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', close); } }), 0);
  }
  function dealerSay(text, ms = 2600) {
    const d = document.getElementById('hDealer');
    if (!d) return;
    const b = d.querySelector('.d-bubble');
    b.textContent = text;
    d.classList.add('talking');
    clearTimeout(dealerSay.t);
    dealerSay.t = setTimeout(() => d.classList.remove('talking'), ms);
  }
  // Someone tipped: their chip flies to the dealer, the dealer bows and says thank you.
  function onTip(m, ctx) {
    const G = L[ctx.layout];
    const d = document.getElementById('hDealer');
    const fly = document.getElementById('hFly');
    const from = prevView && prevView.plates.get(m.seat);
    if (fly && from && d) {
      const f = document.createElement('div');
      f.className = 'chip-fly';
      f.append(stack(m.amount, { size: ctx.layout === 'port' ? 24 : 36, maxPer: 4, maxCols: 2, label: false }));
      place(f, from[0], from[1]).style.transform = 'translate(-50%,-50%)';
      fly.appendChild(f);
      const to = [G.dealer.x, G.dealer.y + G.dealer.size * 0.75];
      const a = f.animate([{ transform: 'translate(-50%,-50%)', opacity: 1 }, { transform: `translate(calc(-50% + ${to[0] - from[0]}px), calc(-50% + ${to[1] - from[1]}px)) scale(.7)`, opacity: 0 }],
        { duration: 800, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'both' });
      a.onfinish = () => f.remove();
    }
    if (d) {
      d.classList.remove('bow'); void d.offsetWidth; d.classList.add('bow');
      setTimeout(() => d.classList.remove('bow'), 1300);
    }
    setTimeout(() => dealerSay(`${THANKS[Math.floor(Math.random() * THANKS.length)]} ♥`), 500);
  }
  // A new hand: the dealer's hand moves and two cards fly to every player.
  function dealCards(st, G, port, platesNow) {
    if (st.handNo === lastDealtHand || st.stage !== 'preflop') return;
    lastDealtHand = st.handNo;
    const d = document.getElementById('hDealer');
    const fly = document.getElementById('hFly');
    if (!d || !fly || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    d.classList.remove('dealing'); void d.offsetWidth; d.classList.add('dealing');
    setTimeout(() => d.classList.remove('dealing'), 1600);
    const from = [G.dealer.x, G.dealer.y + G.dealer.size * 0.85];
    const meIdx = st.mySeat === -1 ? 0 : st.mySeat;
    const order = [];
    st.seats.forEach((s, i) => { if (s && s.inHand) order.push(i); });
    let n = 0;
    for (let round = 0; round < 2; round++) for (const i of order) {
      const k = (i - meIdx + 8) % 8;
      const to = k === 0 ? [G.cx, G.mine.y + G.mine.size * 0.5] : (slot(G, k).hole || platesNow.get(i));
      if (!to) continue;
      const c = back('holdem', { size: port ? 26 : 44, skin: (st.seats[i].skin && st.seats[i].skin.back) || '' });
      c.classList.add('deal-fly');
      place(c, from[0], from[1]).style.transform = 'translate(-50%,-50%)';
      fly.appendChild(c);
      const a = c.animate([
        { transform: 'translate(-50%,-50%) rotate(0deg)', opacity: 1 },
        { transform: `translate(calc(-50% + ${to[0] - from[0]}px), calc(-50% + ${to[1] - from[1]}px)) rotate(${360 + (k - 4) * 6}deg)`, opacity: 1, offset: 0.9 },
        { transform: `translate(calc(-50% + ${to[0] - from[0]}px), calc(-50% + ${to[1] - from[1]}px)) rotate(${360 + (k - 4) * 6}deg)`, opacity: 0 },
      ], { duration: 420, delay: n * 90, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both' });
      a.onfinish = () => c.remove();
      n++;
    }
  }

  function message(st) {
    const name = (i) => (st.seats[i] ? st.seats[i].name : 'A player');
    if (st.stage === 'waiting') {
      const n = st.seats.filter((s) => s && s.chips > 0).length;
      return n < 2 ? 'Waiting for another player — invite a friend or a bot' : 'The next hand is about to be dealt…';
    }
    if (st.stage === 'showdown' && st.results) {
      return st.results.winners.map((w) => `${name(w.seat)} wins ${fmt(w.amount)}${w.hand ? ' with ' + w.hand : ''}`).join(' · ');
    }
    return '';
  }

  function renderControls(st, ctx) {
    const $ = (id) => document.getElementById(id);
    const lim = st.limits;
    const me = st.mySeat !== -1 ? st.seats[st.mySeat] : null;
    const myTurn = !!lim;
    const turnKey = myTurn ? `${st.handNo}:${st.stage}:${st.currentBet}` : '';
    if (turnKey && turnKey !== lastTurnKey) raiseTouched = false;
    lastTurnKey = turnKey;
    const canRebuy = me && me.chips === 0 && !(me.inHand && PLAYING.includes(st.stage));
    $('hRebuy').classList.toggle('hidden', !canRebuy);
    ['hFold', 'hCall', 'hRaise'].forEach((id) => $(id).classList.toggle('hidden', !!canRebuy));
    $('hSizing').classList.toggle('hidden', !!canRebuy);
    $('hChipRow').classList.toggle('hidden', !!canRebuy);
    $('hPanel').classList.toggle('my-turn', myTurn);
    // Not your turn yet, but still in the hand: offer a move in advance.
    const waiting = !!(me && me.inHand && !me.folded && !me.allIn && PLAYING.includes(st.stage) && !myTurn && !canRebuy);
    if (pre && pre.hand !== st.handNo) pre = null;
    const toCallNow = me ? Math.max(0, st.currentBet - (me.bet || 0)) : 0;
    if (pre && pre.kind === 'call' && waiting && pre.amount !== toCallNow) pre = null;   // the bet changed: ask again
    $('hPanel').classList.toggle('waiting', waiting);
    $('hPre').classList.toggle('hidden', !waiting);
    if (waiting) {
      const callBtn = $('hPre').querySelector('[data-pre=call]');
      callBtn.textContent = toCallNow ? `Call ${fmt(Math.min(toCallNow, me.chips))}` : 'Check';
      $('hPre').querySelector('[data-pre=checkfold]').textContent = toCallNow ? 'Fold' : 'Check / Fold';
      $('hPre').querySelectorAll('.pre-btn').forEach((b) => b.classList.toggle('on', !!pre && pre.kind === b.dataset.pre));
    }
    // Your turn and a move was chosen in advance: play it.
    if (myTurn && pre && pre.hand === st.handNo) {
      const p = pre;
      pre = null;
      const move = p.kind === 'checkfold' ? (lim.toCall > 0 ? 'fold' : 'check')
        : p.kind === 'callany' ? (lim.toCall > 0 ? 'call' : 'check')
          : lim.toCall === p.amount ? (lim.toCall > 0 ? 'call' : 'check') : null;
      if (move) setTimeout(() => { if (ctx.st && ctx.st.limits && ctx.st.handNo === p.hand) ctx.send({ t: 'action', action: move }); }, 250);
    }
    $('hPanel').querySelectorAll('#hSizing button, #hChipRow button, #hChipRow input, #hFold, #hCall, #hRaise').forEach((b) => { b.disabled = !myTurn; });
    let note = '';
    if (canRebuy) note = App.account ? 'You are out of chips at this table. Rebuy from your bankroll.' : 'You are out of chips. Rebuy for a fresh stack.';
    else if (myTurn) note = 'Your move.';
    else if (me && me.inHand && me.folded && PLAYING.includes(st.stage)) note = 'You folded — wait for the next hand.';
    else if (PLAYING.includes(st.stage) && st.toAct !== -1 && st.seats[st.toAct]) note = `${st.seats[st.toAct].name} is thinking…`;
    else if (me && !me.inHand && PLAYING.includes(st.stage)) note = 'You are dealt in from the next hand.';
    $('hNote').textContent = note;
    if (!myTurn) { $('hCall').textContent = 'Check'; $('hRaise').textContent = 'Raise'; return; }
    $('hFold').disabled = lim.toCall === 0;
    $('hCall').textContent = lim.toCall === 0 ? 'Check' : lim.toCall >= me.chips ? `All-in ${fmt(lim.toCall)}` : `Call ${fmt(lim.toCall)}`;
    const raiseOk = lim.canRaise && me.chips > lim.toCall;
    $('hRaise').disabled = !raiseOk;
    $('hPanel').querySelectorAll('#hSizing button, #hChipRow button, #hChipRow input').forEach((b) => { b.disabled = !raiseOk; });
    if (raiseOk) setRaise(ctx, raiseTouched ? +$('hSlider').value : lim.minTo);
    else $('hRaise').textContent = 'Raise';
  }

  // Keyboard: F fold · C check/call · R raise
  document.addEventListener('keydown', (e) => {
    if (!window.App || App.game !== 'holdem' || !App.S || !App.S.state.limits) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
    const k = e.key.toLowerCase();
    const b = { f: 'hFold', c: 'hCall', r: 'hRaise' }[k];
    if (b && !document.getElementById(b).disabled) document.getElementById(b).click();
  });

  window.TableUI.holdem = { size: { land: [1440, 780], port: [440, 760] }, build, render, onTip };
})();
