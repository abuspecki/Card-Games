// Poker server: serves the browser client and runs game rooms over WebSockets.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Table } = require('./poker');
const bots = require('./bots');
const { Blackjack } = require('./games/blackjack');
const { Durak } = require('./games/durak');

// Games the host can pick. Poker uses the Hold'em table.
const GAMES = {
  holdem: { name: "Texas Hold'em", make: (settings) => new Table({ ...settings, variant: 'holdem', rotate: false }) },
  blackjack: { name: 'Blackjack', make: (settings) => new Blackjack(settings) },
  durak: { name: 'Durak', make: (settings) => new Durak(settings) },
};
const GAME_NAMES = Object.fromEntries(Object.entries(GAMES).map(([k, g]) => [k, g.name]));
const { openStore, hashPassword, checkPassword, MODES } = require('./store');

let store = null;       // set at startup by openStore()
let databaseError = null; // why Postgres couldn't be used, if it couldn't

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const NEXT_HAND_DELAY = 6000;
const DISCONNECTED_TURN_TIMEOUT = 8000;
const BOT_THINK_MS = [700, 1800];
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml',
};

// ---------- accounts API ----------
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 10000) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('bad json')); } });
  });
}

// Slow down password guessing: max 10 failed attempts per IP per 10 minutes.
const failures = new Map();
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim();
function tooManyFailures(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() > f.reset) return false;
  return f.count >= 10;
}
function noteFailure(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() > f.reset) failures.set(ip, { count: 1, reset: Date.now() + 10 * 60 * 1000 });
  else f.count++;
}

const bearer = (req) => String(req.headers.authorization || '').replace(/^Bearer /, '');

async function newSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  await store.createSession(token, user.id);
  return { token, username: user.username };
}

async function handleApi(req, res, url) {
  const ip = clientIp(req);
  if (req.method === 'POST' && (url === '/api/register' || url === '/api/login')) {
    if (tooManyFailures(ip)) return json(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (url === '/api/register') {
      if (!/^[A-Za-z0-9_-]{3,16}$/.test(username)) return json(res, 400, { error: 'Username: 3–16 letters, numbers, _ or -' });
      if (password.length < 6 || password.length > 100) return json(res, 400, { error: 'Password must be at least 6 characters' });
      const user = await store.createUser(username, hashPassword(password));
      if (!user) { noteFailure(ip); return json(res, 409, { error: 'That username is taken' }); }
      return json(res, 200, await newSession(user));
    }
    const user = await store.getUserByName(username);
    if (!user || !checkPassword(password, user.pass)) { noteFailure(ip); return json(res, 401, { error: 'Wrong username or password' }); }
    return json(res, 200, await newSession(user));
  }
  if (req.method === 'POST' && url === '/api/logout') {
    const token = bearer(req);
    if (token) await store.deleteSession(token);
    return json(res, 200, { ok: true });
  }
  if (req.method === 'GET' && url === '/api/me') {
    const user = bearer(req) && await store.getUserBySession(bearer(req));
    if (!user) return json(res, 401, { error: 'Not logged in' });
    return json(res, 200, { username: user.username, stats: await store.userStats(user.id) });
  }
  if (req.method === 'GET' && url === '/api/leaderboard') {
    const mode = new URL(req.url, 'http://x').searchParams.get('mode');
    const m = MODES.includes(mode) ? mode : 'friends';
    return json(res, 200, { mode: m, persistent: store.kind === 'postgres', databaseError, rows: await store.leaderboard(m) });
  }
  if (req.method === 'GET' && url === '/api/tables') {
    return json(res, 200, { tables: [...rooms.values()].map(tableSummary) });
  }
  if (req.method === 'GET' && url === '/api/status') {
    return json(res, 200, {
      database: store.kind === 'postgres' ? 'connected' : (process.env.DATABASE_URL ? 'failed' : 'not configured'),
      databaseError,
    });
  }
  return json(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url.startsWith('/api/')) {
    return handleApi(req, res, url).catch((e) => { console.error('api error', e); json(res, 500, { error: 'Server error' }); });
  }
  // Share the poker engine with the browser (used by the odds window).
  if (url === '/engine.js') {
    return fs.readFile(path.join(__dirname, 'poker.js'), (err, data) => {
      res.writeHead(err ? 500 : 200, { 'Content-Type': 'text/javascript' });
      res.end(data);
    });
  }
  // List custom sound files so the client only loads ones that exist.
  if (url === '/sounds/list.json') {
    let list = [];
    try { list = fs.readdirSync(path.join(PUBLIC, 'sounds')).filter((f) => /\.(mp3|wav|ogg)$/.test(f)); } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(list));
  }
  const file = path.normalize(path.join(PUBLIC, url === '/' ? 'index.html' : url));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// The lobby: two permanent tables per game. Anyone can join; there is no host.
const TABLES = [
  { id: 'HOLDEM-1', name: "Hold'em · Table 1", game: 'holdem', capacity: 8 },
  { id: 'HOLDEM-2', name: "Hold'em · Table 2", game: 'holdem', capacity: 8 },
  { id: 'BLACKJACK-1', name: 'Blackjack · Table 1', game: 'blackjack', capacity: 7 },
  { id: 'BLACKJACK-2', name: 'Blackjack · Table 2', game: 'blackjack', capacity: 7 },
  { id: 'DURAK-1', name: 'Durak · Table 1', game: 'durak', capacity: 6 },
  { id: 'DURAK-2', name: 'Durak · Table 2', game: 'durak', capacity: 6 },
];
const AUTO_START_DELAY = 3000;          // deal this long after enough players sit down
const AWAY_LIMIT = 3 * 60 * 1000;       // disconnected players lose their seat after this

const rooms = new Map(); // id -> { code, name, game, capacity, table, clients, timers }

for (const def of TABLES) {
  const room = { ...def, code: def.id, table: GAMES[def.game].make({}), clients: new Map(), nextTimer: null, turnTimer: null, startTimer: null };
  wireTable(room);
  rooms.set(def.id, room);
}

function wireTable(room) {
  room.table.onEvent = (kind) => {
    broadcast(room, { t: 'sfx', name: kind });
    if (kind === 'win') recordResults(room.table);
  };
}

const seatedCount = (t) => t.seats.filter(Boolean).length;

// What the lobby shows for each table.
function tableSummary(room) {
  const seats = room.table.seats.filter(Boolean);
  return {
    id: room.id, name: room.name, game: room.game, capacity: room.capacity,
    humans: seats.filter((s) => !s.isBot).length,
    bots: seats.filter((s) => s.isBot).length,
    players: seats.map((s) => ({ name: s.name, bot: s.isBot })),
    playing: room.table.isPlaying(),
  };
}

function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }

function broadcast(room, msg) { for (const ws of room.clients.values()) send(ws, msg); }

function pushState(room) {
  try {
    const t = room.table;
    for (const [pid, ws] of room.clients) {
      send(ws, { t: 'state', room: room.code, tableName: room.name, state: t.view(pid) });
    }
    scheduleTimers(room);
  } catch (e) {
    console.error('pushState error', e);
  }
}

function scheduleTimers(room) {
  const t = room.table;
  // Deal automatically once enough players are seated (no host needed).
  if (t.stage === 'waiting' && !room.startTimer && hasHuman(room) && t.canStart()) {
    room.startTimer = setTimeout(() => {
      room.startTimer = null;
      if (t.stage === 'waiting' && hasHuman(room)) { rebuyBots(t); if (t.canStart()) t.startHand(); }
      pushState(room);
    }, AUTO_START_DELAY);
  }
  // Auto-deal next hand after a showdown.
  if (t.stage === 'showdown' && !room.nextTimer) {
    room.nextTimer = setTimeout(() => {
      room.nextTimer = null;
      if (t.stage !== 'showdown') return;
      removeAwayPlayers(room);
      if (hasHuman(room)) { rebuyBots(t); if (t.canStart()) t.startHand(); else t.stage = 'waiting'; }
      else t.stage = 'waiting';
      pushState(room);
    }, t.game === 'durak' ? NEXT_HAND_DELAY + 2000 : NEXT_HAND_DELAY);
  }
  // Bots act after a short "thinking" pause; disconnected humans auto-fold.
  clearTimeout(room.turnTimer);
  room.turnTimer = null;
  if (t.isPlaying() && t.toAct !== -1) {
    const p = t.seats[t.toAct];
    if (p && p.isBot) {
      const seat = t.toAct;
      const hand = t.handNo;
      const wait = BOT_THINK_MS[0] + Math.random() * (BOT_THINK_MS[1] - BOT_THINK_MS[0]);
      room.turnTimer = setTimeout(() => {
        room.turnTimer = null;
        if (room.table !== t || t.toAct !== seat || t.handNo !== hand || !t.isPlaying()) return;
        let d;
        try { d = t.botAction ? t.botAction(seat) : bots.decide(t, seat); } catch (e) { console.error('bot error', e); d = t.defaultAction(seat); }
        const r = t.act(p.id, d.action, d.amount);
        if (r.error) { const f = t.defaultAction(seat); t.act(p.id, f.action, f.amount); }
        pushState(room);
      }, wait);
    } else if (p && !p.connected) {
      room.turnTimer = setTimeout(() => {
        if (room.table !== t || !t.isPlaying() || t.toAct === -1) return;
        const d = t.defaultAction(t.toAct);
        t.act(t.seats[t.toAct].id, d.action, d.amount);
        pushState(room);
      }, DISCONNECTED_TURN_TIMEOUT);
    }
  }
}

// Save each account's result for the hand (or Durak game) that just ended.
function recordResults(t) {
  for (const r of t.resultsForRecord()) {
    store.recordHand(r.accountId, r.mode, r.net, r.won, r.pot).catch((e) => console.error('record error', e));
  }
}

// Free seats of people who have been disconnected for a while (between hands only),
// and clear out the bots once no real player is left at the table.
function removeAwayPlayers(room) {
  const t = room.table;
  if (t.isPlaying()) return false;
  let changed = false;
  for (const s of t.seats.slice()) {
    if (s && !s.isBot && !s.connected && Date.now() - (s.awayAt || 0) > AWAY_LIMIT) {
      t.addLog(`${s.name} left (disconnected)`);
      t.leave(s.id);
      changed = true;
    }
  }
  if (!t.seats.some((s) => s && !s.isBot)) {
    for (const s of t.seats.slice()) if (s && s.isBot) { t.leave(s.id); changed = true; }
    if (changed) t.stage = 'waiting';
  }
  return changed;
}

setInterval(() => {
  for (const room of rooms.values()) {
    try { if (removeAwayPlayers(room)) pushState(room); } catch (e) { console.error('sweep error', e); }
  }
}, 20000);

function hasHuman(room) {
  return room.table.seats.some((s) => s && !s.isBot && s.connected);
}

function rebuyBots(t) {
  for (const s of t.seats) {
    if (s && s.isBot && s.chips === 0) { s.chips = t.settings.startingStack; t.addLog(`${s.name} rebuys for ${s.chips}`); }
  }
}

function addBot(room) {
  const t = room.table;
  const name = bots.pickBotName(t);
  const idx = t.sit({ id: 'bot-' + crypto.randomUUID(), name, isBot: true, botStyle: bots.randomStyle() });
  if (idx === -1) return false;
  t.addLog(`🤖 ${name} sat down`);
  return true;
}

function removeBot(room) {
  const t = room.table;
  // Prefer a bot that isn't in the current hand.
  const botSeats = t.seats.map((s, i) => (s && s.isBot ? i : -1)).filter((i) => i !== -1);
  if (!botSeats.length) return false;
  const idle = botSeats.find((i) => !(t.isPlaying() && t.seats[i].inHand && !t.seats[i].folded));
  const i = idle !== undefined ? idle : botSeats[botSeats.length - 1];
  t.addLog(`🤖 ${t.seats[i].name} left`);
  t.leave(t.seats[i].id);
  return true;
}

function addChat(room, seat, from, text) {
  room.table.addChat(seat, from, text);
}

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let room = null;
  let pid = null;

  ws.on('message', async (raw) => {
    try {
      await handleMessage(raw);
    } catch (e) {
      // Never let one bad message or bug take the whole server down.
      console.error('message error', e);
      send(ws, { t: 'error', msg: 'Something went wrong — please try again' });
    }
  });

  async function handleMessage(raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'join') {
      let user = null;
      if (m.session) {
        try { user = await store.getUserBySession(String(m.session)); } catch (e) { console.error('session lookup', e); }
      }
      const name = user ? user.username : String(m.name || 'Player').trim().slice(0, 16) || 'Player';
      const code = String(m.room || '').toUpperCase().trim();
      room = rooms.get(code);
      if (!room) return send(ws, { t: 'error', msg: 'That table doesn\'t exist — pick one from the lobby' });
      const table = room.table;
      // Rejoin a seat: by saved seat token, or because this account already sits here.
      const accountSeat = user ? table.seats.findIndex((s) => s && s.accountId === user.id) : -1;
      if (accountSeat !== -1 || (m.token && table.seatOf(m.token) !== -1)) {
        pid = accountSeat !== -1 ? table.seats[accountSeat].id : m.token;
        const old = room.clients.get(pid);
        if (old && old !== ws) old.close();
        table.seats[table.seatOf(pid)].connected = true;
        table.seats[table.seatOf(pid)].awayAt = null;
      } else {
        pid = crypto.randomUUID();
        if (seatedCount(table) >= room.capacity) removeBot(room); // make room for a human
        if (seatedCount(table) >= room.capacity || table.sit({ id: pid, name, accountId: user ? user.id : null }) === -1) {
          room = null;
          return send(ws, { t: 'error', msg: 'This table is full — try the other one' });
        }
        table.addLog(`${name} joined`);
      }
      room.clients.set(pid, ws);
      send(ws, { t: 'joined', room: room.code, token: pid });
      pushState(room);
      return;
    }

    if (!room || !pid) return;
    const t = room.table;
    const me = t.seats[t.seatOf(pid)];

    switch (m.t) {
      case 'action': {
        const r = t.act(pid, m.action, m.amount);
        if (r.error) send(ws, { t: 'error', msg: r.error });
        break;
      }
      case 'addBot':
        if (!me) return;
        if (seatedCount(t) >= room.capacity || !addBot(room)) return send(ws, { t: 'error', msg: 'The table is full' });
        break;
      case 'removeBot':
        if (!me) return;
        if (!removeBot(room)) return send(ws, { t: 'error', msg: 'No bots at the table' });
        break;
      case 'rebuy':
        if (me && me.chips === 0 && !(me.inHand && t.isPlaying())) {
          me.chips = t.settings.startingStack;
          t.addLog(`${me.name} rebuys for ${me.chips}`);
          broadcast(room, { t: 'sfx', name: 'chips' });
        }
        break;
      case 'chat':
        if (me && String(m.text || '').trim()) {
          addChat(room, t.seatOf(pid), me.name, String(m.text).trim());
          broadcast(room, { t: 'sfx', name: 'chat' });
        }
        break;
      case 'leave': {
        // Leaving mid-hand still counts. (Durak records it when the game ends.)
        const rec = t.leaveRecord ? t.leaveRecord(t.seatOf(pid)) : null;
        if (rec) {
          store.recordHand(rec.accountId, rec.mode, rec.net, rec.won, rec.pot).catch((e) => console.error('record error', e));
          me.accountId = null; // already recorded; don't count this hand twice
        }
        t.leave(pid);
        room.clients.delete(pid);
        pid = null;
        removeAwayPlayers(room); // last human gone? clear the bots
        break;
      }
      default:
        return;
    }
    pushState(room);
  }

  ws.on('close', () => {
    if (!room || !pid) return;
    if (room.clients.get(pid) !== ws) return; // replaced by a newer connection
    room.clients.delete(pid);
    const i = room.table.seatOf(pid);
    if (i !== -1) { room.table.seats[i].connected = false; room.table.seats[i].awayAt = Date.now(); }
    pushState(room);
  });
});

// Last line of defence: log unexpected errors (e.g. inside a bot timer) instead of
// shutting down every room on the server.
process.on('uncaughtException', (e) => console.error('uncaught error', e));
process.on('unhandledRejection', (e) => console.error('unhandled rejection', e));

// Always start the game, even if the database is unavailable.
openStore()
  .then((r) => { store = r.store; databaseError = r.error; })
  .catch((e) => { console.error('Storage error:', e.message); })
  .finally(() => server.listen(PORT, () => console.log(`Poker server running on http://localhost:${PORT} (accounts: ${store ? store.kind : 'none'})`)));
