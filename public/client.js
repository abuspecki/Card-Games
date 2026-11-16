// Browser client: connects to the server, renders the table, sends actions.
const $ = (id) => document.getElementById(id);
const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
// Seat positions around the table (percent of table box), starting bottom-center, clockwise.
const POS = [[50, 102], [14, 90], [-4, 50], [14, 8], [50, -4], [86, 8], [104, 50], [86, 90]];

let ws = null;
let S = null; // latest state message
let myTurnBefore = false;
let raiseTouched = false;

// ---------- accounts ----------
let session = localStorage.getItem('poker.session');
let account = null; // username when logged in
let authMode = 'login';

function api(path, body) {
  const opts = { headers: { 'Content-Type': 'application/json' } };
  if (session) opts.headers.Authorization = 'Bearer ' + session;
  if (body) { opts.method = 'POST'; opts.body = JSON.stringify(body); }
  return fetch(path, opts).then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) }));
}

function showAccount() {
  $('accountIn').classList.toggle('hidden', !account);
  $('accountOut').classList.toggle('hidden', !!account);
  if (account) $('accountName').textContent = account;
}

function setAuthMode(mode) {
  authMode = mode;
  $('tabLogin').classList.toggle('on', mode === 'login');
  $('tabRegister').classList.toggle('on', mode === 'register');
  $('authBtn').textContent = mode === 'login' ? 'Log in' : 'Create account';
  $('authPass').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  $('authPass').placeholder = mode === 'login' ? 'Password' : 'Password (at least 6 characters)';
  $('authError').textContent = '';
}
$('tabLogin').onclick = () => setAuthMode('login');
$('tabRegister').onclick = () => setAuthMode('register');

$('authForm').onsubmit = async (e) => {
  e.preventDefault();
  $('authError').textContent = '';
  const r = await api(authMode === 'login' ? '/api/login' : '/api/register', { username: $('authUser').value.trim(), password: $('authPass').value });
  if (!r.ok) { $('authError').textContent = r.data.error || 'Something went wrong'; return; }
  session = r.data.token;
  account = r.data.username;
  localStorage.setItem('poker.session', session);
  $('authPass').value = '';
  showAccount();
};

$('logoutBtn').onclick = async () => {
  await api('/api/logout', {});
  localStorage.removeItem('poker.session');
  session = null;
  account = null;
  showAccount();
};

const accountReady = session
  ? api('/api/me').then((r) => {
    if (r.ok) account = r.data.username;
    else if (r.status === 401) { localStorage.removeItem('poker.session'); session = null; }
    showAccount();
  }).catch(() => showAccount())
  : Promise.resolve(showAccount());

// ---------- lobby ----------
$('name').value = localStorage.getItem('poker.name') || '';
const params = new URLSearchParams(location.search);
if (params.get('room')) $('roomCode').value = params.get('room');

$('createBtn').onclick = () => join('');
$('practiceBtn').onclick = () => join('', Number($('botCount').value), $('practiceGame').value);
$('joinBtn').onclick = () => join($('roomCode').value.trim());
$('roomCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });

function join(code, bots = 0, game = 'holdem') {
  const name = account || $('name').value.trim();
  if (!name) { $('lobbyError').textContent = 'Log in, or enter a guest name first'; return; }
  if (!account) localStorage.setItem('poker.name', name);
  Sound.unlock();
  connect(() => {
    const token = code ? localStorage.getItem('poker.token.' + code.toUpperCase()) : null;
    send({ t: 'join', room: code, name, token, bots, game, session });
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
  connect(() => send({ t: 'join', room: code, name: account || $('name').value, token: localStorage.getItem('poker.token.' + code), session }));
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

const PLAYING = { holdem: ['preflop', 'flop', 'turn', 'river'], blackjack: ['betting', 'playing'], durak: ['playing'] };
const isPlaying = (st) => (PLAYING[st.game || 'holdem'] || []).includes(st.stage);

function render() {
  const st = S.state;
  const g = st.game || 'holdem';
  document.body.dataset.game = g;
  renderChat(st); // first, so new messages get bubbles on this draw
  $('roomLabel').textContent = S.room;
  $('variantLabel').textContent = st.variantName + (st.stage === 'waiting' ? '' : ` · ${g === 'durak' ? 'Game' : 'Hand'} #${st.handNo}`);
  const winCards = new Set();
  const winSeats = new Set();
  if (st.stage === 'showdown' && st.results) {
    for (const w of st.results.winners) { winSeats.add(w.seat); (w.cards || []).forEach((c) => winCards.add(c)); }
  }

  if (g === 'holdem') renderPokerCenter(st, winCards);
  else if (g === 'blackjack') renderBlackjackCenter(st);
  else renderDurakCenter(st);
  $('message').textContent = centerMessage(st);

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
    const durakLoser = g === 'durak' && st.stage === 'showdown' && st.durak === i;
    el.className = 'seat' + (isMe ? ' me' : '') + (i === st.toAct ? ' turn' : '')
      + (s.folded && st.stage !== 'waiting' ? ' folded' : '') + (s.out ? ' out' : '') + (!s.connected ? ' away' : '')
      + (winSeats.has(i) && !durakLoser ? ' winner' : '') + (durakLoser ? ' loser' : '');
    el.style.left = pos[0] + '%'; el.style.top = pos[1] + '%';

    el.appendChild(seatCards(st, s, i, isMe, winCards));

    const plate = document.createElement('div');
    plate.className = 'plate';
    const sub = g === 'durak'
      ? (st.stage === 'waiting' || !s.inHand ? (s.inHand === false && st.stage !== 'waiting' ? 'watching' : '') : `${s.cardCount} card${s.cardCount === 1 ? '' : 's'}`)
      : `${s.chips}${s.allIn ? ' · ALL-IN' : ''}`;
    plate.innerHTML = `<div class="nm"></div><div class="ch">${sub}</div>`;
    plate.querySelector('.nm').textContent = s.name;
    if (s.isBot) plate.querySelector('.nm').insertAdjacentHTML('afterbegin', '<span class="bot" title="Computer player">🤖</span>');
    const role = g === 'durak' && isPlaying(st) ? (i === st.attacker ? '⚔️' : i === st.defender ? '🛡️' : '') : '';
    if (role) plate.insertAdjacentHTML('afterbegin', `<div class="role" title="${role === '⚔️' ? 'Attacker' : 'Defender'}">${role}</div>`);
    if (g === 'holdem' && i === st.button && st.stage !== 'waiting') {
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

    const betAmt = s.bet;
    if (betAmt > 0 && g === 'holdem') {
      const b = document.createElement('div');
      b.className = 'bet';
      b.textContent = betAmt;
      // Place the bet toward the center of the table.
      const dx = 50 - pos[0], dy = 50 - pos[1];
      b.style.left = `calc(50% + ${dx * 1.4}px)`;
      b.style.top = `calc(50% + ${dy * 1.6}px)`;
      b.style.transform = 'translate(-50%, -50%)';
      el.appendChild(b);
    }
    addBubble(el, i);
    seatsEl.appendChild(el);

    if (isMe && g !== 'durak' && s.chips < (g === 'blackjack' ? st.minBet : 1) && !(s.inHand && isPlaying(st))) {
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

// Cards shown at a seat.
function seatCards(st, s, i, isMe, winCards) {
  const g = st.game || 'holdem';
  const box = document.createElement('div');
  box.className = 'hole';
  if (st.stage === 'waiting' || !s.inHand) return box;
  if (g === 'holdem') {
    if (!s.folded || isMe) {
      const cards = s.hole || new Array(s.cardCount).fill(null);
      cards.forEach((c) => box.appendChild(cardEl(c, (isMe ? '' : 'small') + (winCards.has(c) ? ' win' : ''))));
    }
  } else if (g === 'blackjack') {
    box.classList.add('bj-hands');
    (s.hands || []).forEach((h, k) => {
      const hand = document.createElement('div');
      const active = i === st.toAct && k === s.handIdx;
      hand.className = 'bj-hand' + (active && s.hands.length > 1 ? ' active' : '');
      const cards = document.createElement('div');
      cards.className = 'bj-cards';
      h.cards.forEach((c) => cards.appendChild(cardEl(c, 'small')));
      hand.appendChild(cards);
      const label = document.createElement('div');
      label.className = 'bj-total' + (h.result ? ' ' + h.result : h.bust ? ' lose' : '');
      label.textContent = h.blackjack ? 'Blackjack!' : h.bust ? `Bust (${h.total})` : `${h.soft && h.total < 21 ? 'Soft ' : ''}${h.total}`;
      if (h.result && !h.blackjack) label.textContent += ` · ${{ win: 'Win', lose: 'Lose', push: 'Push', blackjack: 'Blackjack' }[h.result]}`;
      hand.appendChild(label);
      box.appendChild(hand);
    });
  } else if (!isMe && !s.out) {
    // Durak: other players' cards face down (your own hand is shown below the table).
    const n = s.cardCount || 0;
    for (let k = 0; k < Math.min(n, 6); k++) box.appendChild(cardEl(null, 'small'));
    if (n > 6) box.insertAdjacentHTML('beforeend', `<span class="more">+${n - 6}</span>`);
  }
  return box;
}

function renderPokerCenter(st, winCards) {
  const board = $('board');
  board.className = 'board';
  const shown = [...board.children].map((c) => c.dataset.card).join();
  if (shown !== st.board.join() || board.dataset.hand !== 'p' + st.handNo) {
    board.innerHTML = '';
    st.board.forEach((c) => board.appendChild(cardEl(c)));
    board.dataset.hand = 'p' + st.handNo;
  }
  [...board.children].forEach((el) => el.classList.toggle('win', winCards.has(el.dataset.card)));
  $('pot').textContent = st.pot ? `Pot: ${st.pot}` : '';
}

function renderBlackjackCenter(st) {
  const board = $('board');
  board.className = 'board bj-dealer';
  board.dataset.hand = '';
  board.innerHTML = '';
  if (st.dealer && st.dealer.cards.length) {
    const cards = document.createElement('div');
    cards.className = 'bj-cards';
    st.dealer.cards.forEach((c) => cards.appendChild(cardEl(c)));
    board.appendChild(cards);
  }
  const d = st.dealer || {};
  $('pot').textContent = d.cards && d.cards.length
    ? `Dealer: ${d.total}${d.total > 21 ? ' — bust!' : ''}${st.results && st.results.dealerBJ ? ' — Blackjack!' : ''}`
    : `Blackjack pays 3:2 · Dealer stands on 17 · Min bet ${st.minBet}`;
}

function renderDurakCenter(st) {
  const board = $('board');
  board.className = 'board durak-board';
  board.dataset.hand = '';
  board.innerHTML = '';
  if (isPlaying(st)) {
    // Deck with the trump card underneath.
    const deck = document.createElement('div');
    deck.className = 'durak-deck';
    if (st.trumpCard) deck.appendChild(cardEl(st.trumpCard, 'trump-card'));
    if (st.deckCount > 1) deck.appendChild(cardEl(null, 'deck-back'));
    deck.insertAdjacentHTML('beforeend', `<div class="deck-count">${st.deckCount ? st.deckCount + ' left' : 'Deck empty'}</div>`);
    board.appendChild(deck);
    const table = document.createElement('div');
    table.className = 'durak-table';
    for (const p of st.table) {
      const pair = document.createElement('div');
      pair.className = 'durak-pair';
      pair.appendChild(cardEl(p.a));
      if (p.d) pair.appendChild(cardEl(p.d, 'defense'));
      table.appendChild(pair);
    }
    board.appendChild(table);
  }
  const suit = st.trump ? `${SUIT[st.trump]} ${{ s: 'Spades', h: 'Hearts', d: 'Diamonds', c: 'Clubs' }[st.trump]}` : '';
  $('pot').innerHTML = '';
  if (isPlaying(st)) {
    const span = document.createElement('span');
    span.className = st.trump === 'h' || st.trump === 'd' ? 'red-suit' : '';
    span.textContent = `Trumps: ${suit}`;
    $('pot').appendChild(span);
  } else if (st.stage === 'waiting') {
    $('pot').textContent = '36 cards · 2–6 players · don\'t be the last one holding cards!';
  }
}

function centerMessage(st) {
  const g = st.game || 'holdem';
  const name = (i) => (st.seats[i] ? st.seats[i].name : 'Player');
  if (st.stage === 'waiting') {
    const need = g === 'blackjack' ? 1 : 2;
    const n = st.seats.filter((s) => s && (g === 'durak' || s.chips > 0)).length;
    if (n < need) return S.isHost ? `Share room code ${S.room} or add a bot to play` : 'Waiting for players…';
    return S.isHost ? (g === 'durak' ? 'Press Start game' : 'Press Deal to start') : 'Waiting for the host to start';
  }
  if (st.stage === 'showdown' && st.results) {
    if (g === 'durak') return st.durak === -1 || st.durak === undefined ? 'Draw — nobody is the durak!' : `${name(st.durak)} is the durak! 🃏`;
    if (g === 'blackjack') {
      const w = st.results.winners;
      return w.length ? w.map((x) => `${name(x.seat)} wins ${x.amount}`).join(' · ') : 'The house wins this round';
    }
    return st.results.winners.map((w) => `${name(w.seat)} wins ${w.amount}${w.hand ? ' with ' + w.hand : ''}`).join(' · ');
  }
  if (st.toAct === -1 || !st.seats[st.toAct]) return '';
  const mine = st.toAct === st.mySeat;
  if (g === 'blackjack') {
    if (st.stage === 'betting') return mine ? 'Place your bet' : `${name(st.toAct)} is betting…`;
    return mine ? 'Your turn — hit or stand?' : `${name(st.toAct)} is playing…`;
  }
  if (g === 'durak') {
    const who = mine ? 'You' : name(st.toAct);
    if (st.phase === 'attack') return mine ? 'Your attack — play any card' : `${who} is attacking…`;
    if (st.phase === 'defend') return mine ? 'Defend — beat the card or take' : `${who} is defending…`;
    if (st.phase === 'takeThrow') return mine ? `${name(st.defender)} is taking — add more cards?` : `${who} may add cards…`;
    return mine ? 'Throw in a card with the same rank, or pass' : `${who} may throw in…`;
  }
  return mine ? 'Your turn' : `${name(st.toAct)} is thinking…`;
}

function updateHelpButton(st) {
  const g = st.game || 'holdem';
  $('rankingsBtn').textContent = g === 'holdem' ? '🏆 Hand rankings' : '📖 How to play';
}

function renderHost(st) {
  updateHelpButton(st);
  $('hostPanel').classList.toggle('hidden', !S.isHost);
  if (!S.isHost) return;
  const g = st.game || 'holdem';
  const sel = $('variantSelect');
  if (sel.options.length === 0 && S.games) {
    for (const [k, v] of Object.entries(S.games)) sel.add(new Option(v, k));
  }
  const active = document.activeElement;
  if (active !== sel) sel.value = g;
  sel.disabled = isPlaying(st);
  sel.title = isPlaying(st) ? 'You can switch games between hands' : '';
  $('showOdds').checked = st.settings.showOdds;
  $('showOdds').closest('label').classList.toggle('hidden', g === 'durak');
  $('bigBlindLabel').textContent = g === 'blackjack' ? 'Minimum bet' : 'Big blind';
  $('bigBlind').closest('label').classList.toggle('hidden', g === 'durak');
  $('stack').closest('label').classList.toggle('hidden', g === 'durak');
  if (active !== $('bigBlind')) $('bigBlind').value = st.settings.bigBlind;
  if (active !== $('stack')) $('stack').value = st.settings.startingStack;
  $('addBotBtn').disabled = st.seats.every(Boolean);
  $('removeBotBtn').disabled = !st.seats.some((s) => s && s.isBot);
  const ready = g === 'blackjack' ? st.seats.some((s) => s && s.chips >= st.minBet)
    : g === 'durak' ? st.seats.filter(Boolean).length >= 2
      : st.seats.filter((s) => s && s.chips > 0).length >= 2;
  $('startBtn').disabled = isPlaying(st) || !ready;
  $('startBtn').textContent = g === 'durak' ? (st.stage === 'showdown' ? 'New game now' : 'Start game') : (st.stage === 'showdown' ? 'Deal now' : 'Deal');
}

$('variantSelect').onchange = (e) => send({ t: 'settings', game: e.target.value });
$('showOdds').onchange = (e) => send({ t: 'settings', showOdds: e.target.checked });
$('bigBlind').onchange = (e) => send({ t: 'settings', bigBlind: e.target.value });
$('stack').onchange = (e) => send({ t: 'settings', startingStack: e.target.value });
$('startBtn').onclick = () => send({ t: 'start' });
$('addBotBtn').onclick = () => send({ t: 'addBot' });
$('removeBotBtn').onclick = () => send({ t: 'removeBot' });

function renderActions(st) {
  const g = st.game || 'holdem';
  const lim = st.limits;
  const myTurn = !!lim;
  if (myTurn && !myTurnBefore) { Sound.play('turn'); raiseTouched = false; }
  myTurnBefore = myTurn;
  $('pokerActions').classList.toggle('hidden', g !== 'holdem');
  $('bjActions').classList.toggle('hidden', g !== 'blackjack');
  $('durakActions').classList.toggle('hidden', g !== 'durak');
  if (g === 'durak') return renderDurakActions(st);
  $('actions').classList.toggle('hidden', !myTurn);
  if (!myTurn) return;
  if (g === 'blackjack') return renderBlackjackActions(st);
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

// ---------- blackjack controls ----------
let lastBjBet = null;
function renderBlackjackActions(st) {
  const lim = st.limits;
  $('bjBet').classList.toggle('hidden', lim.phase !== 'bet');
  $('bjPlay').classList.toggle('hidden', lim.phase !== 'play');
  if (lim.phase === 'bet') {
    const input = $('bjBetInput');
    input.min = lim.minBet; input.max = lim.maxBet;
    if (document.activeElement !== input) input.value = Math.min(lim.maxBet, Math.max(lim.minBet, lastBjBet || lim.minBet));
  } else {
    $('bjDouble').classList.toggle('hidden', !lim.canDouble);
    $('bjSplit').classList.toggle('hidden', !lim.canSplit);
  }
}
document.querySelectorAll('[data-bjbet]').forEach((b) => {
  b.onclick = () => {
    const lim = S.state.limits;
    const v = { min: lim.minBet, x2: lim.minBet * 2, x5: lim.minBet * 5 }[b.dataset.bjbet];
    $('bjBetInput').value = Math.min(lim.maxBet, v);
  };
});
$('bjBetBtn').onclick = () => { lastBjBet = Number($('bjBetInput').value); send({ t: 'action', action: 'bet', amount: lastBjBet }); };
$('bjHit').onclick = () => send({ t: 'action', action: 'hit' });
$('bjStand').onclick = () => send({ t: 'action', action: 'stand' });
$('bjDouble').onclick = () => send({ t: 'action', action: 'double' });
$('bjSplit').onclick = () => send({ t: 'action', action: 'split' });

// ---------- durak controls: your hand is always shown while you play ----------
function renderDurakActions(st) {
  const me = st.mySeat !== -1 ? st.seats[st.mySeat] : null;
  const inGame = me && me.inHand && me.hole && isPlaying(st);
  $('actions').classList.toggle('hidden', !inGame);
  if (!inGame) return;
  const mv = st.moves; // only set when it's your turn
  const playable = new Set(mv ? mv.cards : []);
  const hand = $('durakHand');
  hand.innerHTML = '';
  if (!me.hole.length) hand.innerHTML = '<span class="muted-label">No cards — you\'re out! 🎉</span>';
  for (const c of me.hole) {
    const el = cardEl(c, (playable.has(c) ? 'playable' : mv ? 'dim' : '') + (c[1] === st.trump ? ' is-trump' : ''));
    if (playable.has(c)) el.onclick = () => send({ t: 'action', action: 'play', amount: c });
    hand.appendChild(el);
  }
  $('durakTake').classList.toggle('hidden', !(mv && mv.canTake));
  $('durakPass').classList.toggle('hidden', !(mv && mv.canPass));
  $('durakPass').textContent = mv && mv.phase === 'takeThrow' ? 'Done adding' : 'Pass';
  let prompt = '';
  if (!mv) prompt = st.defender === st.mySeat ? 'You are defending 🛡️ — wait for the attack' : 'Your hand';
  else if (mv.phase === 'attack') prompt = '⚔️ Your attack: click any card to play it';
  else if (mv.phase === 'defend') prompt = mv.cards.length ? `🛡️ Beat the ${prettyCard(mv.target)}: click a glowing card, or take the cards` : `🛡️ You can't beat the ${prettyCard(mv.target)} — take the cards`;
  else if (mv.phase === 'takeThrow') prompt = 'They are taking! Add more cards with the same rank, or click Done';
  else prompt = 'Throw in a card with a rank already on the table, or Pass';
  $('durakPrompt').textContent = prompt;
}
$('durakTake').onclick = () => send({ t: 'action', action: 'take' });
$('durakPass').onclick = () => send({ t: 'action', action: 'pass' });

function prettyCard(c) { return c ? `${c[0] === 'T' ? '10' : c[0]}${SUIT[c[1]]}` : ''; }

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
  if (k === 'escape') { $('rankingsModal').classList.add('hidden'); $('leaderboardModal').classList.add('hidden'); }
  if (k === 'l') $('leaderboardBtn').click();
  if (k === 'h') $('rankingsBtn').click();
  if (k === 'o') $('oddsToggle').click();
  if (!S.state.limits || (S.state.game || 'holdem') !== 'holdem') return;
  if (k === 'f' && !$('foldBtn').classList.contains('hidden')) $('foldBtn').click();
  if (k === 'c') $('callBtn').click();
  if (k === 'r' && !$('raiseBtn').classList.contains('hidden')) $('raiseBtn').click();
});

function renderLog(st) {
  const log = $('log');
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 10;
  log.innerHTML = '';
  for (const entry of st.log) {
    if (typeof entry !== 'string') continue; // old-style chat entries
    const d = document.createElement('div');
    d.className = 'sys';
    d.textContent = entry;
    log.appendChild(d);
  }
  if (atBottom) log.scrollTop = log.scrollHeight;
}

// ---------- chat ----------
let chatTab = 'chat';
let lastChatId = null; // newest message already seen
const bubbles = {};    // seat -> { text, until }
const BUBBLE_MS = 5000;

function setSideTab(tab) {
  chatTab = tab;
  $('tabChat').classList.toggle('on', tab === 'chat');
  $('tabLog').classList.toggle('on', tab === 'log');
  $('chatList').classList.toggle('hidden', tab !== 'chat');
  $('log').classList.toggle('hidden', tab !== 'log');
  if (tab === 'chat') { $('chatDot').classList.add('hidden'); $('chatList').scrollTop = $('chatList').scrollHeight; }
  else $('log').scrollTop = $('log').scrollHeight;
}
$('tabChat').onclick = () => setSideTab('chat');
$('tabLog').onclick = () => setSideTab('log');

function renderChat(st) {
  const msgs = st.chat || [];
  // New messages: show a bubble at the sender's seat, and mark unread.
  const newest = msgs.length ? msgs[msgs.length - 1].id : 0;
  if (lastChatId !== null) {
    for (const m of msgs) {
      if (m.id <= lastChatId || m.seat < 0) continue;
      bubbles[m.seat] = { text: m.text, until: Date.now() + BUBBLE_MS };
      setTimeout(() => S && render(), BUBBLE_MS + 50);
      if (chatTab !== 'chat' && m.seat !== st.mySeat) $('chatDot').classList.remove('hidden');
    }
  }
  lastChatId = newest;

  const list = $('chatList');
  const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 10;
  list.innerHTML = '';
  if (!msgs.length) {
    list.innerHTML = '<div class="empty">No messages yet. Say hi! 👋</div>';
    return;
  }
  for (const m of msgs) {
    const d = document.createElement('div');
    d.className = 'msg' + (m.seat === st.mySeat ? ' mine' : '');
    const b = document.createElement('b');
    b.textContent = m.from + ':';
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    d.append(b, document.createTextNode(m.text), time);
    list.appendChild(d);
  }
  if (atBottom) list.scrollTop = list.scrollHeight;
}

// Adds a speech bubble to a seat element if that player spoke recently.
function addBubble(el, seat) {
  const bub = bubbles[seat];
  if (!bub) return;
  const left = bub.until - Date.now();
  if (left <= 0) { delete bubbles[seat]; return; }
  const d = document.createElement('div');
  d.className = 'bubble' + (left < 600 ? ' fade' : '');
  d.textContent = bub.text.length > 80 ? bub.text.slice(0, 77) + '…' : bub.text;
  el.appendChild(d);
  if (left > 600) setTimeout(() => { d.classList.add('fade'); }, left - 600);
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
accountReady.then(() => {
  if (params.get('room') && localStorage.getItem('poker.token.' + params.get('room').toUpperCase()) && (account || $('name').value)) {
    join(params.get('room'));
  }
});

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
$('oddsClose').onclick = () => setOddsOpen(!oddsOpen);

// Blackjack helper: bust chance and the basic-strategy move (infinite-deck estimate).
const BJ_VAL = (c) => (c[0] === 'A' ? 11 : 'TJQK'.includes(c[0]) ? 10 : Number(c[0]));
function bjTotal(cards) {
  let t = 0, aces = 0;
  for (const c of cards) { t += BJ_VAL(c); if (c[0] === 'A') aces++; }
  while (t > 21 && aces) { t -= 10; aces--; }
  return { total: t, soft: aces > 0 };
}
function bjBestMove(cards, up, lim) {
  const { total, soft } = bjTotal(cards);
  const u = BJ_VAL(up), v0 = BJ_VAL(cards[0]);
  if (lim.canSplit) {
    if (v0 === 11 || v0 === 8) return 'Split';
    if ([2, 3, 6, 7].includes(v0) && u <= 7) return 'Split';
    if (v0 === 9 && u <= 9 && u !== 7) return 'Split';
  }
  if (lim.canDouble) {
    if (!soft && (total === 11 || (total === 10 && u <= 9) || (total === 9 && u >= 3 && u <= 6))) return 'Double';
    if (soft && total >= 15 && total <= 18 && u >= 4 && u <= 6) return 'Double';
  }
  if (soft) return total >= 19 || (total === 18 && u < 9) ? 'Stand' : 'Hit';
  if (total >= 17) return 'Stand';
  if (total >= 13) return u <= 6 ? 'Stand' : 'Hit';
  if (total === 12) return u >= 4 && u <= 6 ? 'Stand' : 'Hit';
  return 'Hit';
}
function renderBlackjackOdds(st, body) {
  const me = st.seats[st.mySeat];
  const lim = st.limits;
  if (!lim || lim.phase !== 'play' || !me.hands || !me.hands[lim.handIdx]) {
    body.innerHTML = `<div class="muted">${st.stage === 'betting' ? 'Tips appear once the cards are dealt.' : 'Tips appear on your turn.'}</div>`;
    return;
  }
  const cards = me.hands[lim.handIdx].cards;
  const { total, soft } = bjTotal(cards);
  // Chance the next card busts you: count card values that push a hard total over 21.
  let bust = 0;
  if (!soft) for (const v of [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10, 1]) if (total + v > 21) bust++;
  const bustPct = Math.round((bust / 13) * 100);
  const up = st.dealer.cards[0];
  const move = bjBestMove(cards, up, lim);
  const color = bustPct >= 60 ? '#e0606f' : bustPct >= 30 ? '#f4c95d' : '#4fd17d';
  body.innerHTML = `<div class="muted">You have <b style="color:#9fe3b5">${soft ? 'soft ' : ''}${total}</b>, the dealer shows <b>${prettyCard(up)}</b></div>
    <div class="big" style="color:${color}">${bustPct}%</div>
    <div class="meter"><div style="width:${bustPct}%;background:${color}"></div></div>
    <div class="muted">chance to bust if you hit</div>
    <div class="verdict good">💡 Best move: <b>${move}</b></div>
    <div class="muted" style="font-size:11px">Based on "basic strategy", the mathematically best way to play each hand.</div>`;
}

function renderOdds(st) {
  const g = st.game || 'holdem';
  const allowed = st.settings.showOdds && g !== 'durak';
  $('oddsToggle').classList.toggle('hidden', !allowed);
  const panel = $('oddsPanel');
  const me = st.mySeat !== -1 ? st.seats[st.mySeat] : null;
  const inHand = me && me.inHand && !me.folded && me.hole && ['preflop', 'flop', 'turn', 'river', 'showdown'].includes(st.stage);
  panel.classList.toggle('hidden', !allowed || st.stage === 'waiting');
  panel.classList.toggle('collapsed', !oddsOpen);
  $('oddsClose').textContent = oddsOpen ? 'Hide' : 'Show';
  if (panel.classList.contains('hidden') || !oddsOpen) return;
  const body = $('oddsBody');
  if (g === 'blackjack') {
    if (st.mySeat === -1 || !st.seats[st.mySeat].inHand) { body.innerHTML = '<div class="muted">You are not in this hand.</div>'; return; }
    return renderBlackjackOdds(st, body);
  }
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

const RULES = {
  blackjack: {
    title: '📖 How to play Blackjack',
    html: `<ol class="rules">
      <li><b>Goal:</b> get closer to <b>21</b> than the dealer without going over. You only play against the dealer, not the other players.</li>
      <li><b>Card values:</b> 2–10 count their number, J/Q/K count 10, an Ace counts 11 or 1 (whichever is better).</li>
      <li><b>Bet</b>, then you and the dealer get 2 cards. One dealer card stays face down.</li>
      <li><b>Hit</b> = take another card. <b>Stand</b> = stop. Over 21 = <b>bust</b>, you lose.</li>
      <li><b>Double</b> = double your bet, take exactly one more card. <b>Split</b> = two cards of the same value become two hands.</li>
      <li>The dealer must hit until reaching <b>17</b> or more.</li>
      <li><b>Win</b> pays 1:1. <b>Blackjack</b> (Ace + 10-value card as your first two cards) pays <b>3:2</b>. A tie (<b>push</b>) returns your bet.</li>
    </ol>`,
  },
  durak: {
    title: '📖 How to play Durak',
    html: `<ol class="rules">
      <li><b>Goal:</b> get rid of all your cards. The last player still holding cards is the <b>durak</b> (the fool) and loses.</li>
      <li>36 cards (6 up to Ace). Everyone gets 6. The card under the deck sets the <b>trump suit</b>.</li>
      <li>⚔️ The <b>attacker</b> plays a card at the 🛡️ <b>defender</b> (the next player).</li>
      <li>The defender beats it with a <b>higher card of the same suit</b>, or with <b>any trump</b> (if the attack card is not a trump).</li>
      <li>After each defense, the attacker and then the others may <b>throw in</b> more cards with a <b>rank already on the table</b>. Max 6 cards per round.</li>
      <li>If every card is beaten and nobody adds more, the cards are discarded (<b>bito</b>) and the defender attacks next.</li>
      <li>If the defender can't or won't beat a card, they <b>take</b> all the cards on the table. Others may still add cards first. The defender then skips attacking.</li>
      <li>After each round everyone draws back up to 6 (attacker first, defender last). Once the deck is empty, players who run out of cards are safe.</li>
      <li><b>Tip:</b> on your turn, the cards you can play glow. Click one to play it.</li>
    </ol>`,
  },
};

function renderRankings(st) {
  if ($('rankingsModal').classList.contains('hidden')) return;
  const g = (st && st.game) || 'holdem';
  const box = $('rankingsModal');
  box.querySelector('h2').textContent = RULES[g] ? RULES[g].title : '🏆 Winning hands';
  box.querySelector('.sub').classList.toggle('hidden', !!RULES[g]);
  $('rankingsNote').classList.toggle('hidden', !!RULES[g]);
  if (RULES[g]) { $('rankingsList').innerHTML = RULES[g].html; return; }
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

// ---------- leaderboard ----------
let lbMode = 'friends';
async function loadLeaderboard() {
  const NOTES = {
    friends: 'Poker hands with at least 2 people. Ranked by total chips won (losses count, rebuys don\'t hide them).',
    bots: 'Poker hands where you were the only person at the table, playing against bots.',
    blackjack: 'Blackjack hands against the dealer. Ranked by total chips won.',
    durak: 'Durak games: +1 point for escaping, −1 for being the durak.',
  };
  $('lbNote').textContent = NOTES[lbMode];
  const heads = lbMode === 'durak'
    ? ['#', 'Player', 'Points', 'Games', 'Escaped', 'Times durak']
    : ['#', 'Player', 'Chips won', 'Hands', 'Won', lbMode === 'blackjack' ? 'Biggest win' : 'Biggest pot'];
  document.querySelector('#leaderboardModal thead tr').innerHTML = heads.map((h) => `<th>${h}</th>`).join('');
  $('lbBody').innerHTML = '<tr><td colspan="6" class="empty">Loading…</td></tr>';
  const r = await api('/api/leaderboard?mode=' + lbMode).catch(() => ({ ok: false }));
  if (!r.ok) { $('lbBody').innerHTML = '<tr><td colspan="6" class="empty">Could not load the leaderboard.</td></tr>'; return; }
  if (!r.data.persistent) {
    const warn = document.createElement('b');
    warn.style.color = '#f4c95d';
    warn.textContent = r.data.databaseError
      ? `⚠ Test mode: the database connection failed (${r.data.databaseError}). Accounts and scores are deleted whenever the server restarts.`
      : '⚠ Test mode: no database is connected, so accounts and scores are deleted whenever the server restarts.';
    $('lbNote').append(document.createElement('br'), warn);
  }
  if (!r.data.rows.length) {
    $('lbBody').innerHTML = '<tr><td colspan="6" class="empty">No results yet. Create an account and play a hand!</td></tr>';
    return;
  }
  $('lbBody').innerHTML = '';
  r.data.rows.forEach((row, i) => {
    const tr = document.createElement('tr');
    if (account && row.username.toLowerCase() === account.toLowerCase()) tr.className = 'me';
    const medal = ['🥇', '🥈', '🥉'][i] || i + 1;
    const net = Number(row.net);
    const last = lbMode === 'durak' ? row.hands - row.wins : Number(row.biggest_pot || 0).toLocaleString();
    tr.innerHTML = `<td>${medal}</td><td></td><td class="${net >= 0 ? 'pos' : 'neg'}">${net > 0 ? '+' : ''}${net.toLocaleString()}</td>
      <td>${row.hands}</td><td>${Math.round((row.wins / row.hands) * 100)}%</td><td>${last}</td>`;
    tr.children[1].textContent = row.username;
    $('lbBody').appendChild(tr);
  });
}
function openLeaderboard() { $('leaderboardModal').classList.remove('hidden'); loadLeaderboard(); }
$('leaderboardBtn').onclick = () => {
  if ($('leaderboardModal').classList.contains('hidden')) openLeaderboard();
  else $('leaderboardModal').classList.add('hidden');
};
$('lobbyLeaderboard').onclick = openLeaderboard;
$('leaderboardClose').onclick = () => $('leaderboardModal').classList.add('hidden');
$('leaderboardModal').onclick = (e) => { if (e.target.id === 'leaderboardModal') e.target.classList.add('hidden'); };
document.querySelectorAll('#leaderboardModal [data-mode]').forEach((b) => {
  b.onclick = () => {
    lbMode = b.dataset.mode;
    document.querySelectorAll('#leaderboardModal [data-mode]').forEach((x) => x.classList.toggle('on', x === b));
    loadLeaderboard();
  };
});
