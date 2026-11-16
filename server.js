// Poker server: serves the browser client and runs game rooms over WebSockets.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Table, VARIANTS } = require('./poker');
const bots = require('./bots');
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

const rooms = new Map(); // code -> { table, clients: Map(playerId -> ws), host, timers }

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
  while (rooms.has(c));
  return c;
}

function createRoom() {
  const code = makeCode();
  const room = { code, table: new Table(), clients: new Map(), host: null, nextTimer: null, turnTimer: null };
  room.table.onEvent = (kind) => {
    broadcast(room, { t: 'sfx', name: kind });
    if (kind === 'win') recordResults(room.table);
  };
  rooms.set(code, room);
  return room;
}

function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }

function broadcast(room, msg) { for (const ws of room.clients.values()) send(ws, msg); }

function pushState(room) {
  const t = room.table;
  for (const [pid, ws] of room.clients) {
    send(ws, { t: 'state', room: room.code, host: room.host, isHost: pid === room.host, state: t.view(pid) });
  }
  scheduleTimers(room);
}

function scheduleTimers(room) {
  const t = room.table;
  // Auto-deal next hand after a showdown.
  if (t.stage === 'showdown' && !room.nextTimer) {
    room.nextTimer = setTimeout(() => {
      room.nextTimer = null;
      if (t.stage === 'showdown' && hasHuman(room)) { rebuyBots(t); if (t.canStart()) t.startHand(); }
      else if (t.stage === 'showdown') t.stage = 'waiting';
      pushState(room);
    }, NEXT_HAND_DELAY);
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
        if (t.toAct !== seat || t.handNo !== hand || !t.isPlaying()) return;
        let d;
        try { d = bots.decide(t, seat); } catch (e) { console.error('bot error', e); d = { action: t.limits(seat).toCall > 0 ? 'fold' : 'check' }; }
        const r = t.act(p.id, d.action, d.amount);
        if (r.error) t.act(p.id, t.limits(seat).toCall > 0 ? 'fold' : 'check');
        pushState(room);
      }, wait);
    } else if (p && !p.connected) {
      room.turnTimer = setTimeout(() => {
        const lim = t.limits(t.toAct);
        t.act(p.id, lim.toCall > 0 ? 'fold' : 'check');
        pushState(room);
      }, DISCONNECTED_TURN_TIMEOUT);
    }
  }
}

// Save each account's result for the hand that just ended.
// Hands with 2+ humans count for the "friends" leaderboard, others for "bots".
function recordResults(t) {
  const humans = t.seats.filter((s) => s && s.inHand && !s.isBot).length;
  const mode = humans >= 2 ? 'friends' : 'bots';
  const winners = new Map((t.results ? t.results.winners : []).map((w) => [w.seat, w.amount]));
  t.seats.forEach((s, i) => {
    if (!s || !s.accountId || !s.inHand) return;
    const net = s.chips - s.startChips;
    store.recordHand(s.accountId, mode, net, winners.has(i), winners.get(i) || 0)
      .catch((e) => console.error('record error', e));
  });
}

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

function addChat(room, from, text) {
  room.table.addLog({ chat: true, from, text: String(text).slice(0, 200) });
}

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let room = null;
  let pid = null;

  ws.on('message', async (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'join') {
      let user = null;
      if (m.session) {
        try { user = await store.getUserBySession(String(m.session)); } catch (e) { console.error('session lookup', e); }
      }
      const name = user ? user.username : String(m.name || 'Player').trim().slice(0, 16) || 'Player';
      let code = String(m.room || '').toUpperCase().trim();
      if (!code) room = createRoom();
      else room = rooms.get(code);
      if (!room) return send(ws, { t: 'error', msg: `Room ${code} not found` });
      const table = room.table;
      // Rejoin a seat: by saved seat token, or because this account already sits here.
      const accountSeat = user ? table.seats.findIndex((s) => s && s.accountId === user.id) : -1;
      if (accountSeat !== -1 || (m.token && table.seatOf(m.token) !== -1)) {
        pid = accountSeat !== -1 ? table.seats[accountSeat].id : m.token;
        const old = room.clients.get(pid);
        if (old && old !== ws) old.close();
        table.seats[table.seatOf(pid)].connected = true;
      } else {
        pid = crypto.randomUUID();
        if (table.seats.every(Boolean)) removeBot(room); // make room for a human
        if (table.sit({ id: pid, name, accountId: user ? user.id : null }) === -1) { room = null; return send(ws, { t: 'error', msg: 'Table is full (8 players)' }); }
        table.addLog(`${name} joined`);
      }
      room.clients.set(pid, ws);
      if (!room.host || table.seatOf(room.host) === -1) room.host = pid;
      send(ws, { t: 'joined', room: room.code, token: pid });
      // "Practice vs bots": fill the table and deal right away.
      const nBots = Math.max(0, Math.min(7, Math.floor(Number(m.bots) || 0)));
      if (!code && nBots) {
        for (let i = 0; i < nBots; i++) addBot(room);
        table.startHand();
      }
      pushState(room);
      return;
    }

    if (!room || !pid) return;
    const t = room.table;
    const isHost = pid === room.host;
    const me = t.seats[t.seatOf(pid)];

    switch (m.t) {
      case 'action': {
        const r = t.act(pid, m.action, m.amount);
        if (r.error) send(ws, { t: 'error', msg: r.error });
        break;
      }
      case 'start':
        if (!isHost) return send(ws, { t: 'error', msg: 'Only the host can start' });
        rebuyBots(t);
        if (!t.startHand()) return send(ws, { t: 'error', msg: 'Need at least 2 players with chips — add a bot?' });
        break;
      case 'settings': {
        if (!isHost) return;
        const s = t.settings;
        if (VARIANTS[m.variant]) s.variant = m.variant;
        if (typeof m.rotate === 'boolean') s.rotate = m.rotate;
        if (typeof m.showOdds === 'boolean') s.showOdds = m.showOdds;
        const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number(v))));
        if (m.startingStack) s.startingStack = num(m.startingStack, 100, 1000000);
        if (m.bigBlind) { s.bigBlind = num(m.bigBlind, 2, 100000); s.smallBlind = Math.floor(s.bigBlind / 2); }
        if (!t.isPlaying()) t.variant = s.variant;
        break;
      }
      case 'addBot':
        if (!isHost) return;
        if (!addBot(room)) return send(ws, { t: 'error', msg: 'Table is full' });
        break;
      case 'removeBot':
        if (!isHost) return;
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
        if (me && m.text) { addChat(room, me.name, m.text); broadcast(room, { t: 'sfx', name: 'chat' }); }
        break;
      case 'leave':
        if (me && me.accountId && me.inHand && t.isPlaying()) {
          store.recordHand(me.accountId, t.seats.filter((s) => s && s.inHand && !s.isBot).length >= 2 ? 'friends' : 'bots',
            me.chips - me.startChips, false, 0).catch((e) => console.error('record error', e));
        }
        if (me) me.accountId = null; // already recorded; don't count this hand twice
        t.leave(pid);
        room.clients.delete(pid);
        pid = null;
        break;
      default:
        return;
    }
    pushState(room);
  });

  ws.on('close', () => {
    if (!room || !pid) return;
    if (room.clients.get(pid) !== ws) return; // replaced by a newer connection
    room.clients.delete(pid);
    const i = room.table.seatOf(pid);
    if (i !== -1) room.table.seats[i].connected = false;
    if (room.clients.size === 0) {
      // Keep empty rooms briefly so refreshes can rejoin, then clean up.
      setTimeout(() => {
        if (room.clients.size === 0) { clearTimeout(room.nextTimer); clearTimeout(room.turnTimer); rooms.delete(room.code); }
      }, 10 * 60 * 1000);
    } else if (pid === room.host) {
      const next = [...room.clients.keys()].find((id) => room.table.seatOf(id) !== -1);
      if (next) room.host = next;
    }
    pushState(room);
  });
});

// Always start the game, even if the database is unavailable.
openStore()
  .then((r) => { store = r.store; databaseError = r.error; })
  .catch((e) => { console.error('Storage error:', e.message); })
  .finally(() => server.listen(PORT, () => console.log(`Poker server running on http://localhost:${PORT} (accounts: ${store ? store.kind : 'none'})`)));
