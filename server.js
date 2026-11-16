// Poker server: serves the browser client and runs game rooms over WebSockets.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Table, VARIANTS } = require('./poker');
const bots = require('./bots');

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

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
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
  room.table.onEvent = (kind) => broadcast(room, { t: 'sfx', name: kind });
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

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }

    if (m.t === 'join') {
      const name = String(m.name || 'Player').trim().slice(0, 16) || 'Player';
      let code = String(m.room || '').toUpperCase().trim();
      if (!code) room = createRoom();
      else room = rooms.get(code);
      if (!room) return send(ws, { t: 'error', msg: `Room ${code} not found` });
      const table = room.table;
      // Rejoin with a saved token if this player already has a seat.
      if (m.token && table.seatOf(m.token) !== -1) {
        pid = m.token;
        const old = room.clients.get(pid);
        if (old && old !== ws) old.close();
        table.seats[table.seatOf(pid)].connected = true;
      } else {
        pid = crypto.randomUUID();
        if (table.seats.every(Boolean)) removeBot(room); // make room for a human
        if (table.sit({ id: pid, name }) === -1) { room = null; return send(ws, { t: 'error', msg: 'Table is full (8 players)' }); }
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

server.listen(PORT, () => console.log(`Poker server running on http://localhost:${PORT}`));
