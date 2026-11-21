/* =========================================================
   Chess for chips — the board, the clocks and the doubling cube.
   The server sends the position and, to the player to move, every
   legal move ("e2e4", "e7e8q"); tap a piece, then a square.
   ========================================================= */
(function () {
  const FILES = 'abcdefgh';
  // filled glyphs for both colours (coloured by CSS); ︎ keeps them text, not emoji
  const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  const glyph = (p) => GLYPH[p.toLowerCase()] + '︎';
  const L = {
    land: { W: 1440, H: 780, board: { x: 430, y: 36, size: 704 }, side: { x: 1170, w: 250 }, left: { x: 40, w: 360 } },
    port: { W: 440, H: 760, board: { x: 12, y: 150, size: 416 } },
  };
  let selected = null;     // square name of the selected piece
  let promo = null;        // { from, to } waiting for a choice
  let clockAt = 0;         // when the clocks were received
  let clockTimer = null;

  function build(ctx) {
    const G = L[ctx.layout];
    const wrap = ctx.h('div', 'chess-room');
    wrap.innerHTML = `<div class="chess-lamp"></div><div class="chess-table"></div><div class="chess-board" id="cBoard"></div><div class="chess-layer" id="cLayer"></div>`;
    ctx.stage.appendChild(wrap);
    const B = G.board;
    const board = wrap.querySelector('#cBoard');
    Object.assign(board.style, { left: B.x + 'px', top: B.y + 'px', width: B.size + 'px', height: B.size + 'px' });
    board.style.setProperty('--cell', B.size / 8 + 'px');
    const table = wrap.querySelector('.chess-table');
    Object.assign(table.style, { left: B.x - 26 + 'px', top: B.y - 26 + 'px', width: B.size + 52 + 'px', height: B.size + 52 + 'px' });
    ctx.controls.innerHTML = `
      <section class="chess-bar" id="cBar">
        <div class="cb-info"><small>Stake</small><strong id="cAmount">–</strong><em id="cNote"></em></div>
        <div class="cb-actions" id="cActions"></div>
      </section>`;
    clearInterval(clockTimer);
    clockTimer = setInterval(tickClocks, 250);
  }

  const sqName = (i) => FILES[i % 8] + (8 - Math.floor(i / 8));

  function render(st, S, ctx) {
    const G = L[ctx.layout];
    const port = ctx.layout === 'port';
    const me = st.mySeat;
    const myColor = me !== -1 && st.seats[me] && st.seats[me].color ? st.seats[me].color : (me === -1 ? 'w' : (st.white === me ? 'w' : 'b'));
    const flip = myColor === 'b';
    const B = G.board;
    const cell = B.size / 8;
    const board = document.getElementById('cBoard');
    const layer = document.getElementById('cLayer');
    if (!board) return;
    const legal = st.legal || [];
    if (selected && !legal.some((m) => m.startsWith(selected))) selected = null;
    const targets = selected ? legal.filter((m) => m.startsWith(selected)).map((m) => m.slice(2, 4)) : [];
    const kingInCheck = st.check ? sqName(st.board.indexOf(st.turn === 'w' ? 'K' : 'k')) : null;

    // ---- the board ----
    board.replaceChildren();
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const i = flip ? (7 - r) * 8 + (7 - c) : r * 8 + c;
      const name = sqName(i);
      const p = st.board[i];
      const sq = ctx.h('div', 'sq ' + (((Math.floor(i / 8) + (i % 8)) % 2) ? 'dark' : 'light'));
      if (st.last && (st.last.from === name || st.last.to === name)) sq.classList.add('last');
      if (selected === name) sq.classList.add('sel');
      if (kingInCheck === name) sq.classList.add('check');
      if (targets.includes(name)) sq.classList.add(p ? 'target capture' : 'target');
      if (c === 0) sq.appendChild(ctx.h('span', 'coord rank', String(8 - Math.floor(i / 8))));
      if (r === 7) sq.appendChild(ctx.h('span', 'coord file', FILES[i % 8]));
      if (p) sq.appendChild(ctx.h('span', 'pc ' + (p === p.toUpperCase() ? 'w' : 'b'), glyph(p)));
      sq.onclick = () => tap(name, st, ctx);
      board.appendChild(sq);
    }
    board.classList.toggle('my-turn', legal.length > 0);

    // ---- players: opponent at the top, you at the bottom ----
    layer.replaceChildren();
    const seatOfColor = (c) => st.seats.findIndex((s) => s && s.color === c);
    let top = seatOfColor(flip ? 'w' : 'b');
    let bottom = seatOfColor(flip ? 'b' : 'w');
    if (st.stage === 'waiting' || top === -1 || bottom === -1) {
      bottom = me !== -1 ? me : st.seats.findIndex(Boolean);
      top = st.seats.findIndex((s, i) => s && i !== bottom);
    }
    const plate = (i, where) => {
      const s = i !== -1 ? st.seats[i] : null;
      const color = s && s.color;
      const running = st.running === i && i !== -1;
      const box = ctx.h('div', `cplate ${where}${running ? ' running' : ''}${st.results && st.results.winners && st.results.winners.some((w) => w.seat === i) ? ' winner' : ''}`);
      const level = s && s.botLevel ? ['', 'Bot · easy', 'Bot · medium', 'Bot · strong'][s.botLevel] : '';
      box.innerHTML = s
        ? `<span class="avatar">${ctx.avatarHtml(s)}</span><span class="col"><span class="name">${ctx.nameHtml(s)}</span><span class="sub">${color ? `<i class="dot ${color}"></i>` : ''}<span>${ctx.fmt(s.chips)}</span>${level ? '<span>·</span><span>' + level + '</span>' : ''}</span></span>
           <span class="clock${running ? ' on' : ''}" data-clock="${i}">${fmtClock(st.clocks ? st.clocks[i] : st.minutes * 60000)}</span>`
        : '<span class="avatar">+</span><span class="col"><span class="name">Open seat</span><span class="sub">Invite a friend or a bot</span></span>';
      const caps = s && color && st.captured ? st.captured[color] : [];
      if (caps && caps.length) box.appendChild(ctx.h('div', 'caps', caps.map((p) => `<span class="pc ${p === p.toUpperCase() ? 'w' : 'b'}">${glyph(p)}</span>`).join('')));
      if (s && s.hasAccount && !s.isBot) { box.classList.add('clickable'); box.onclick = () => App.openProfile(s.name); }
      const y = where === 'top' ? (port ? 70 : B.y + 6) : (port ? B.y + B.size + 14 : B.y + B.size - 106);
      const x = port ? 12 : G.left.x;
      Object.assign(box.style, { left: x + 'px', top: y + 'px', width: (port ? B.size : G.left.w) + 'px' });
      layer.appendChild(box);
      if (i !== -1) ctx.plates[i] = [x + (port ? B.size / 2 : G.left.w / 2), y];
    };
    plate(top, 'top');
    plate(bottom, 'bottom');

    // ---- the doubling cube: in the middle, or next to its owner ----
    const shown = st.offer && st.offer.kind === 'double' ? st.cube * 2 : st.cube;
    const cube = ctx.h('div', 'cube' + (st.offer && st.offer.kind === 'double' ? ' offered' : ''), `<b>×${shown}</b><small>${st.offer && st.offer.kind === 'double' ? 'offered' : 'cube'}</small>`);
    const cubeY = st.cubeOwner === -1 ? B.y + B.size / 2 - 32 : st.cubeOwner === top ? B.y + 120 : B.y + B.size - 186;
    Object.assign(cube.style, port ? { left: (st.cubeOwner === -1 ? B.x + B.size / 2 - 23 : st.cubeOwner === top ? B.x + B.size - 46 : B.x) + 'px', top: B.y + B.size + 96 + 'px' } : { left: G.left.x + G.left.w - 74 + 'px', top: cubeY + 'px' });
    layer.appendChild(cube);

    // ---- moves (computer only) ----
    if (!port) {
      const list = ctx.h('div', 'cmoves');
      const mv = st.moves || [];
      let html = '<h5>Moves</h5><ol>';
      for (let k = 0; k < mv.length; k += 2) html += `<li><span>${ctx.esc(mv[k])}</span><span>${mv[k + 1] ? ctx.esc(mv[k + 1]) : ''}</span></li>`;
      list.innerHTML = html + '</ol>';
      Object.assign(list.style, { left: G.side.x + 'px', top: B.y + 'px', width: G.side.w + 'px', height: B.size + 'px' });
      layer.appendChild(list);
      const ol = list.querySelector('ol');
      requestAnimationFrame(() => { ol.scrollTop = ol.scrollHeight; });
    }

    // ---- result / waiting message ----
    let msg = '';
    if (st.stage === 'waiting') msg = st.seats.filter(Boolean).length < 2 ? 'Waiting for an opponent — invite a friend or a bot' : 'The next game starts in a moment…';
    else if (st.stage === 'showdown' && st.results) {
      const w = st.results.winners[0];
      msg = st.results.draw ? `Draw — ${st.results.reason}` : `${st.seats[w.seat] ? st.seats[w.seat].name : 'A player'} wins ${ctx.fmt(w.amount)} — ${st.results.reason}`;
    } else if (st.offer && st.toAct !== me) msg = st.offer.kind === 'double' ? 'Waiting for the answer to the double…' : 'Waiting for the answer to the draw offer…';
    if (msg) {
      const m = ctx.h('div', 'center-msg chess-msg' + (st.stage === 'showdown' ? ' result' : ''), ctx.esc(msg));
      Object.assign(m.style, { left: B.x + B.size / 2 + 'px', top: B.y + B.size / 2 + 'px' });
      layer.appendChild(m);
    }

    // ---- promotion choice ----
    if (promo) {
      const pick = ctx.h('div', 'promo');
      for (const k of ['q', 'r', 'b', 'n']) {
        const b = ctx.h('button', '', `<span class="pc ${myColor}">${glyph(myColor === 'w' ? k.toUpperCase() : k)}</span>`);
        b.onclick = (e) => { e.stopPropagation(); ctx.send({ t: 'action', action: 'move', amount: promo.from + promo.to + k }); promo = null; selected = null; render(st, S, ctx); };
        pick.appendChild(b);
      }
      Object.assign(pick.style, { left: B.x + B.size / 2 + 'px', top: B.y + B.size / 2 + 'px' });
      layer.appendChild(pick);
    }

    clockAt = Date.now();
    renderControls(st, ctx);
  }

  function tap(name, st, ctx) {
    const legal = st.legal || [];
    if (!legal.length) return;
    if (selected && legal.some((m) => m.slice(0, 4) === selected + name)) {
      const options = legal.filter((m) => m.slice(0, 4) === selected + name);
      if (options.length > 1) { promo = { from: selected, to: name }; render(st, App.S, ctx); return; }
      ctx.send({ t: 'action', action: 'move', amount: options[0] });
      selected = null;
      return;
    }
    selected = legal.some((m) => m.startsWith(name)) ? (selected === name ? null : name) : null;
    promo = null;
    render(st, App.S, ctx);
  }

  function renderControls(st, ctx) {
    const me = st.mySeat;
    const box = document.getElementById('cActions');
    if (!box) return;
    box.replaceChildren();
    document.getElementById('cAmount').textContent = ctx.fmt(st.amount || st.stake);
    const add = (label, cls, fn, disabled) => { const b = ctx.h('button', 'cbtn ' + cls, label); b.disabled = !!disabled; b.onclick = fn; box.appendChild(b); return b; };
    let note = st.cube > 1 ? `Doubled to ×${st.cube}` : `Stake per game · cube at 1`;
    const playing = st.stage === 'playing' && me !== -1 && st.seats[me] && st.seats[me].color;
    if (playing && st.offer && st.toAct === me) {
      if (st.offer.kind === 'double') {
        note = `${st.seats[st.offer.from].name} doubles: play on for ${ctx.fmt(st.amount * 2)}, or give up ${ctx.fmt(st.amount)} now`;
        add(`Take · play for ${ctx.fmt(st.amount * 2)}`, 'gold', () => ctx.send({ t: 'action', action: 'take' }));
        add(`Decline · lose ${ctx.fmt(st.amount)}`, 'quiet', () => ctx.send({ t: 'action', action: 'drop' }));
      } else {
        note = `${st.seats[st.offer.from].name} offers a draw`;
        add('Accept the draw', 'gold', () => ctx.send({ t: 'action', action: 'accept' }));
        add('Play on', 'quiet', () => ctx.send({ t: 'action', action: 'decline' }));
      }
    } else if (playing) {
      if (st.toAct === me) note = st.check ? 'Check! Your move.' : 'Your move — tap a piece.';
      add(`Double to ${ctx.fmt(st.nextAmount)}`, 'gold', () => { if (confirm(`Offer to double the stake to ${ctx.fmt(st.nextAmount)}?`)) ctx.send({ t: 'action', action: 'double' }); }, !st.canDouble);
      add('Offer a draw', 'quiet', () => ctx.send({ t: 'action', action: 'draw' }), st.toAct !== me);
      add('Resign', 'quiet', () => { if (confirm(`Resign and lose ${ctx.fmt(st.amount)}?`)) ctx.send({ t: 'action', action: 'resign' }); });
    } else if (st.stage === 'waiting') note = 'The game starts as soon as two players sit down.';
    document.getElementById('cNote').textContent = note;
    document.getElementById('cBar').classList.toggle('my-turn', !!(playing && st.toAct === me));
  }

  function fmtClock(ms) {
    const t = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }
  // the running clock counts down between updates from the server
  function tickClocks() {
    const S = window.App && App.S;
    if (!S || !S.state || S.state.game !== 'chess') return;
    const st = S.state;
    if (st.running === -1 || !st.clocks) return;
    const el = document.querySelector(`[data-clock="${st.running}"]`);
    if (!el) return;
    const left = st.clocks[st.running] - (Date.now() - clockAt);
    el.textContent = fmtClock(left);
    el.classList.toggle('low', left < 30000);
  }

  window.TableUI.chess = { size: { land: [1440, 780], port: [440, 760] }, build, render };
})();
