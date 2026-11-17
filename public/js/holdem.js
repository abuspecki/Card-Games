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
  const PORT_ANGLES = [90, 140, 200, 238, 270, 302, 340, 40];

  const L = {
    land: { W: 1440, H: 780, table: [160, 96, 1120, 548], cx: 720, cy: 370, rx: 610, ry: 318, me: [720, 706],
      board: { size: 96, gap: 12, y: 296 }, potY: 236, hole: 52, mine: { size: 104, y: 516 }, msgY: 468, label: [720, 660] },
    port: { W: 440, H: 760, table: [28, 58, 384, 600], cx: 220, cy: 352, rx: 168, ry: 300, me: [220, 704],
      board: { size: 54, gap: 6, y: 322 }, potY: 276, hole: 30, mine: { size: 82, y: 560 }, msgY: 432, label: [220, 532], angles: PORT_ANGLES },
  };

  let raiseTouched = false;
  let lastTurnKey = '';

  function build(ctx) {
    const G = L[ctx.layout];
    const t = ctx.h('div', 'table');
    const [x, y, w, hh] = G.table;
    Object.assign(t.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px' });
    t.innerHTML = '<div class="rail"></div><div class="trim"></div><div class="felt"></div><div class="print"></div><div class="monogram">CardGames</div>';
    const layer = ctx.h('div', 'layer');
    layer.id = 'hLayer';
    ctx.stage.append(t, layer);

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
    for (let i = 0; i < 5; i++) {
      const c = st.board[i];
      const e = c ? fromCode(c, { size: G.board.size }) : el('div', 'slot');
      if (!c) { e.style.width = G.board.size + 'px'; e.style.height = G.board.size * 1.4 + 'px'; }
      if (c && winCards.has(c)) e.classList.add('win');
      board.appendChild(e);
    }
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
      const inPlay = s.inHand && st.stage !== 'waiting';

      // opponents' hole cards (face down, or face up at showdown)
      if (k !== 0 && inPlay && !s.folded && P.hole) {
        const [hx, hy] = P.hole;
        const cards = s.hole || [null, null];
        cards.slice(0, 2).forEach((c, j) => {
          const e = c ? fromCode(c, { size: G.hole }) : back('holdem', { size: G.hole });
          if (c && winCards.has(c)) e.classList.add('win');
          place(e, hx - G.hole * 0.75 + j * G.hole * 0.5, hy - G.hole * 0.7 + j * 2, j ? 6 : -10);
          layer.appendChild(e);
        });
      }
      // bet in front of the seat
      if (s.bet > 0) {
        const b = el('div', 'bet');
        b.append(stack(s.bet, { size: port ? 22 : 36, maxPer: 6, maxCols: 3 }));
        const [bx, by] = k === 0 ? [G.cx, G.board.y + G.board.size * 1.4 + (port ? 14 : 22)] : P.bet;
        place(b, bx, by).style.transform = 'translate(-50%,-50%)';
        layer.appendChild(b);
      }
      // dealer button
      if (i === st.button && st.stage !== 'waiting') {
        const d = el('div', 'dealer-btn', 'D');
        const [dx, dy] = k === 0 ? [G.me[0] + (port ? 70 : 110), G.me[1] - (port ? 30 : 40)] : P.dealer;
        place(d, dx, dy).style.transform = 'translate(-50%,-50%)';
        layer.appendChild(d);
      }
      // nameplate
      const status = !inPlay ? (s.chips === 0 ? 'Out of chips' : fmt(s.chips)) : s.folded ? 'Folded' : s.allIn ? `All-in` : fmt(s.chips);
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

    renderControls(st, ctx);
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

  window.TableUI.holdem = { size: { land: [1440, 780], port: [440, 760] }, build, render };
})();
