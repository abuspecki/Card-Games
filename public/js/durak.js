/* =========================================================
   Durak — "The Winter Palace"
   Opponents on the far arc, deck left, discard right,
   battlefield in the middle, your hand fanned at the bottom.
   Tap a card to select it, tap it again (or the button) to play.
   ========================================================= */
(function () {
  const { card, back, fromCode, nameOf, fmt, place, suitSvg } = CardUI;
  const SUIT = { s: 'Spades', h: 'Hearts', d: 'Diamonds', c: 'Clubs' };
  const SUIT_KEY = { s: 'spade', h: 'heart', d: 'diamond', c: 'club' };
  const RANK = { J: 'Jack', Q: 'Queen', K: 'King', A: 'Ace', T: '10' };
  const short = (c) => 'the ' + (RANK[c[0]] || c[0]);

  const L = {
    land: { W: 1440, H: 780, table: [160, 60, 1120, 560], cx: 720, cy: 340, rx: 600, ry: 296, fan: 50, deck: [300, 290], discard: [1060, 290], pile: 84,
      battle: { y: 222, size: 96, gap: 150, perRow: 6 }, hintY: 470, hand: { size: 108, y: 560, spread: 40 }, me: [250, 716] },
    port: { W: 440, H: 760, table: [16, 40, 408, 540], cx: 220, cy: 310, rx: 176, ry: 262, fan: 26, deck: [48, 300], discard: [372, 300], pile: 48,
      battle: { y: 200, size: 58, gap: 74, perRow: 3, rowGap: 104 }, hintY: 440, hand: { size: 70, y: 590, spread: 56 }, me: [220, 742] },
  };

  let selected = null;

  function build(ctx) {
    const G = L[ctx.layout];
    const frame = ctx.h('div', 'frame', '<i></i><i></i><i></i><i></i>');
    const t = ctx.h('div', 'table');
    const [x, y, w, hh] = G.table;
    Object.assign(t.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px' });
    t.innerHTML = '<div class="rail"></div><div class="edge"></div><div class="felt"></div><div class="ring"></div><div class="watermark" lang="ru">Дурак</div>';
    const layer = ctx.h('div', 'layer');
    layer.id = 'dLayer';
    ctx.stage.append(frame, t, layer);
    if (ctx.layout === 'port') t.querySelector('.watermark').style.cssText = `top:${hh / 2 - 40}px;font-size:56px`;
    else t.querySelector('.watermark').style.top = (hh / 2 - 70) + 'px';

    ctx.controls.innerHTML = `
      <section class="durak-actions" id="dBar">
        <div class="trump-pill" id="dTrump"></div>
        <p class="d-hint" id="dHint"></p>
        <div class="row d-buttons">
          <button class="btn-silver" id="dPrimary">Choose a card</button>
          <button class="btn-outline" id="dSecondary">Pass</button>
        </div>
      </section>`;
    document.getElementById('dPrimary').onclick = () => play(ctx);
    document.getElementById('dSecondary').onclick = () => {
      const mv = ctx.st.moves;
      if (!mv) return;
      selected = null;
      ctx.send({ t: 'action', action: mv.canTake ? 'take' : 'pass' });
    };
  }

  function play(ctx) {
    const mv = ctx.st.moves;
    if (!mv || !selected || !mv.cards.includes(selected)) return;
    const c = selected;
    selected = null;
    ctx.send({ t: 'action', action: 'play', amount: c });
  }

  function role(st, i) {
    const s = st.seats[i];
    if (!s.inHand) return ['waiting', st.stage === 'waiting' ? 'Waiting' : 'Watching'];
    if (s.out) return ['out', 'Out of cards'];
    if (st.stage !== 'playing') return ['waiting', ''];
    if (i === st.defender) return ['defending', 'Defending'];
    if (i === st.attacker && (st.phase === 'attack' || st.toAct === i)) return ['attacking', 'Attacking'];
    if (st.toAct === i && (st.phase === 'throw' || st.phase === 'takeThrow')) return ['can-add', 'May add cards'];
    if (i === st.attacker) return ['attacking', 'Attacking'];
    return ['waiting', 'Waiting'];
  }

  function plate(ctx, st, s, i, cls) {
    const [rc, rl] = role(st, i);
    const p = ctx.h('div', 'plate ' + cls + (st.toAct === i ? ' active' : '') + (st.stage === 'showdown' && st.durak === i ? ' loser' : ''),
      `<span class="avatar">${ctx.avatarHtml(s)}</span><span class="col"><span class="name">${ctx.nameHtml(s)}</span><span class="role role-${rc}">${rl}</span></span>`);
    if (s.hasAccount && !s.isBot) { p.classList.add('clickable'); p.onclick = () => App.openProfile(s.name); }
    return p;
  }

  function render(st, S, ctx) {
    const G = L[ctx.layout];
    const port = ctx.layout === 'port';
    const layer = document.getElementById('dLayer');
    layer.replaceChildren();
    const el = ctx.h;
    const meIdx = st.mySeat;
    const playing = st.stage === 'playing';
    const mv = st.moves;
    if (selected && (!mv || !mv.cards.includes(selected))) selected = null;

    // Opponents on the far arc, clockwise after you
    const opp = [];
    for (let j = 1; j < 8; j++) { const i = (Math.max(0, meIdx) + j) % 8; if (st.seats[i] && i !== meIdx) opp.push(i); }
    opp.forEach((i, j) => {
      const s = st.seats[i];
      const a = (180 + ((j + 1) * 180) / (opp.length + 1)) * Math.PI / 180;
      const px = G.cx + Math.cos(a) * G.rx, py = G.cy + Math.sin(a) * G.ry;
      const fx = G.cx + Math.cos(a) * G.rx * 0.7, fy = G.cy + Math.sin(a) * G.ry * 0.62;
      ctx.plates[i] = [px, py - (port ? 22 : 34)];
      const n = playing && s.inHand && !s.out ? s.cardCount : 0;
      const shown = Math.min(n, port ? 6 : 10);
      for (let k = 0; k < shown; k++) {
        const off = k - (shown - 1) / 2;
        layer.appendChild(place(back('durak', { size: G.fan }), fx - G.fan / 2 + off * G.fan * 0.26, fy - G.fan * 0.7 + Math.abs(off) * 2, off * 7));
      }
      if (n) { const c = el('span', 'count', String(n)); place(c, fx, fy + G.fan * 0.85); layer.appendChild(c); }
      const p = plate(ctx, st, s, i, s.out ? 'out' : '');
      place(p, px, py).style.transform = 'translate(-50%,-50%)';
      layer.appendChild(p);
    });

    if (playing) {
      // Deck with the trump underneath
      const [dx, dy] = G.deck;
      if (st.trumpCard) layer.appendChild(place(fromCode(st.trumpCard, { size: G.pile }), dx + G.pile * 0.55, dy + G.pile * 0.1, 90));
      for (let k = 0; k < Math.min(3, Math.max(0, st.deckCount - 1)); k++) layer.appendChild(place(back('durak', { size: G.pile }), dx - G.pile * 0.2 + k * 3, dy - k * 3));
      const dl = el('span', 'pile-label', st.deckCount ? `${st.deckCount} left` : 'Deck empty');
      place(dl, dx + G.pile * 0.4, dy + G.pile * 1.55);
      layer.appendChild(dl);
      // Discard pile (бито)
      const inHands = st.seats.reduce((a, s) => a + (s && s.inHand ? (s.cardCount || 0) : 0), 0);
      const onTable = st.table.reduce((a, p) => a + (p.d ? 2 : 1), 0);
      const discard = 36 - st.deckCount - inHands - onTable;
      if (discard > 0) {
        const [qx, qy] = G.discard;
        [-22, 12, -38].forEach((deg, k) => layer.appendChild(place(back('durak', { size: G.pile }), qx - G.pile / 2 + [0, 6, 2][k], qy + [0, 4, -2][k], deg)));
        const bl = el('span', 'pile-label', port ? 'Бито' : '<span lang="ru">Бито</span> · Discard');
        place(bl, qx, qy + G.pile * 1.55);
        layer.appendChild(bl);
      }
      // Battlefield
      const B = G.battle;
      const n = st.table.length;
      st.table.forEach((p, k) => {
        const row = Math.floor(k / B.perRow);
        const inRow = Math.min(B.perRow, n - row * B.perRow);
        const col = k % B.perRow;
        const cx = G.cx + (col - (inRow - 1) / 2) * B.gap;
        const cy = B.y + row * (B.rowGap || 0);
        const a = place(fromCode(p.a, { size: B.size }), cx - B.size * 0.6, cy);
        layer.appendChild(a);
        if (p.d) layer.appendChild(place(fromCode(p.d, { size: B.size }), cx - B.size * 0.38, cy + B.size * 0.25, 9));
        else if (mv && mv.phase === 'defend') {
          a.classList.add('open-card');
          const tag = el('span', 'beat-tag', 'Beat this card');
          place(tag, cx - B.size * 0.1, cy + B.size * 1.5);
          layer.appendChild(tag);
        }
      });
    }

    // Your hand
    const me = meIdx !== -1 ? st.seats[meIdx] : null;
    if (me) {
      ctx.plates[meIdx] = [G.me[0], G.me[1] - (port ? 22 : 34)];
      const hand = (me.hole || []).slice();
      const H = G.hand;
      const nH = hand.length;
      const step = nH > 1 ? Math.min(port ? 9 : 6, H.spread / (nH - 1)) : 0;
      const spreadX = Math.min(port ? 300 : 620, nH * H.size * 0.55);
      hand.forEach((c, k) => {
        const e = fromCode(c, { size: H.size });
        const off = k - (nH - 1) / 2;
        const ok = mv && mv.cards.includes(c);
        const x0 = G.cx - H.size / 2 + (nH > 1 ? (off / ((nH - 1) / 2 || 1)) * spreadX / 2 : 0);
        place(e, x0, H.y + Math.abs(off) * (port ? 3 : 4));
        e.style.transform = `rotate(${off * step}deg) translateY(${selected === c ? -H.size * 0.3 : 0}px)`;
        e.classList.add('hand-card');
        if (ok) { e.classList.add('selectable', 'playable'); }
        else if (mv) e.classList.add('unplayable');
        if (c[1] === st.trump) e.classList.add('is-trump');
        if (selected === c) e.classList.add('selected');
        e.tabIndex = ok ? 0 : -1;
        const pick = () => {
          if (!ok) return;
          if (selected === c) play(ctx); else { selected = c; render(st, S, ctx); }
        };
        e.addEventListener('click', pick);
        e.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); } });
        layer.appendChild(e);
      });
      const sel = layer.querySelector('.hand-card.selected');
      if (sel) layer.appendChild(sel);
      const p = plate(ctx, st, me, meIdx, 'me' + (me.out ? ' out' : ''));
      place(p, G.me[0], G.me[1]).style.transform = 'translate(-50%,-50%)';
      layer.appendChild(p);
      if (playing && me.inHand && !me.out && !hand.length && st.deckCount === 0) {
        const m = el('div', 'hint', 'You are out of cards — safe! 🎉');
        place(m, G.cx, H.y + 30).style.transform = 'translateX(-50%)';
        layer.appendChild(m);
      }
    }

    // Hint pill in the middle
    const hint = el('div', 'hint', ctx.esc(hintText(st)));
    if (hint.textContent) { place(hint, G.cx, G.hintY).style.transform = 'translateX(-50%)'; layer.appendChild(hint); }

    renderControls(st, ctx);
  }

  function hintText(st) {
    const name = (i) => (st.seats[i] ? st.seats[i].name : 'A player');
    if (st.stage === 'waiting') return st.seats.filter(Boolean).length < 2 ? 'Waiting for another player — invite a friend or a bot' : 'The cards are being shuffled…';
    if (st.stage === 'showdown') return st.durak === -1 || st.durak == null ? 'A draw — nobody is the durak!' : `${name(st.durak)} is the durak!`;
    const mv = st.moves;
    if (mv) {
      if (mv.phase === 'attack') return 'Your attack — play any card.';
      if (mv.phase === 'defend') return mv.cards.length ? `You are defending — beat the ${nameOf(mv.target)}, or take the cards.` : `You cannot beat the ${nameOf(mv.target)} — take the cards.`;
      if (mv.phase === 'takeThrow') return `${name(st.defender)} is taking — add cards of a rank on the table?`;
      return 'You may add cards of a rank already on the table.';
    }
    const who = st.toAct !== -1 ? name(st.toAct) : '';
    if (st.phase === 'attack') return `${who} is attacking…`;
    if (st.phase === 'defend') return `${who} is defending…`;
    return who ? `${who} may add cards…` : '';
  }

  function renderControls(st, ctx) {
    const $ = (id) => document.getElementById(id);
    const mv = st.moves;
    const t = st.trump;
    $('dTrump').innerHTML = t && st.stage === 'playing'
      ? `<small>TRUMP</small><i class="${t === 'h' || t === 'd' ? 'red' : ''}">${suitSvg(SUIT_KEY[t])}</i><em>${SUIT[t]}</em>`
      : '<small>DURAK</small><em>Дурак</em>';
    $('dHint').textContent = mv ? (mv.phase === 'attack' ? 'Tap a card to select it, tap again to play.' : selected ? `Selected: ${nameOf(selected)}` : mv.cards.length ? 'Tap a glowing card to select it.' : '') : (st.stage === 'playing' ? 'Wait for your turn.' : '');
    const b1 = $('dPrimary'), b2 = $('dSecondary');
    b1.disabled = !mv || !selected;
    b2.classList.toggle('hidden', !mv || mv.phase === 'attack');
    $('dBar').classList.toggle('my-turn', !!mv);
    if (!mv) { b1.textContent = st.stage === 'playing' ? 'Waiting…' : 'Waiting for the deal'; b2.classList.add('hidden'); return; }
    const verb = mv.phase === 'attack' ? 'Attack with' : mv.phase === 'defend' ? 'Beat with' : 'Add';
    b1.textContent = selected ? `${verb} ${short(selected)}` : 'Choose a card';
    if (mv.canTake) b2.innerHTML = 'Take the Cards · <span lang="ru">Взять</span>';
    else if (mv.phase === 'takeThrow') b2.textContent = 'Done adding';
    else if (st.attacker === st.mySeat) b2.innerHTML = 'Done · <span lang="ru">Бито</span>';
    else b2.textContent = 'Pass';
  }

  window.TableUI.durak = { size: { land: [1440, 780], port: [440, 800] }, build, render };
})();
