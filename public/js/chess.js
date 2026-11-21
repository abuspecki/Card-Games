/* =========================================================
   Chess for chips — board, pieces, clocks and the doubling cube.

   The server sends the position and, only to the player to move, every
   legal move ("e2e4", "e7e8q"). Pick a piece by tapping or dragging it,
   then drop it or tap the square. The board is built once; each update
   moves the pieces, so a move slides instead of jumping.
   ========================================================= */
(function () {
  const FILES = 'abcdefgh';
  const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const NEXT_GAME_MS = 10000;
  const L = {
    land: { W: 1440, H: 780, board: { x: 448, y: 40, size: 700 }, left: { x: 40, w: 370 }, side: { x: 1180, w: 230 } },
    port: { W: 440, H: 666, board: { x: 12, y: 112, size: 416 } },
  };

  // ---------- the pieces: one SVG set, filled for white or black ----------
  const BASE = '<path class="base" d="M22 90h56a4 4 0 0 0 0-8H22a4 4 0 0 0 0 8z"/><path d="M28 82h44l-3-8H31z"/>';
  const SHAPES = {
    p: `${BASE}<path d="M36 74c2-12 7-20 10-26h8c3 6 8 14 10 26z"/><path d="M38 50h24a3 3 0 0 0 0-6H38a3 3 0 0 0 0 6z"/><circle cx="50" cy="32" r="13"/>`,
    r: `${BASE}<path d="M32 74l3-34h30l3 34z"/><path d="M27 42h46v-8H27z"/><path d="M27 34V16h9v7h8v-7h12v7h8v-7h9v18z"/><path class="line" d="M35 48h30M34 66h32"/>`,
    n: `${BASE}<path d="M34 74c0-13 5-19 11-24-6 2-14 4-20-1-4-4-2-10 4-14 4-6 10-14 16-19l2-8 6 8c13 2 21 15 19 35-2 11-5 18-5 23z"/><circle class="eye" cx="45" cy="29" r="2.6"/><path class="line" d="M58 22c6 6 9 16 8 30"/>`,
    b: `${BASE}<path d="M38 74c-2-12 2-20 6-24h12c4 4 8 12 6 24z"/><path d="M36 50h28a3 3 0 0 0 0-6H36a3 3 0 0 0 0 6z"/><path d="M50 12c-12 11-16 21-10 30h20c6-9 2-19-10-30z"/><circle cx="50" cy="9" r="4.5"/><path class="line" d="M55 22l-9 12"/>`,
    q: `${BASE}<path d="M34 74c2-14 6-22 8-28h16c2 6 6 14 8 28z"/><path d="M36 48h28a3 3 0 0 0 0-6H36a3 3 0 0 0 0 6z"/><path d="M27 20l9 22h28l9-22-12 13-11-19-11 19z"/><circle cx="27" cy="18" r="4.5"/><circle cx="50" cy="11" r="4.5"/><circle cx="73" cy="18" r="4.5"/><circle cx="38.5" cy="29" r="3.2"/><circle cx="61.5" cy="29" r="3.2"/>`,
    k: `${BASE}<path d="M34 74c2-14 6-22 8-28h16c2 6 6 14 8 28z"/><path d="M36 48h28a3 3 0 0 0 0-6H36a3 3 0 0 0 0 6z"/><path d="M31 25c0 10 4 15 7 17h24c3-2 7-7 7-17-8 4-14 3-19-1-5 4-11 5-19 1z"/><path d="M47 4h6v8h7v6h-7v9h-6v-9h-7v-6h7z"/>`,
  };
  const pieceSvg = (p) => {
    const w = p === p.toUpperCase();
    return `<svg viewBox="0 0 100 100" class="pz ${w ? 'w' : 'b'}" aria-hidden="true"><g fill="url(#cg${w ? 'W' : 'B'})">${SHAPES[p.toLowerCase()]}</g></svg>`;
  };
  function ensureDefs() {
    if (document.getElementById('chessDefs')) return;
    const d = document.createElement('div');
    d.id = 'chessDefs';
    d.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    d.innerHTML = `<svg width="0" height="0"><defs>
      <linearGradient id="cgW" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".55" stop-color="#F1E7D2"/><stop offset="1" stop-color="#CDBB98"/></linearGradient>
      <linearGradient id="cgB" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5A4A3E"/><stop offset=".45" stop-color="#2A211B"/><stop offset="1" stop-color="#110D0A"/></linearGradient>
    </defs></svg>`;
    document.body.appendChild(d);
  }

  // ---------- state kept between updates ----------
  let G = null;          // layout
  let flip = false;
  let selected = null;   // square name of the picked piece
  let promo = null;      // { from, to } waiting for a choice
  let drag = null;       // { from, el, start: [x, y], moved }
  let pieces = new Map(); // square → element
  let lastMoveKey = '';
  let clockAt = 0;
  let clockTimer = null;
  let confirmKind = null; // 'resign' | 'double' — second tap confirms
  let shownResultFor = 0; let resultAt = 0;
  let ctxRef = null;

  const sqName = (i) => FILES[i % 8] + (8 - Math.floor(i / 8));
  const sqIndex = (n) => (8 - Number(n[1])) * 8 + FILES.indexOf(n[0]);
  // where a square is drawn (column, row from the top-left of the board)
  const cellOf = (n) => { const i = sqIndex(n); const r = Math.floor(i / 8), c = i % 8; return flip ? [7 - c, 7 - r] : [c, r]; };
  const nameAt = (col, row) => { const [c, r] = flip ? [7 - col, 7 - row] : [col, row]; return FILES[c] + (8 - r); };

  function build(ctx) {
    ctxRef = ctx;
    ensureDefs();
    G = L[ctx.layout];
    pieces = new Map(); lastMoveKey = ''; selected = null; promo = null; drag = null;
    const B = G.board;
    const room = ctx.h('div', 'chess-room');
    room.innerHTML = `
      <div class="chess-lamp"></div>
      <div class="chess-frame" style="left:${B.x - 24}px;top:${B.y - 24}px;width:${B.size + 48}px;height:${B.size + 48}px"></div>
      <div class="chess-board" id="cBoard" style="left:${B.x}px;top:${B.y}px;width:${B.size}px;height:${B.size}px;--cell:${B.size / 8}px">
        <div class="sqs" id="cSqs"></div><div class="pcs" id="cPcs"></div><div class="fx" id="cFx"></div>
      </div>
      <div class="chess-ui" id="cUi"></div>`;
    ctx.stage.appendChild(room);
    const sqs = room.querySelector('#cSqs');
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const s = ctx.h('div', 'sq ' + ((r + c) % 2 ? 'dark' : 'light'));
      s.dataset.col = c; s.dataset.row = r;
      sqs.appendChild(s);
    }
    const board = room.querySelector('#cBoard');
    board.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    ctx.controls.innerHTML = `<section class="chess-bar" id="cBar">
        <div class="cb-info"><small id="cLabel">Game for</small><strong id="cAmount">–</strong><em id="cNote"></em></div>
        <div class="cb-cube" id="cCubeBar"></div>
        <div class="cb-actions" id="cActions"></div>
      </section>`;
    clearInterval(clockTimer);
    clockTimer = setInterval(tickClocks, 100);
  }

  // ---------- input: tap or drag ----------
  const st = () => (window.App && App.S ? App.S.state : null);
  const legalMoves = () => (st() && st().legal) || [];
  function squareFromEvent(e) {
    const board = document.getElementById('cBoard');
    if (!board) return null;
    const r = board.getBoundingClientRect();
    const col = Math.floor(((e.clientX - r.left) / r.width) * 8), row = Math.floor(((e.clientY - r.top) / r.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    return nameAt(col, row);
  }
  function onDown(e) {
    const name = squareFromEvent(e);
    if (!name || !legalMoves().length) return;
    if (selected && targetsOf(selected).includes(name)) { e.preventDefault(); tryMove(selected, name); return; }
    if (!legalMoves().some((m) => m.startsWith(name))) { selected = null; promo = null; paintMarks(); return; }
    e.preventDefault();
    selected = name; promo = null;
    paintMarks();
    const el = pieces.get(name);
    if (el) drag = { from: name, el, start: [e.clientX, e.clientY], moved: false };
  }
  function onMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.start[0], dy = e.clientY - drag.start[1];
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    drag.moved = true;
    const board = document.getElementById('cBoard');
    const r = board.getBoundingClientRect();
    const cell = r.width / 8, scale = r.width / G.board.size;
    const x = (e.clientX - r.left - cell / 2) / scale, y = (e.clientY - r.top - cell / 2) / scale;
    drag.el.classList.add('dragging');
    drag.el.style.transform = `translate(${x}px, ${y}px) scale(1.12)`;
  }
  function onUp(e) {
    if (!drag) return;
    const d = drag; drag = null;
    d.el.classList.remove('dragging');
    if (!d.moved) return;                         // a tap: the piece stays picked
    const to = squareFromEvent(e);
    if (to && to !== d.from && targetsOf(d.from).includes(to)) { place(d.el, to, true); tryMove(d.from, to); }
    else place(d.el, d.from, false);              // back where it was
  }
  const targetsOf = (from) => legalMoves().filter((m) => m.startsWith(from)).map((m) => m.slice(2, 4));
  function tryMove(from, to) {
    const options = legalMoves().filter((m) => m.slice(0, 4) === from + to);
    if (!options.length) return;
    if (options.length > 1) { promo = { from, to }; paintUi(); return; }   // a pawn reaches the last rank
    ctxRef.send({ t: 'action', action: 'move', amount: options[0] });
    selected = null; promo = null;
    paintMarks();
  }

  // ---------- drawing ----------
  function place(el, name, animate) {
    const [c, r] = cellOf(name);
    const cell = G.board.size / 8;
    el.classList.toggle('no-anim', !animate);
    el.style.transform = `translate(${c * cell}px, ${r * cell}px)`;
  }

  function render(state, S, ctx) {
    ctxRef = ctx;
    const me = state.mySeat;
    const mine = me !== -1 && state.seats[me] ? state.seats[me].color : null;
    const newFlip = mine === 'b';
    if (newFlip !== flip) { flip = newFlip; pieces.forEach((el, n) => place(el, n, false)); }
    if (selected && !legalMoves().some((m) => m.startsWith(selected))) selected = null;
    if (promo && !legalMoves().length) promo = null;
    paintSquares(state);
    paintPieces(state);
    paintMarks();
    paintUi();
    clockAt = Date.now();
  }

  function paintSquares(state) {
    for (const s of document.querySelectorAll('#cSqs .sq')) {
      const name = nameAt(Number(s.dataset.col), Number(s.dataset.row));
      s.dataset.sq = name;
      const col = Number(s.dataset.col), row = Number(s.dataset.row);
      s.innerHTML = (col === 0 ? `<span class="coord rank">${name[1]}</span>` : '') + (row === 7 ? `<span class="coord file">${name[0]}</span>` : '');
      s.classList.toggle('last', !!(state.last && (state.last.from === name || state.last.to === name)));
      s.classList.toggle('check', !!state.check && state.board[sqIndex(name)] === (state.turn === 'w' ? 'K' : 'k'));
    }
  }

  // Reuse piece elements: the piece that moved slides from its old square.
  function paintPieces(state) {
    const layer = document.getElementById('cPcs');
    const want = new Map();
    state.board.forEach((p, i) => { if (p) want.set(sqName(i), p); });
    const moveKey = `${state.handNo}:${(state.moves || []).length}`;
    const next = new Map();
    const reuse = (from, to) => {
      const el = pieces.get(from);
      if (!el) return false;
      pieces.delete(from);
      if (el.dataset.p !== want.get(to)) { el.dataset.p = want.get(to); el.innerHTML = pieceSvg(want.get(to)); }   // promotion
      next.set(to, el);
      place(el, to, true);
      return true;
    };
    if (moveKey !== lastMoveKey && state.last && pieces.has(state.last.from) && !pieces.get(state.last.from).classList.contains('dragging')) {
      const { from, to } = state.last;
      const gone = pieces.get(to);                         // a captured piece fades out
      if (gone && from !== to) { pieces.delete(to); gone.classList.add('taken'); setTimeout(() => gone.remove(), 260); }
      reuse(from, to);
      // castling: the rook moves too
      const p = want.get(to);
      if (p && p.toLowerCase() === 'k' && Math.abs(FILES.indexOf(from[0]) - FILES.indexOf(to[0])) === 2) {
        const rank = to[1], kside = to[0] === 'g';
        reuse((kside ? 'h' : 'a') + rank, (kside ? 'f' : 'd') + rank);
      }
    }
    lastMoveKey = moveKey;
    // everything else: keep what is right, add what is missing, remove the rest
    for (const [n, p] of want) {
      if (next.has(n)) continue;
      const el = pieces.get(n);
      if (el && el.dataset.p === p) { pieces.delete(n); next.set(n, el); continue; }
      const fresh = document.createElement('div');
      fresh.className = 'piece';
      fresh.dataset.p = p;
      fresh.innerHTML = pieceSvg(p);
      place(fresh, n, false);
      layer.appendChild(fresh);
      next.set(n, fresh);
    }
    for (const el of pieces.values()) el.remove();
    pieces = next;
  }

  function paintMarks() {
    const state = st();
    const fx = document.getElementById('cFx');
    if (!fx || !state) return;
    fx.replaceChildren();
    const cell = G.board.size / 8;
    const mark = (n, cls) => { const [c, r] = cellOf(n); const m = document.createElement('div'); m.className = 'mark ' + cls; m.style.transform = `translate(${c * cell}px, ${r * cell}px)`; fx.appendChild(m); };
    if (selected) {
      mark(selected, 'sel');
      for (const t of targetsOf(selected)) mark(t, state.board[sqIndex(t)] ? 'hit' : 'dot');
    }
    document.getElementById('cBoard').classList.toggle('my-turn', legalMoves().length > 0);
  }

  function fmtClock(ms) {
    ms = Math.max(0, ms);
    if (ms < 10000) return `0:${String(Math.floor(ms / 1000)).padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`;
    const t = Math.ceil(ms / 1000);
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }
  function tickClocks() {
    const state = st();
    if (!state || state.game !== 'chess') return;
    if (state.running !== -1 && state.clocks) {
      const el = document.querySelector(`[data-clock="${state.running}"]`);
      if (el) { const left = state.clocks[state.running] - (Date.now() - clockAt); el.textContent = fmtClock(left); el.classList.toggle('low', left < 20000); }
    }
    const cd = document.getElementById('cNext');
    if (cd) cd.textContent = Math.max(0, Math.ceil((resultAt + NEXT_GAME_MS - Date.now()) / 1000));
  }

  // ---------- players, cube, moves, messages, the bar ----------
  function material(caps) { return (caps || []).reduce((a, p) => a + VALUE[p.toLowerCase()], 0); }

  function paintUi() {
    const state = st(), ctx = ctxRef;
    const ui = document.getElementById('cUi');
    if (!state || !ui) return;
    const port = ctx.layout === 'port';
    const B = G.board;
    const me = state.mySeat;
    ui.replaceChildren();
    // who sits where: the opponent at the top, you (or white, when watching) at the bottom
    const byColor = (c) => state.seats.findIndex((s) => s && s.color === c);
    let top = byColor(flip ? 'w' : 'b'), bottom = byColor(flip ? 'b' : 'w');
    if (top === -1 || bottom === -1) { bottom = me !== -1 ? me : state.seats.findIndex(Boolean); top = state.seats.findIndex((s, i) => s && i !== bottom); }
    const winner = state.results && state.results.winners && state.results.winners[0] ? state.results.winners[0].seat : -2;
    const plate = (i, where) => {
      const s = i !== -1 ? state.seats[i] : null;
      const running = state.running === i && i !== -1;
      const el = ctx.h('div', `cplate ${where}${running ? ' running' : ''}${winner === i ? ' winner' : ''}${!s ? ' empty' : ''}`);
      if (s) {
        const color = s.color;
        const other = color ? state.captured[color === 'w' ? 'b' : 'w'] : [];
        const adv = color ? material(state.captured[color]) - material(other) : 0;
        const level = s.botLevel ? ['', 'Bot · easy', 'Bot · medium', 'Bot · strong'][s.botLevel] : '';
        const caps = color ? state.captured[color] : [];
        el.innerHTML = `<span class="avatar">${ctx.avatarHtml(s)}</span>
          <span class="col"><span class="name">${ctx.nameHtml(s)}</span>
            <span class="sub">${color ? `<i class="dot ${color}"></i>` : ''}<span>${ctx.fmt(s.chips)}</span>${level ? `<span class="lvl">${level}</span>` : ''}</span>
            <span class="caps">${caps.map((p) => `<span class="cap">${pieceSvg(p)}</span>`).join('')}${adv > 0 ? `<b class="adv">+${adv}</b>` : ''}</span></span>
          <span class="clock${running ? ' on' : ''}" data-clock="${i}">${fmtClock(state.clocks ? state.clocks[i] : state.minutes * 60000)}</span>`;
        if (s.hasAccount && !s.isBot) { el.classList.add('clickable'); el.onclick = () => App.openProfile(s.name); }
      } else el.innerHTML = '<span class="avatar">+</span><span class="col"><span class="name">Open seat</span><span class="sub">Waiting for an opponent</span></span>';
      const y = where === 'top' ? (port ? B.y - 106 : B.y) : (port ? B.y + B.size + 30 : B.y + B.size - 112);
      const x = port ? B.x : G.left.x;
      Object.assign(el.style, { left: x + 'px', top: y + 'px', width: (port ? B.size : G.left.w) + 'px' });
      ui.appendChild(el);
      if (i !== -1) ctx.plates[i] = [x + (port ? B.size / 2 : G.left.w / 2), y];
    };
    plate(top, 'top');
    plate(bottom, 'bottom');

    // the cube (on a computer beside the board; on a phone in the bar)
    const offered = state.offer && state.offer.kind === 'double';
    const cubeHtml = `<b>×${offered ? state.cube * 2 : state.cube}</b><small>${offered ? 'offered' : state.cubeOwner === -1 ? 'cube' : state.cubeOwner === me ? 'yours' : 'theirs'}</small>`;
    if (!port) {
      const cube = ctx.h('div', 'cube' + (offered ? ' offered' : ''), cubeHtml);
      const y = state.cubeOwner === -1 ? B.y + B.size / 2 - 36 : state.cubeOwner === top ? B.y + 150 : B.y + B.size - 222;
      Object.assign(cube.style, { left: G.left.x + G.left.w - 72 + 'px', top: y + 'px' });
      ui.appendChild(cube);
    }
    document.getElementById('cCubeBar').innerHTML = port ? `<div class="cube mini${offered ? ' offered' : ''}">${cubeHtml}</div>` : '';

    // the moves: a list on a computer, a strip on a phone
    const mv = state.moves || [];
    if (!port) {
      const list = ctx.h('div', 'cmoves');
      let html = '<h5>Moves</h5><ol>';
      for (let k = 0; k < mv.length; k += 2) html += `<li><span class="${k === mv.length - 1 ? 'now' : ''}">${ctx.esc(mv[k])}</span><span class="${k + 1 === mv.length - 1 ? 'now' : ''}">${mv[k + 1] ? ctx.esc(mv[k + 1]) : ''}</span></li>`;
      list.innerHTML = html + '</ol>' + (mv.length ? '' : '<p class="none">No moves yet</p>');
      Object.assign(list.style, { left: G.side.x + 'px', top: B.y + 'px', width: G.side.w + 'px', height: B.size + 'px' });
      ui.appendChild(list);
      const ol = list.querySelector('ol');
      requestAnimationFrame(() => { ol.scrollTop = ol.scrollHeight; });
    } else if (mv.length) {
      const strip = ctx.h('div', 'cstrip', mv.slice(-8).map((m, k, a) => `<span class="${k === a.length - 1 ? 'now' : ''}">${(mv.length - a.length + k) % 2 === 0 ? `<i>${Math.floor((mv.length - a.length + k) / 2) + 1}.</i>` : ''}${ctx.esc(m)}</span>`).join(''));
      Object.assign(strip.style, { left: B.x + 'px', top: B.y + B.size + 110 + 'px', width: B.size + 'px' });
      ui.appendChild(strip);
    }

    // cards over the board: waiting, a double or a draw to answer, the result, the promotion
    const card = (cls, html) => { const c = ctx.h('div', 'ccard ' + cls, html); Object.assign(c.style, { left: B.x + B.size / 2 + 'px', top: B.y + B.size / 2 + 'px' }); ui.appendChild(c); return c; };
    const seated = state.seats.filter(Boolean).length;
    if (state.stage === 'waiting' && me !== -1 && seated < 2) {
      const c = card('wait', `<h4>Waiting for an opponent</h4><p>Invite a friend — or play a bot right away:</p>
        <div class="levels"><button data-l="1">Easy</button><button data-l="2">Medium</button><button data-l="3">Strong</button></div>
        <button class="link" data-invite>Invite a friend</button>`);
      c.querySelectorAll('[data-l]').forEach((b) => { b.onclick = () => ctx.send({ t: 'addBot', level: Number(b.dataset.l) }); });
      c.querySelector('[data-invite]').onclick = () => ctx.openDrawer('table');
    } else if (state.stage === 'waiting' && seated === 2) card('wait small', '<p>The next game starts in a moment…</p>');
    if (state.stage === 'playing' && state.offer && state.toAct === me) {
      const c = offered
        ? card('offer', `<h4>${ctx.esc(state.seats[state.offer.from].name)} doubles</h4><p>Play on for <b>${ctx.fmt(state.amount * 2)}</b> — or give up <b>${ctx.fmt(state.amount)}</b> now.</p>
            <div class="row"><button class="gold" data-a="take">Take</button><button data-a="drop">Decline</button></div>`)
        : card('offer', `<h4>${ctx.esc(state.seats[state.offer.from].name)} offers a draw</h4><p>A draw: nobody wins or loses chips.</p>
            <div class="row"><button class="gold" data-a="accept">Accept</button><button data-a="decline">Play on</button></div>`);
      c.querySelectorAll('[data-a]').forEach((b) => { b.onclick = () => ctx.send({ t: 'action', action: b.dataset.a }); });
    } else if (state.stage === 'playing' && state.offer) card('wait small', `<p>${offered ? 'Waiting for the answer to the double…' : 'Waiting for the answer to the draw offer…'}</p>`);
    if (state.stage === 'showdown' && state.results) {
      if (shownResultFor !== state.handNo) { shownResultFor = state.handNo; resultAt = Date.now(); }
      const r = state.results;
      const w = r.winners[0];
      const mineWon = w && w.seat === me, mineLost = w && me !== -1 && w.seat !== me && state.seats[me] && state.seats[me].color;
      const title = r.draw ? 'Draw' : mineWon ? 'You win!' : mineLost ? 'You lose' : `${state.seats[w.seat] ? state.seats[w.seat].name : 'A player'} wins`;
      const chips = r.draw ? '±0' : mineWon ? `+${ctx.fmt(w.amount)}` : mineLost ? `−${ctx.fmt(w.amount)}` : ctx.fmt(w.amount);
      card('result ' + (r.draw ? 'draw' : mineWon ? 'won' : mineLost ? 'lost' : ''), `<h4>${title}</h4><p class="why"></p><strong>${chips}</strong>
        ${r.cube > 1 ? `<small class="cubeinfo">Cube ×${r.cube}</small>` : ''}<small>Next game in <b id="cNext">${Math.ceil(NEXT_GAME_MS / 1000)}</b> s</small>`)
        .querySelector('.why').textContent = r.reason;
    }
    if (promo) {
      const color = state.seats[me] && state.seats[me].color === 'b' ? 'b' : 'w';
      const c = card('promo', '<p>Promote to</p><div class="row"></div>');
      for (const k of ['q', 'r', 'b', 'n']) {
        const b = ctx.h('button', '', pieceSvg(color === 'w' ? k.toUpperCase() : k));
        b.onclick = () => { ctx.send({ t: 'action', action: 'move', amount: promo.from + promo.to + k }); promo = null; selected = null; paintMarks(); paintUi(); };
        c.querySelector('.row').appendChild(b);
      }
    }
    paintBar(state, ctx);
  }

  function paintBar(state, ctx) {
    const me = state.mySeat;
    const box = document.getElementById('cActions');
    if (!box) return;
    box.replaceChildren();
    document.getElementById('cAmount').textContent = ctx.fmt(state.amount || state.stake);
    document.getElementById('cLabel').textContent = state.cube > 1 ? `Game for (cube ×${state.cube})` : 'Game for';
    const playing = state.stage === 'playing' && me !== -1 && state.seats[me] && state.seats[me].color;
    const btn = (label, cls, fn, disabled) => { const b = ctx.h('button', 'cbtn ' + cls, label); b.disabled = !!disabled; b.onclick = fn; box.appendChild(b); return b; };
    let note = `Stake ${ctx.fmt(state.stake)} · ${state.minutes} min each`;
    if (playing && !state.offer) {
      note = state.toAct === me ? (state.check ? 'Check! Your move.' : 'Your move — tap or drag a piece.') : 'Your opponent is thinking…';
      // a second tap confirms doubling and resigning
      btn(confirmKind === 'double' ? `Sure? Double to ${ctx.fmt(state.nextAmount)}` : `Double to ${ctx.fmt(state.nextAmount)}`, 'gold' + (confirmKind === 'double' ? ' confirm' : ''),
        () => { if (confirmKind === 'double') { confirmKind = null; ctx.send({ t: 'action', action: 'double' }); } else arm('double'); }, !state.canDouble);
      btn('Offer a draw', 'quiet', () => ctx.send({ t: 'action', action: 'draw' }), state.toAct !== me);
      btn(confirmKind === 'resign' ? `Sure? Lose ${ctx.fmt(state.amount)}` : 'Resign', 'quiet' + (confirmKind === 'resign' ? ' confirm danger' : ''),
        () => { if (confirmKind === 'resign') { confirmKind = null; ctx.send({ t: 'action', action: 'resign' }); } else arm('resign'); });
    } else if (playing) note = state.toAct === me ? 'Answer the offer on the board.' : 'Waiting for your opponent…';
    else if (state.stage === 'waiting') note = 'The game starts as soon as two players sit down.';
    else if (me === -1) note = 'You are watching.';
    document.getElementById('cNote').textContent = note;
    document.getElementById('cBar').classList.toggle('my-turn', !!(playing && state.toAct === me));
  }
  function arm(kind) {
    confirmKind = kind;
    paintBar(st(), ctxRef);
    clearTimeout(arm.t);
    arm.t = setTimeout(() => { confirmKind = null; if (st()) paintBar(st(), ctxRef); }, 3500);
  }

  window.TableUI.chess = { size: { land: [1440, 780], port: [440, 666] }, build, render };
  // the lobby card shows the same pieces
  function lobbyArt() {
    const art = document.querySelector('.chess-art');
    if (!art || art.dataset.done) return;
    ensureDefs();
    art.dataset.done = '1';
    art.innerHTML = `<span class="ca-k">${pieceSvg('K')}</span><span class="ca-q">${pieceSvg('q')}</span><span class="ca-n">${pieceSvg('N')}</span><span class="ca-cube">×2</span>`;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', lobbyArt); else lobbyArt();
  setTimeout(lobbyArt, 500);
})();
