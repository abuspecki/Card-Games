/* =========================================================
   Blackjack — "Salon Privé"
   Half-moon table; seven spots on an arc, you in the centre.
   ========================================================= */
(function () {
  const { card, back, chip, chipsFor, stack, fromCode, fmt, place } = CardUI;

  const L = {
    land: { W: 1440, H: 780, table: [100, 0, 1240, 660], dealerY: 66, dealer: 84, showsY: 194, printY: 232, arc: [620, 150, 540, 420], cards: 70, circle: 70, pays: true },
    port: { W: 440, H: 760, table: [0, 0, 440, 720], dealerY: 40, dealer: 56, showsY: 128, printY: 160, arc: [220, 300, 178, 300], cards: 44, circle: 44, pays: true },
  };
  const ARC_STEPS = [160, 137, 113, 90, 67, 43, 20]; // degrees; index 3 = centre (you)

  const VALUE = (c) => (c[0] === 'A' ? 11 : 'TJQK'.includes(c[0]) ? 10 : Number(c[0]));
  function total(cards) {
    let t = 0, a = 0;
    for (const c of cards) { if (!c) continue; t += VALUE(c); if (c[0] === 'A') a++; }
    while (t > 21 && a) { t -= 10; a--; }
    return { total: t, soft: a > 0 };
  }

  // Basic strategy + bust chance (used by the odds panel).
  function advise(cards, up, lim) {
    const { total: t, soft } = total(cards);
    const u = VALUE(up), v0 = VALUE(cards[0]);
    let move = 'Hit';
    if (lim.canSplit && (v0 === 11 || v0 === 8 || ([2, 3, 6, 7].includes(v0) && u <= 7) || (v0 === 9 && u <= 9 && u !== 7))) move = 'Split';
    else if (lim.canDouble && ((!soft && (t === 11 || (t === 10 && u <= 9) || (t === 9 && u >= 3 && u <= 6))) || (soft && t >= 15 && t <= 18 && u >= 4 && u <= 6))) move = 'Double';
    else if (soft) move = t >= 19 || (t === 18 && u < 9) ? 'Stand' : 'Hit';
    else if (t >= 17) move = 'Stand';
    else if (t >= 13) move = u <= 6 ? 'Stand' : 'Hit';
    else if (t === 12) move = u >= 4 && u <= 6 ? 'Stand' : 'Hit';
    let bust = 0;
    if (!soft) for (const v of [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10, 1]) if (t + v > 21) bust++;
    return { move, bust: Math.round((bust / 13) * 100) };
  }

  let pending = 0;      // bet being built with chips, before you deal
  let lastBet = 0;
  let betHand = -1;     // hand number the pending bet was prepared for

  function build(ctx) {
    const G = L[ctx.layout];
    const [x, y, w, hh] = G.table;
    const frame = ctx.h('div', 'deco-frame', '<i></i><i></i><i></i><i></i>');
    const t = ctx.h('div', 'table');
    Object.assign(t.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px' });
    const R = (left, top, width, height) => `left:${left}px;top:${top}px;width:${width}px;height:${height}px`;
    t.innerHTML = `
      <div class="rail" style="${R(0, -hh, w, hh * 2)}"></div>
      <div class="edge" style="${R(22, -hh + 22, w - 44, hh * 2 - 44)}"></div>
      <div class="felt" style="${R(26, -hh + 26, w - 52, hh * 2 - 52)}"></div>
      <div class="arc arc-outer" style="${R(w * 0.08, -hh * 0.62, w * 0.84, hh * 1.14)}"></div>
      <div class="arc arc-inner" style="${R(w * 0.19, -hh * 0.36, w * 0.62, hh * 0.68)}"></div>
      <div class="tray" id="bTray"></div>`;
    const layer = ctx.h('div', 'layer');
    layer.id = 'bLayer';
    ctx.stage.append(t, frame, layer);
    const tray = document.getElementById('bTray');
    const trayChips = ctx.layout === 'port' ? [500, 100, 25, 5, 5] : [500, 500, 100, 100, 100, 25, 25, 25, 5, 5, 5, 5];
    tray.replaceChildren(...trayChips.map((v) => chip(v, { size: ctx.layout === 'port' ? 22 : 31 })));

    ctx.controls.innerHTML = `
      <section class="bottom-bar" id="bBar">
        <div class="col info"><small>Your hand</small><strong id="bTotal">–</strong><em id="bHint"></em></div>
        <div class="row actions" id="bPlay">
          <button class="plaque gold" id="bHit"><b>Hit</b><em>Draw a card</em></button>
          <button class="plaque" id="bStand"><b>Stand</b><em>Keep your hand</em></button>
          <button class="plaque" id="bDouble"><b>Double</b><em>Double &amp; one card</em></button>
          <button class="plaque" id="bSplit"><b>Split</b><em>Pairs only</em></button>
        </div>
        <div class="row actions hidden" id="bBetting">
          <div class="row bet-chips" id="bChips"></div>
          <div class="quick-bets"><button id="bMin">Min</button><button id="bRepeat">Repeat</button><button id="bX2">×2</button></div>
          <button class="plaque" id="bClear"><b>Clear</b><em>Remove bet</em></button>
          <button class="plaque gold" id="bDeal"><b>Deal</b><em>Place your bet</em></button>
        </div>
        <div class="row actions hidden" id="bRebuyRow"><button class="plaque gold" id="bRebuy"><b>Rebuy</b><em>A fresh stack</em></button></div>
        <div class="col info right"><small>Your bet</small><strong id="bBet">0</strong><em id="bBalance"></em></div>
      </section>`;
    const $ = (id) => document.getElementById(id);
    $('bChips').replaceChildren(...[5, 25, 100, 500].map((v) => {
      const b = ctx.h('button');
      b.setAttribute('aria-label', `Add ${v} to your bet`);
      b.dataset.v = v;
      b.appendChild(chip(v, { size: ctx.layout === 'port' ? 44 : 52 }));
      b.onclick = () => { pending += v; redraw(); };
      return b;
    }));
    const redraw = () => (lastRender ? render(...lastRender) : renderControls(ctx.st, ctx));
    $('bClear').onclick = () => { pending = 0; redraw(); };
    $('bMin').onclick = () => { const lim = ctx.st.limits; if (lim) { pending = lim.minBet; redraw(); } };
    $('bRepeat').onclick = () => { if (lastBet) { pending = lastBet; redraw(); } };
    $('bX2').onclick = () => { pending *= 2; redraw(); };
    $('bDeal').onclick = () => { lastBet = pending; ctx.send({ t: 'action', action: 'bet', amount: pending }); };
    ['Hit', 'Stand', 'Double', 'Split'].forEach((a) => { $('b' + a).onclick = () => ctx.send({ t: 'action', action: a.toLowerCase() }); });
    $('bRebuy').onclick = () => ctx.send({ t: 'rebuy' });
  }

  function spotPos(G, k) {
    const [cx, cy, rx, ry] = G.arc;
    const a = ARC_STEPS[k] * Math.PI / 180;
    return [G.table[0] + cx + Math.cos(a) * rx, G.table[1] + cy + Math.sin(a) * ry];
  }

  // Start each betting turn with your last bet (or the minimum), once per hand.
  function preparePending(st) {
    const lim = st.limits;
    if (!lim || lim.phase !== 'bet') return;
    if (betHand !== st.handNo) { betHand = st.handNo; pending = Math.min(lim.maxBet, Math.max(lim.minBet, lastBet || lim.minBet)); }
    pending = Math.min(pending, lim.maxBet);
  }

  let lastRender = null;
  function render(st, S, ctx) {
    lastRender = [st, S, ctx];
    preparePending(st);
    const G = L[ctx.layout];
    const port = ctx.layout === 'port';
    const layer = document.getElementById('bLayer');
    layer.replaceChildren();
    const el = ctx.h;
    const midX = G.table[0] + G.table[2] / 2;

    // Dealer
    const dealer = el('div', 'dealer');
    const dc = st.dealer.cards;
    dealer.replaceChildren(...dc.map((c) => (c ? fromCode(c, { size: G.dealer }) : back('blackjack', { size: G.dealer }))));
    place(dealer, 0, G.dealerY).style.width = G.W + 'px';
    layer.appendChild(dealer);
    if (dc.length) {
      const shows = el('div', 'dealer-shows', dc.includes(null) ? `Dealer shows ${st.dealer.total}` : st.results && st.results.dealerBJ ? 'Dealer has Blackjack' : `Dealer has ${st.dealer.total}${st.dealer.total > 21 ? ' — bust' : ''}`);
      place(shows, midX, G.showsY).style.transform = 'translateX(-50%)';
      layer.appendChild(shows);
    }
    const print = el('div', 'print', `<p class="pays">Blackjack pays 3 to 2</p><p class="rule">Dealer must draw to 16 and stand on all 17s</p>${port ? '' : '<p class="insurance"><span></span>Bets from ' + fmt(st.minBet) + '<span></span></p>'}`);
    place(print, G.table[0], G.printY).style.width = G.table[2] + 'px';
    layer.appendChild(print);

    // Spots: rotate so you sit in the centre spot
    const meIdx = st.mySeat === -1 ? 0 : st.mySeat;
    const order = [];
    for (let j = 0; j < 8; j++) { const i = (meIdx + j) % 8; if (st.seats[i]) order.push(i); }
    // you in the middle (k=3), then alternate right/left
    const ks = [3, 4, 2, 5, 1, 6, 0];
    order.slice(0, 7).forEach((i, n) => {
      const s = st.seats[i];
      const k = ks[n];
      const [cx, cy] = spotPos(G, k);
      const isMe = i === st.mySeat;
      ctx.plates[i] = [cx, cy - G.cards * 2.3];
      const active = st.toAct === i;
      const circ = el('div', 'spot-circle' + (active ? ' spot-active' : ''));
      Object.assign(circ.style, { width: G.circle + 'px', height: G.circle + 'px' });
      const building = isMe && st.limits && st.limits.phase === 'bet';
      const bet = building ? pending : (s.hands && s.hands.length ? s.hands.reduce((a, x) => a + x.bet, 0) : s.bet) || 0;
      if (bet) circ.appendChild(stack(bet, { size: G.circle * 0.5, maxPer: 6, maxCols: 3 }));
      else circ.appendChild(el('span', 'bet-word', 'BET'));
      place(circ, cx, cy).style.transform = 'translate(-50%,-50%)';
      layer.appendChild(circ);

      // hands (one or two after a split)
      (s.hands || []).forEach((hand, hi) => {
        const n2 = s.hands.length;
        const hx = cx - G.cards * 0.6 + (n2 > 1 ? (hi - 0.5) * G.cards * 1.5 : 0);
        const hy = cy - G.circle * 0.5 - G.cards * 1.75;
        hand.cards.forEach((c, j) => {
          const e = fromCode(c, { size: G.cards });
          place(e, hx + j * G.cards * 0.33, hy - j * G.cards * 0.12, j % 2 ? 4 : -3);
          if (hand.result === 'lose') e.classList.add('dim');
          layer.appendChild(e);
        });
        const nC = hand.cards.length - 1;
        const badge = el('div', 'score' + (hand.bust ? ' bust' : hand.blackjack ? ' bj' : '') + (n2 > 1 && s.handIdx === hi && active ? ' cur' : ''), hand.blackjack ? 'BJ' : String(hand.total));
        place(badge, hx + nC * G.cards * 0.33 + G.cards * 0.9, hy - nC * G.cards * 0.12 - 14);
        layer.appendChild(badge);
        if (hand.result) {
          const r = el('span', 'result-tag ' + hand.result, { win: 'Win', lose: 'Lose', push: 'Push', blackjack: 'Blackjack!' }[hand.result]);
          place(r, hx + G.cards * 0.5, hy + G.cards * 1.45).style.transform = 'translateX(-50%)';
          layer.appendChild(r);
        }
      });

      // name under the spot
      const lab = el('button', 'spot-label' + (isMe ? ' me' : '') + (active ? ' active' : ''),
        `<span class="mini-av">${ctx.avatarHtml(s)}</span>${ctx.nameHtml(s)}${s.lastAction && st.stage !== 'waiting' ? ` · <i>${ctx.esc(s.lastAction)}</i>` : ''}${!isMe && !port ? ` · ${fmt(s.chips)}` : ''}`);
      if (s.hasAccount && !s.isBot) lab.onclick = () => App.openProfile(s.name);
      place(lab, cx, cy + G.circle * 0.58).style.transform = 'translateX(-50%)';
      layer.appendChild(lab);
    });

    // Centre message while waiting
    if (st.stage === 'waiting' || (st.stage === 'showdown' && st.results && !st.results.winners.some((w) => w.seat === st.mySeat))) {
      const text = st.stage === 'waiting' ? 'Take a breath — the next round begins shortly' : '';
      if (text) {
        const m = el('div', 'center-msg', text);
        place(m, midX, G.printY + (port ? 70 : 96)).style.transform = 'translate(-50%,-50%)';
        layer.appendChild(m);
      }
    }
    renderControls(st, ctx);
  }

  function renderControls(st, ctx) {
    if (!st) return;
    const $ = (id) => document.getElementById(id);
    const me = st.mySeat !== -1 ? st.seats[st.mySeat] : null;
    const lim = st.limits;
    const betting = lim && lim.phase === 'bet';
    const playing = lim && lim.phase === 'play';
    const canRebuy = me && me.chips < st.minBet && !(me.inHand && ['betting', 'playing'].includes(st.stage) && me.bet > 0);
    $('bRebuyRow').classList.toggle('hidden', !canRebuy);
    $('bBetting').classList.toggle('hidden', !betting || canRebuy);
    $('bPlay').classList.toggle('hidden', !!betting || canRebuy);
    // Your hand / your bet
    const hand = me && me.hands && me.hands.length ? me.hands[me.handIdx || 0] : null;
    $('bTotal').textContent = hand ? (hand.blackjack ? 'Blackjack' : hand.soft && hand.total < 21 ? `Soft ${hand.total}` : String(hand.total)) : '–';
    const myBet = me ? (me.hands && me.hands.length ? me.hands.reduce((a, x) => a + x.bet, 0) : me.bet) : 0;
    preparePending(st);
    $('bBet').textContent = fmt(betting ? pending : myBet || 0);
    $('bBalance').textContent = me ? `Table stack ${fmt(me.chips)}` : '';
    let hint = '';
    if (canRebuy) hint = 'Out of chips — rebuy to keep playing.';
    else if (betting) hint = pending < lim.minBet ? `The minimum bet is ${fmt(lim.minBet)}.` : 'Add chips, then deal.';
    else if (playing && hand) hint = advise(hand.cards, st.dealer.cards[0], lim).move === 'Double' ? 'A fine moment to double.' : `The book says: ${advise(hand.cards, st.dealer.cards[0], lim).move.toLowerCase()}.`;
    else if (st.stage === 'betting' && st.toAct !== -1) hint = `${st.seats[st.toAct].name} is placing a bet…`;
    else if (st.stage === 'playing' && st.toAct !== -1) hint = `${st.seats[st.toAct].name} is playing…`;
    else if (st.stage === 'showdown' && st.results && me) {
      const w = st.results.winners.find((x) => x.seat === st.mySeat);
      hint = w ? `You won ${fmt(w.amount)}.` : me.inHand ? 'The house takes this one.' : '';
    }
    $('bHint').textContent = hint;
    if (betting) {
      $('bChips').querySelectorAll('button').forEach((b) => { b.disabled = pending + Number(b.dataset.v) > lim.maxBet; });
      $('bDeal').disabled = pending < lim.minBet || pending > lim.maxBet;
      $('bClear').disabled = pending === 0;
      $('bMin').disabled = lim.minBet > lim.maxBet;
      $('bRepeat').disabled = !lastBet || lastBet > lim.maxBet || lastBet === pending;
      $('bX2').disabled = !pending || pending * 2 > lim.maxBet;
    }
    $('bHit').disabled = !playing;
    $('bStand').disabled = !playing;
    $('bDouble').disabled = !(playing && lim.canDouble);
    $('bSplit').disabled = !(playing && lim.canSplit);
    $('bBar').classList.toggle('my-turn', !!lim);
  }

  window.TableUI.blackjack = { size: { land: [1440, 780], port: [440, 760] }, build, render, advise };
})();
