/* =========================================================
   Flamingo — "The Flamingo Lounge"
   Pink cards, four colours (cherry, violet, sun, teal).
   Match the colour or the number; first one out wins.
   Tap a glowing card to select it, tap again (or Play) to play.
   ========================================================= */
(function () {
  const { fmt, place } = CardUI;
  const COLOR_NAMES = { c: 'Cherry', v: 'Violet', s: 'Sun', t: 'Teal' };
  const RANK_LABEL = { S: '⊘', R: '⇄', D: '+2', W: '', F: '+4' };
  const RANK_NAMES = { S: 'Skip', R: 'Reverse', D: 'Draw Two', W: 'Wild', F: 'Wild +4' };
  const isWild = (c) => c && c[0] === 'x';
  const nameOf = (c) => (isWild(c) ? RANK_NAMES[c[1]] : `${COLOR_NAMES[c[0]]} ${RANK_NAMES[c[1]] || c[1]}`);

  const L = {
    land: { W: 1440, H: 780, table: [160, 50, 1120, 560], cx: 720, cy: 330, rx: 600, ry: 290, fan: 46,
      deck: [600, 250], discard: [780, 250], pile: 96, hintY: 430, hand: { size: 104, y: 556, spread: 40 }, me: [250, 716] },
    port: { W: 440, H: 800, table: [16, 36, 408, 560], cx: 220, cy: 310, rx: 176, ry: 262, fan: 26,
      deck: [150, 255], discard: [270, 255], pile: 64, hintY: 400, hand: { size: 72, y: 600, spread: 56 }, me: [220, 760] },
  };

  let selected = null;

  // One pink card. size = width in px.
  function fcard(code, size, faceDown) {
    const e = document.createElement('div');
    e.className = 'fcard' + (faceDown ? ' back' : ` col-${code[0]} rank-${code[1]}`);
    e.style.setProperty('--w', size + 'px');
    if (faceDown) { e.innerHTML = '<span class="fb-mono">F</span>'; return e; }
    const r = code[1];
    const big = isWild(code) ? (r === 'F' ? '+4' : '') : (RANK_LABEL[r] || r);
    const corner = isWild(code) ? (r === 'F' ? '+4' : 'W') : (RANK_LABEL[r] || r);
    e.innerHTML = `<span class="fc-corner tl">${corner}</span><span class="fc-oval">${isWild(code) ? '<i class="q c"></i><i class="q v"></i><i class="q s"></i><i class="q t"></i>' : ''}<b>${big}</b></span><span class="fc-corner br">${corner}</span>`;
    e.setAttribute('aria-label', nameOf(code));
    return e;
  }
  CardUI.flamingo = fcard;

  function build(ctx) {
    const G = L[ctx.layout];
    const t = ctx.h('div', 'table');
    const [x, y, w, hh] = G.table;
    Object.assign(t.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px' });
    t.innerHTML = '<div class="rail"></div><div class="felt"></div><div class="ring"></div><div class="watermark">Flamingo</div>';
    const layer = ctx.h('div', 'layer');
    layer.id = 'fLayer';
    ctx.stage.append(t, layer);
    if (ctx.layout === 'port') t.querySelector('.watermark').style.cssText = `top:${hh / 2 + 70}px;font-size:40px`;

    ctx.controls.innerHTML = `
      <section class="f-bar" id="fBar">
        <div class="f-color" id="fColor"></div>
        <p class="f-hint" id="fHint"></p>
        <div class="f-buttons">
          <div class="f-pick hidden" id="fPick">
            ${['c', 'v', 's', 't'].map((c) => `<button class="pick col-${c}" data-color="${c}">${COLOR_NAMES[c]}</button>`).join('')}
          </div>
          <button class="f-play" id="fPlay">Choose a card</button>
          <button class="f-draw" id="fDraw">Draw a card</button>
        </div>
      </section>`;
    const $ = (id) => document.getElementById(id);
    $('fPlay').onclick = () => play(ctx);
    $('fDraw').onclick = () => {
      const mv = ctx.st.moves;
      if (!mv) return;
      selected = null;
      ctx.send({ t: 'action', action: mv.canDraw ? 'draw' : 'pass' });
    };
    $('fPick').querySelectorAll('[data-color]').forEach((b) => { b.onclick = () => play(ctx, b.dataset.color); });
  }

  function play(ctx, color) {
    const mv = ctx.st.moves;
    if (!mv || !selected || !mv.cards.includes(selected)) return;
    if (isWild(selected) && !color) { renderControls(ctx.st, ctx); return; }
    const card = selected;
    selected = null;
    ctx.send({ t: 'action', action: 'play', amount: { card, color } });
  }

  function plate(ctx, st, s, i, cls) {
    const role = st.stage === 'showdown' && st.winner === i ? 'Winner!' : st.toAct === i ? 'Playing…' : s.cardCount === 1 && st.stage === 'playing' ? 'Last card!' : s.inHand ? `${s.cardCount} cards` : 'Waiting';
    const p = ctx.h('div', 'plate ' + cls + (st.toAct === i ? ' active' : '') + (st.stage === 'showdown' && st.winner === i ? ' winner' : '') + (s.cardCount === 1 && st.stage === 'playing' ? ' last' : ''),
      `<span class="avatar">${ctx.avatarHtml(s)}</span><span class="col"><span class="name">${ctx.nameHtml(s)}</span><span class="role">${role}</span></span>`);
    if (s.hasAccount && !s.isBot) { p.classList.add('clickable'); p.onclick = () => App.openProfile(s.name); }
    return p;
  }

  function render(st, S, ctx) {
    const G = L[ctx.layout];
    const port = ctx.layout === 'port';
    const layer = document.getElementById('fLayer');
    layer.replaceChildren();
    const el = ctx.h;
    const meIdx = st.mySeat;
    const playing = st.stage === 'playing';
    const mv = st.moves;
    if (selected && (!mv || !mv.cards.includes(selected))) selected = null;

    // Opponents on the far arc, in playing order after you
    const opp = [];
    for (let j = 1; j < 6; j++) { const i = (Math.max(0, meIdx) + j) % 6; if (st.seats[i] && i !== meIdx) opp.push(i); }
    opp.forEach((i, j) => {
      const s = st.seats[i];
      const a = (180 + ((j + 1) * 180) / (opp.length + 1)) * Math.PI / 180;
      const px = G.cx + Math.cos(a) * G.rx, py = G.cy + Math.sin(a) * G.ry;
      const fx = G.cx + Math.cos(a) * G.rx * 0.7, fy = G.cy + Math.sin(a) * G.ry * 0.62;
      ctx.plates[i] = [px, py - (port ? 22 : 34)];
      const n = (playing || st.stage === 'showdown') && s.inHand ? s.cardCount : 0;
      const shown = Math.min(n, port ? 6 : 10);
      for (let k = 0; k < shown; k++) {
        const off = k - (shown - 1) / 2;
        layer.appendChild(place(fcard('', G.fan, true), fx - G.fan / 2 + off * G.fan * 0.26, fy - G.fan * 0.7 + Math.abs(off) * 2, off * 7));
      }
      if (n) { const c = el('span', 'count', String(n)); place(c, fx, fy + G.fan * 0.9); layer.appendChild(c); }
      const p = plate(ctx, st, s, i, '');
      place(p, px, py).style.transform = 'translate(-50%,-50%)';
      layer.appendChild(p);
    });

    if ((playing || st.stage === 'showdown') && st.top) {
      // direction ring
      const ring = el('div', 'dir-ring ' + (st.dir === 1 ? 'cw' : 'ccw') + ' col-' + st.color);
      const R = port ? 150 : 250;
      Object.assign(ring.style, { width: R + 'px', height: R * (port ? 0.7 : 0.5) + 'px' });
      place(ring, (G.deck[0] + G.discard[0] + G.pile) / 2, G.deck[1] + G.pile * 0.72).style.transform = 'translate(-50%,-50%)';
      layer.appendChild(ring);
      // deck
      const [dx, dy] = G.deck;
      for (let k = 0; k < Math.min(3, st.deckCount); k++) layer.appendChild(place(fcard('', G.pile, true), dx - G.pile / 2 + k * 3, dy - k * 3));
      const dl = el('span', 'pile-label', `${st.deckCount} left`);
      place(dl, dx, dy + G.pile * 1.6).style.transform = 'translateX(-50%)';
      layer.appendChild(dl);
      const deckHit = el('button', 'deck-hit');
      deckHit.setAttribute('aria-label', 'Draw a card');
      Object.assign(deckHit.style, { width: G.pile + 'px', height: G.pile * 1.45 + 'px' });
      place(deckHit, dx - G.pile / 2, dy - 6);
      deckHit.disabled = !(mv && mv.canDraw);
      deckHit.onclick = () => { if (mv && mv.canDraw) { selected = null; ctx.send({ t: 'action', action: 'draw' }); } };
      layer.appendChild(deckHit);
      // discard + colour in force
      const [qx, qy] = G.discard;
      const top = fcard(st.top, G.pile);
      top.classList.add('top-card');
      layer.appendChild(place(top, qx - G.pile / 2, qy, 4));
      const cl = el('span', 'pile-label now col-' + st.color, `${COLOR_NAMES[st.color] || ''}${isWild(st.top) ? ' (chosen)' : ''}`);
      place(cl, qx, qy + G.pile * 1.6).style.transform = 'translateX(-50%)';
      layer.appendChild(cl);
    }

    // Your hand
    const me = meIdx !== -1 ? st.seats[meIdx] : null;
    if (me) {
      ctx.plates[meIdx] = [G.me[0], G.me[1] - (port ? 22 : 34)];
      const hand = (me.hole || []).slice();
      const H = G.hand;
      // Phones: big hands go into two rows so every card stays easy to tap.
      const rows = port && hand.length > 8 ? [hand.slice(0, Math.ceil(hand.length / 2)), hand.slice(Math.ceil(hand.length / 2))] : [hand];
      rows.forEach((row, ri) => {
        const nH = row.length;
        const size = rows.length > 1 ? H.size * 0.86 : H.size;
        const y = H.y + (rows.length > 1 ? (ri ? size * 0.62 : -size * 0.32) : 0);
        const step = nH > 1 ? Math.min(port ? 7 : 5, H.spread / (nH - 1)) : 0;
        // phones: use the whole width, so every card's number stays visible
        const spreadX = Math.min(port ? G.W - size - 48 : 760, nH * size * (port ? 0.8 : 0.55));
        row.forEach((c, k) => {
          const e = fcard(c, size);
          const off = k - (nH - 1) / 2;
          const ok = mv && mv.cards.includes(c);
          const x0 = G.cx - size / 2 + (nH > 1 ? (off / ((nH - 1) / 2 || 1)) * spreadX / 2 : 0);
          place(e, x0, y + Math.abs(off) * (port ? 2 : 3));
          e.style.transform = `rotate(${off * step}deg) translateY(${selected === c ? -size * 0.3 : 0}px)`;
          e.classList.add('hand-card');
          if (ok) e.classList.add('playable');
          else if (mv) e.classList.add('unplayable');
          if (mv && mv.drew === c) e.classList.add('just-drawn');
          if (selected === c) e.classList.add('selected');
          e.tabIndex = ok ? 0 : -1;
          const pick = () => {
            if (!ok) return;
            if (selected === c && !isWild(c)) play(ctx); else { selected = c; render(st, S, ctx); }
          };
          e.addEventListener('click', pick);
          e.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); } });
          layer.appendChild(e);
        });
      });
      const sel = layer.querySelector('.hand-card.selected');
      if (sel) layer.appendChild(sel);
      const p = plate(ctx, st, me, meIdx, 'me');
      place(p, G.me[0], G.me[1]).style.transform = 'translate(-50%,-50%)';
      layer.appendChild(p);
    }

    const hint = el('div', 'hint', ctx.esc(hintText(st)));
    if (hint.textContent) { place(hint, G.cx, G.hintY).style.transform = 'translateX(-50%)'; layer.appendChild(hint); }
    renderControls(st, ctx);
  }

  function hintText(st) {
    const name = (i) => (st.seats[i] ? st.seats[i].name : 'A player');
    if (st.stage === 'waiting') return st.seats.filter(Boolean).length < 2 ? 'Waiting for another player — invite a friend or a bot' : 'Shuffling the pink deck…';
    if (st.stage === 'showdown') return st.winner === st.mySeat ? 'Flamingo! You are out of cards and win 🦩' : `${name(st.winner)} wins the game!`;
    const mv = st.moves;
    if (mv) {
      if (mv.drew) return mv.cards.length ? `You drew ${nameOf(mv.drew)} — play it or pass.` : 'No luck — pass.';
      return mv.cards.length ? `Your turn — match ${COLOR_NAMES[st.color]} or the number.` : 'Nothing fits — draw a card.';
    }
    return st.toAct !== -1 ? `${name(st.toAct)} is playing…` : '';
  }

  function renderControls(st, ctx) {
    const $ = (id) => document.getElementById(id);
    if (!$('fBar')) return;
    const mv = st.moves;
    const c = st.color;
    $('fColor').innerHTML = c && st.stage !== 'waiting' ? `<small>COLOUR</small><i class="dot col-${c}"></i><em>${COLOR_NAMES[c]}</em><span class="dir">${st.dir === 1 ? '↻' : '↺'}</span>` : '<small>FLAMINGO</small><em>🦩</em>';
    const wild = selected && isWild(selected);
    $('fPick').classList.toggle('hidden', !wild);
    $('fPlay').classList.toggle('hidden', !!wild);
    $('fHint').textContent = !mv ? (st.stage === 'playing' ? 'Wait for your turn.' : '') : wild ? 'Pick the next colour:' : selected ? `Selected: ${nameOf(selected)}` : mv.cards.length ? 'Tap a glowing card.' : '';
    $('fPlay').disabled = !mv || !selected;
    $('fPlay').textContent = selected ? `Play ${nameOf(selected)}` : mv ? 'Choose a card' : st.stage === 'playing' ? 'Waiting…' : 'Waiting for the deal';
    $('fDraw').classList.toggle('hidden', !mv);
    $('fDraw').textContent = mv && !mv.canDraw ? 'Pass' : 'Draw a card';
    $('fBar').classList.toggle('my-turn', !!mv);
  }

  window.TableUI = window.TableUI || {};
  window.TableUI.flamingo = { size: { land: [1440, 780], port: [440, 800] }, build, render, dealer: { land: { x: 112, y: 0, size: 100 }, port: { x: 46, y: 0, size: 56 } } };
})();
