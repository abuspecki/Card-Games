// Browser client: connects to the server, renders the table, sends actions.
const $ = (id) => document.getElementById(id);
const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
// Seat positions around the table (percent of table box), starting bottom-center, clockwise.
const POS = [[50, 102], [14, 90], [-4, 50], [14, 8], [50, -4], [86, 8], [104, 50], [86, 90]];

let ws = null;
let S = null; // latest state message
let myTurnBefore = false;
let raiseTouched = false;

// ---------- lobby ----------
$('name').value = localStorage.getItem('poker.name') || '';
const params = new URLSearchParams(location.search);
if (params.get('room')) $('roomCode').value = params.get('room');

$('createBtn').onclick = () => join('');
$('practiceBtn').onclick = () => join('', Number($('botCount').value));
$('joinBtn').onclick = () => join($('roomCode').value.trim());
$('roomCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });

function join(code, bots = 0) {
  const name = $('name').value.trim();
  if (!name) { $('lobbyError').textContent = 'Enter your name first'; return; }
  localStorage.setItem('poker.name', name);
  Sound.unlock();
  connect(() => {
    const token = code ? localStorage.getItem('poker.token.' + code.toUpperCase()) : null;
    send({ t: 'join', room: code, name, token, bots });
  });
}

function connect(onOpen) {
  if (ws) ws.close();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = onOpen;
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = () => {
    if (S) { toast('Connection lost — reconnecting…'); setTimeout(() => rejoin(), 1500); }
  };
}

function rejoin() {
  if (!S) return;
  const code = S.room;
  connect(() => send({ t: 'join', room: code, name: $('name').value, token: localStorage.getItem('poker.token.' + code) }));
}

const send = (m) => ws && ws.readyState === 1 && ws.send(JSON.stringify(m));

function handle(m) {
  if (m.t === 'joined') {
    localStorage.setItem('poker.token.' + m.room, m.token);
    history.replaceState(null, '', '?room=' + m.room);
    $('lobby').classList.add('hidden');
    $('game').classList.remove('hidden');
  } else if (m.t === 'error') {
    if (!S) $('lobbyError').textContent = m.msg; else toast(m.msg);
  } else if (m.t === 'sfx') {
    Sound.play(m.name);
  } else if (m.t === 'state') {
    S = m;
    render();
  }
}

// ---------- rendering ----------
function cardEl(c, cls = '') {
  const d = document.createElement('div');
  if (!c) { d.className = `card back ${cls}`; return d; }
  const red = c[1] === 'h' || c[1] === 'd';
  d.className = `card ${red ? 'red' : ''} ${cls}`;
  d.dataset.card = c;
  d.innerHTML = `<span class="r">${c[0] === 'T' ? '10' : c[0]}</span><span class="s">${SUIT[c[1]]}</span>`;
  return d;
}

function render() {
  const st = S.state;
  $('roomLabel').textContent = S.room;
  $('variantLabel').textContent = st.variantName + (st.stage === 'waiting' ? '' : ` · Hand #${st.handNo}`);
  const winCards = new Set();
  const winSeats = new Set();
  if (st.stage === 'showdown' && st.results) {
    for (const w of st.results.winners) { winSeats.add(w.seat); (w.cards || []).forEach((c) => winCards.add(c)); }
  }

  // Board
  const board = $('board');
  const shown = [...board.children].map((c) => c.dataset.card).join();
  if (shown !== st.board.join() || board.dataset.hand !== String(st.handNo)) {
    board.innerHTML = '';
    st.board.forEach((c) => board.appendChild(cardEl(c)));
    board.dataset.hand = st.handNo;
  }
  [...board.children].forEach((el) => el.classList.toggle('win', winCards.has(el.dataset.card)));
  $('pot').textContent = st.pot ? `Pot: ${st.pot}` : '';

  // Center message
  let msg = '';
  if (st.stage === 'waiting') {
    const n = st.seats.filter((s) => s && s.chips > 0).length;
    msg = n < 2 ? (S.isHost ? `Share room code ${S.room} or add a bot to play` : 'Waiting for players…') : (S.isHost ? 'Press Deal to start' : 'Waiting for the host to deal');
  } else if (st.stage === 'showdown' && st.results) {
    msg = st.results.winners.map((w) => `${st.seats[w.seat]?.name ?? 'Player'} wins ${w.amount}${w.hand ? ' with ' + w.hand : ''}`).join(' · ');
  } else if (st.toAct !== -1 && st.seats[st.toAct]) {
    msg = st.toAct === st.mySeat ? 'Your turn' : `${st.seats[st.toAct].name} is thinking…`;
  }
  $('message').textContent = msg;

  // Seats
  const seatsEl = $('seats');
  seatsEl.innerHTML = '';
  const me = st.mySeat === -1 ? 0 : st.mySeat;
  st.seats.forEach((s, i) => {
    const pos = POS[(i - me + 8) % 8];
    if (!s) {
      const e = document.createElement('div');
      e.className = 'empty-seat';
      e.style.left = pos[0] + '%'; e.style.top = pos[1] + '%';
      e.textContent = 'Open seat';
      seatsEl.appendChild(e);
      return;
    }
    const el = document.createElement('div');
    const isMe = i === st.mySeat;
    el.className = 'seat' + (isMe ? ' me' : '') + (i === st.toAct ? ' turn' : '')
      + (s.folded && st.stage !== 'waiting' ? ' folded' : '') + (!s.connected ? ' away' : '') + (winSeats.has(i) ? ' winner' : '');
    el.style.left = pos[0] + '%'; el.style.top = pos[1] + '%';

    const hole = document.createElement('div');
    hole.className = 'hole';
    if (s.inHand && (!s.folded || isMe) && st.stage !== 'waiting') {
      const cards = s.hole || new Array(s.cardCount).fill(null);
      cards.forEach((c) => hole.appendChild(cardEl(c, (isMe ? '' : 'small') + (winCards.has(c) ? ' win' : ''))));
    }
    el.appendChild(hole);

    const plate = document.createElement('div');
    plate.className = 'plate';
    plate.innerHTML = `<div class="nm"></div><div class="ch">${s.chips}${s.allIn ? ' · ALL-IN' : ''}</div>`;
    plate.querySelector('.nm').textContent = s.name;
    if (s.isBot) plate.querySelector('.nm').insertAdjacentHTML('afterbegin', '<span class="bot" title="Computer player">🤖</span>');
    if (i === st.button && st.stage !== 'waiting') {
      const d = document.createElement('div'); d.className = 'dealer'; d.textContent = 'D'; plate.style.position = 'relative'; plate.appendChild(d);
    }
    el.appendChild(plate);

    if (s.handName && st.stage !== 'waiting') {
      const h = document.createElement('div'); h.className = 'handname'; h.textContent = s.handName; el.appendChild(h);
    }
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.textContent = s.lastAction || '';
    if (!s.lastAction) tag.style.visibility = 'hidden';
    el.appendChild(tag);

    if (s.bet > 0) {
      const b = document.createElement('div');
      b.className = 'bet';
      b.textContent = s.bet;
      // Place the bet toward the center of the table.
      const dx = 50 - pos[0], dy = 50 - pos[1];
      b.style.left = `calc(50% + ${dx * 1.4}px)`;
      b.style.top = `calc(50% + ${dy * 1.6}px)`;
      b.style.transform = 'translate(-50%, -50%)';
      el.appendChild(b);
    }
    seatsEl.appendChild(el);

    if (isMe && s.chips === 0 && !(s.inHand && ['preflop', 'flop', 'turn', 'river'].includes(st.stage))) {
      const rb = document.createElement('button');
      rb.className = 'small'; rb.textContent = 'Rebuy';
      rb.onclick = () => send({ t: 'rebuy' });
      el.appendChild(rb);
    }
  });

  renderHost(st);
  renderOdds(st);
  renderRankings(st);
  renderActions(st);
  renderLog(st);
}

function renderHost(st) {
  $('hostPanel').classList.toggle('hidden', !S.isHost);
  if (!S.isHost) return;
  const sel = $('variantSelect');
  if (sel.options.length === 0) {
    for (const [k, v] of Object.entries(st.variants)) sel.add(new Option(v, k));
  }
  const active = document.activeElement;
  if (active !== sel) sel.value = st.settings.variant;
  $('rotate').checked = st.settings.rotate;
  $('showOdds').checked = st.settings.showOdds;
  if (active !== $('bigBlind')) $('bigBlind').value = st.settings.bigBlind;
  if (active !== $('stack')) $('stack').value = st.settings.startingStack;
  const playing = ['preflop', 'flop', 'turn', 'river'].includes(st.stage);
  $('addBotBtn').disabled = st.seats.every(Boolean);
  $('removeBotBtn').disabled = !st.seats.some((s) => s && s.isBot);
  $('startBtn').disabled = playing || st.seats.filter((s) => s && s.chips > 0).length < 2;
  $('startBtn').textContent = st.stage === 'showdown' ? 'Deal now' : 'Deal';
}

$('variantSelect').onchange = (e) => send({ t: 'settings', variant: e.target.value });
$('rotate').onchange = (e) => send({ t: 'settings', rotate: e.target.checked });
$('showOdds').onchange = (e) => send({ t: 'settings', showOdds: e.target.checked });
$('bigBlind').onchange = (e) => send({ t: 'settings', bigBlind: e.target.value });
$('stack').onchange = (e) => send({ t: 'settings', startingStack: e.target.value });
$('startBtn').onclick = () => send({ t: 'start' });
$('addBotBtn').onclick = () => send({ t: 'addBot' });
$('removeBotBtn').onclick = () => send({ t: 'removeBot' });

function renderActions(st) {
  const lim = st.limits;
  const myTurn = !!lim;
  if (myTurn && !myTurnBefore) { Sound.play('turn'); raiseTouched = false; }
  myTurnBefore = myTurn;
  $('actions').classList.toggle('hidden', !myTurn);
  if (!myTurn) return;
  const me = st.seats[st.mySeat];
  $('foldBtn').classList.toggle('hidden', lim.toCall === 0);
  $('callBtn').textContent = lim.toCall === 0 ? 'Check' : (lim.toCall >= me.chips ? `All-in ${lim.toCall}` : `Call ${lim.toCall}`);
  const raiseOk = lim.canRaise && me.chips > lim.toCall;
  document.querySelector('.raise-box').classList.toggle('hidden', !raiseOk);
  $('raiseBtn').classList.toggle('hidden', !raiseOk);
  if (!raiseOk) return;
  const slider = $('raiseSlider'), input = $('raiseInput');
  slider.min = input.min = lim.minTo;
  slider.max = input.max = lim.maxTo;
  slider.step = 1;
  if (!raiseTouched) setRaise(lim.minTo);
  updateRaiseLabel();
}

function setRaise(v) {
  const lim = S.state.limits;
  v = Math.max(lim.minTo, Math.min(lim.maxTo, Math.round(v)));
  $('raiseSlider').value = v;
  $('raiseInput').value = v;
  updateRaiseLabel();
}

function updateRaiseLabel() {
  const st = S.state;
  const v = Number($('raiseInput').value);
  const allIn = v >= st.limits.maxTo && st.limits.maxTo === st.limits.bet + st.seats[st.mySeat].chips;
  $('raiseBtn').textContent = allIn ? `All-in ${v}` : (st.currentBet === 0 ? `Bet ${v}` : `Raise to ${v}`);
}

$('raiseSlider').oninput = (e) => { raiseTouched = true; setRaise(Number(e.target.value)); };
$('raiseInput').oninput = () => { raiseTouched = true; updateRaiseLabel(); };
$('raiseInput').onchange = (e) => setRaise(Number(e.target.value));
document.querySelectorAll('[data-preset]').forEach((b) => {
  b.onclick = () => {
    const st = S.state, lim = st.limits;
    const potRaise = st.currentBet + st.pot + lim.toCall;
    const val = { min: lim.minTo, half: st.currentBet + (st.pot + lim.toCall) / 2, pot: potRaise, max: lim.maxTo }[b.dataset.preset];
    raiseTouched = true;
    setRaise(val);
  };
});
$('foldBtn').onclick = () => send({ t: 'action', action: 'fold' });
$('callBtn').onclick = () => send({ t: 'action', action: S.state.limits.toCall === 0 ? 'check' : 'call' });
$('raiseBtn').onclick = () => send({ t: 'action', action: 'raise', amount: Number($('raiseInput').value) });

// Keyboard shortcuts: F fold, C check/call, R raise, O odds, H hand rankings, Esc close
document.addEventListener('keydown', (e) => {
  if (!S || ['INPUT', 'SELECT'].includes(document.activeElement.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === 'escape') $('rankingsModal').classList.add('hidden');
  if (k === 'h') $('rankingsBtn').click();
  if (k === 'o') $('oddsToggle').click();
  if (!S.state.limits) return;
  if (k === 'f' && !$('foldBtn').classList.contains('hidden')) $('foldBtn').click();
  if (k === 'c') $('callBtn').click();
  if (k === 'r' && !$('raiseBtn').classList.contains('hidden')) $('raiseBtn').click();
});

function renderLog(st) {
  const log = $('log');
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 10;
  log.innerHTML = '';
  for (const entry of st.log) {
    const d = document.createElement('div');
    if (typeof entry === 'object' && entry.chat) {
      d.className = 'chat';
      const b = document.createElement('b'); b.textContent = entry.from + ': ';
      d.appendChild(b); d.appendChild(document.createTextNode(entry.text));
    } else {
      d.className = 'sys';
      d.textContent = entry;
    }
    log.appendChild(d);
  }
  if (atBottom) log.scrollTop = log.scrollHeight;
}

$('chatForm').onsubmit = (e) => {
  e.preventDefault();
  const text = $('chatInput').value.trim();
  if (text) send({ t: 'chat', text });
  $('chatInput').value = '';
};

// ---------- header ----------
$('copyLink').onclick = () => {
  const url = `${location.origin}${location.pathname}?room=${S.room}`;
  navigator.clipboard.writeText(url).then(() => toast('Invite link copied!'), () => toast(url));
};
$('leaveBtn').onclick = () => {
  if (!confirm('Leave the table? You will lose your seat and chips.')) return;
  send({ t: 'leave' });
  localStorage.removeItem('poker.token.' + S.room);
  S = null;
  ws.close();
  location.href = location.pathname;
};
$('muteBtn').textContent = Sound.muted ? '🔇' : '🔊';
$('muteBtn').onclick = () => { $('muteBtn').textContent = Sound.toggleMute() ? '🔇' : '🔊'; };
$('volume').value = Sound.volume;
$('volume').oninput = (e) => { Sound.setVolume(Number(e.target.value)); Sound.play('chips'); };

let toastTimer;
function toast(t) {
  const el = $('toast');
  el.textContent = t;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

// Auto-rejoin after a page refresh if we have a seat token for the room in the URL.
if (params.get('room') && localStorage.getItem('poker.token.' + params.get('room').toUpperCase()) && $('name').value) {
  join(params.get('room'));
}

// ---------- odds window ----------
const HAND_NAMES = ['High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];
let oddsOpen = localStorage.getItem('poker.odds') !== '0';
let oddsWorker = null;
let oddsKey = '';
let oddsResult = null;
let oddsReq = 0;

function setOddsOpen(open) {
  oddsOpen = open;
  localStorage.setItem('poker.odds', open ? '1' : '0');
  $('oddsToggle').classList.toggle('on', open);
  if (S) renderOdds(S.state);
}
$('oddsToggle').onclick = () => setOddsOpen(!oddsOpen);
$('oddsClose').onclick = () => setOddsOpen(false);

function renderOdds(st) {
  const allowed = st.settings.showOdds;
  $('oddsToggle').classList.toggle('hidden', !allowed);
  const panel = $('oddsPanel');
  const me = st.mySeat !== -1 ? st.seats[st.mySeat] : null;
  const inHand = me && me.inHand && !me.folded && me.hole && ['preflop', 'flop', 'turn', 'river', 'showdown'].includes(st.stage);
  panel.classList.toggle('hidden', !allowed || !oddsOpen || st.stage === 'waiting');
  if (panel.classList.contains('hidden')) return;
  const body = $('oddsBody');
  if (!inHand) {
    body.innerHTML = `<div class="muted">${me && me.folded && me.inHand ? 'You folded this hand.' : 'You are not in this hand.'}</div>`;
    return;
  }
  const opponents = st.seats.filter((s, i) => s && i !== st.mySeat && s.inHand && !s.folded).length;
  if (st.stage === 'showdown') {
    const won = st.results && st.results.winners.some((w) => w.seat === st.mySeat);
    body.innerHTML = `<div class="big" style="color:${won ? '#4fd17d' : '#e0606f'}">${won ? 'You won!' : 'Hand over'}</div>`;
    return;
  }
  const key = [st.handNo, me.hole.join(''), st.board.join(''), opponents, st.variant].join('|');
  if (key !== oddsKey) {
    oddsKey = key;
    oddsResult = null;
    if (!oddsWorker) {
      oddsWorker = new Worker('odds-worker.js');
      oddsWorker.onmessage = (e) => { if (e.data.id === oddsReq) { oddsResult = e.data; renderOdds(S.state); } };
    }
    oddsWorker.postMessage({ id: ++oddsReq, hole: me.hole, board: st.board, variant: st.variant, opponents });
  }
  if (!oddsResult) { body.innerHTML = '<div class="muted">Calculating…</div>'; return; }

  const pct = (x) => (x * 100 < 1 && x > 0 ? '<1' : Math.round(x * 100)) + '%';
  const win = oddsResult.win;
  const color = win >= 0.5 ? '#4fd17d' : win >= 1 / (opponents + 1) ? '#f4c95d' : '#e0606f';
  let html = `<div class="big" style="color:${color}">${pct(win)}</div>
    <div class="meter"><div style="width:${win * 100}%;background:${color}"></div></div>
    <div class="muted">chance to win vs ${opponents} player${opponents > 1 ? 's' : ''}${me.handName ? ` · you have <b style="color:#9fe3b5">${me.handName}</b>` : ''}</div>`;

  // Is calling worth it? Compare win chance with the price of the call.
  const lim = st.limits;
  if (lim && lim.toCall > 0) {
    const need = lim.toCall / (st.pot + lim.toCall);
    const good = win >= need;
    html += `<div class="verdict ${good ? 'good' : 'bad'}">Call ${lim.toCall} to win ${st.pot}: you need ${pct(need)}.<br>
      ${good ? '✅ Calling is worth it' : '❌ Calling costs more than it\'s likely to win'}</div>`;
  }

  // What you're likely to end up with by the river.
  if (st.stage !== 'river') {
    const rows = oddsResult.made.map((p, cat) => ({ p, cat })).filter((r) => r.p >= 0.005).sort((a, b) => b.cat - a.cat).slice(0, 6);
    html += '<div class="muted" style="margin-top:6px">By the river you\'ll have:</div><div class="made">';
    for (const r of rows) {
      const now = r.cat === oddsResult.currentCat;
      html += `<span class="${now ? 'now' : ''}">${HAND_NAMES[r.cat]}</span><div class="bar"><div style="width:${r.p * 100}%"></div></div><span class="pct">${pct(r.p)}</span>`;
    }
    html += '</div>';
  }
  html += '<div class="muted" style="margin-top:6px;font-size:11px">Estimate vs. random hands. Nobody\'s cards are peeked.</div>';
  body.innerHTML = html;
}

// ---------- hand rankings ----------
const RANKINGS = [
  { name: 'Royal Flush', cat: 8, cards: 'As Ks Qs Js Ts', desc: 'A, K, Q, J, 10, all the same suit. The best possible hand.' },
  { name: 'Straight Flush', cat: 8, cards: '9h 8h 7h 6h 5h', desc: 'Five cards in a row, all the same suit.' },
  { name: 'Four of a Kind', cat: 7, cards: 'Qc Qd Qh Qs 4d', use: 4, desc: 'Four cards of the same rank.' },
  { name: 'Full House', cat: 6, cards: 'Kh Kd Ks 7c 7h', desc: 'Three of a kind plus a pair.' },
  { name: 'Flush', cat: 5, cards: 'Ad Jd 8d 6d 2d', desc: 'Any five cards of the same suit.' },
  { name: 'Straight', cat: 4, cards: 'Tc 9d 8h 7s 6c', desc: 'Five cards in a row, any suits. Ace can be high (A-K-Q-J-10) or low (5-4-3-2-A).' },
  { name: 'Three of a Kind', cat: 3, cards: '8s 8h 8d Kc 3s', use: 3, desc: 'Three cards of the same rank.' },
  { name: 'Two Pair', cat: 2, cards: 'Jh Jc 4s 4d Ac', use: 4, desc: 'Two different pairs.' },
  { name: 'Pair', cat: 1, cards: 'Ts Th Kd 6c 2h', use: 2, desc: 'Two cards of the same rank.' },
  { name: 'High Card', cat: 0, cards: 'Ad Qs 9c 6h 3d', use: 1, desc: 'Nothing else. Your highest card plays.' },
];

function renderRankings(st) {
  if ($('rankingsModal').classList.contains('hidden')) return;
  const list = $('rankingsList');
  const me = st && st.mySeat !== -1 ? st.seats[st.mySeat] : null;
  const current = me && me.handName && !me.folded ? me.handName : null;
  list.innerHTML = '';
  RANKINGS.forEach((r, i) => {
    const row = document.createElement('div');
    const mine = current === r.name;
    row.className = 'rank-row' + (mine ? ' current' : '');
    row.innerHTML = `<span class="n">${i + 1}</span><div class="cards"></div><div class="title">${r.name}${mine ? ' ← you have this' : ''}<div class="desc">${r.desc}</div></div>`;
    const cards = row.querySelector('.cards');
    r.cards.split(' ').forEach((c, j) => cards.appendChild(cardEl(c, r.use && j >= r.use ? 'dim' : '')));
    list.appendChild(row);
  });
  const v = st ? st.variant : 'holdem';
  $('rankingsNote').innerHTML = v === 'holdem'
    ? "<b>Texas Hold'em:</b> make your best 5 cards from your 2 cards plus the 5 on the board, in any combination."
    : `<b>${v === 'omaha5' ? '5-Card ' : ''}Omaha:</b> you must use <b>exactly 2</b> of your hole cards and <b>exactly 3</b> from the board. Example: four hearts on the board plus one heart in your hand is <i>not</i> a flush.`;
}

$('rankingsBtn').onclick = () => {
  const m = $('rankingsModal');
  m.classList.toggle('hidden');
  renderRankings(S && S.state);
};
$('rankingsClose').onclick = () => $('rankingsModal').classList.add('hidden');
$('rankingsModal').onclick = (e) => { if (e.target.id === 'rankingsModal') e.target.classList.add('hidden'); };
$('oddsToggle').classList.toggle('on', oddsOpen);

// Collapsible host controls (remembered).
function setHostCollapsed(c) {
  $('hostPanel').classList.toggle('collapsed', c);
  $('hostArrow').textContent = c ? '▸' : '▾';
  localStorage.setItem('poker.hostCollapsed', c ? '1' : '0');
}
$('hostToggle').onclick = () => setHostCollapsed(!$('hostPanel').classList.contains('collapsed'));
setHostCollapsed(localStorage.getItem('poker.hostCollapsed') === '1');
