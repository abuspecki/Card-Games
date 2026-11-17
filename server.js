// CardGames server: serves the website and runs the tables over WebSockets.
//   tables.js — the six lobby tables (seats, bots, timers, chips in/out)
//   api.js    — accounts, wallet & shop, friends, feedback, owner dashboard
//   store.js  — Postgres (or a local JSON file) persistence
//   coins.js  — the chips & coins economy
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { openStore } = require('./store');
const { makeCoins } = require('./coins');
const { createLobby } = require('./tables');
const { createApi } = require('./api');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.json': 'application/json', '.png': 'image/png',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

// Owners (who may open the dashboard) are set with an environment variable:
//   OWNER_USERNAMES=alice,bob
const owners = new Set(String(process.env.OWNER_USERNAMES || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));

let store = null;
let coins = null;
let databaseError = null;
const ctx = { store: () => store, coins: () => coins, databaseError: () => databaseError, owners };
ctx.lobby = createLobby(ctx);
const api = createApi(ctx);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'SAMEORIGIN',
};

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  if (url.startsWith('/api/')) return api.handle(req, res, url);
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
    try { list = fs.readdirSync(path.join(PUBLIC, 'sounds')).filter((f) => /\.(mp3|wav|ogg)$/.test(f)); } catch { /* none */ }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(list));
  }
  const route = { '/': 'index.html', '/admin': 'admin.html' }[url] || url;
  const file = path.normalize(path.join(PUBLIC, route));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => ctx.lobby.handleConnection(ws));

// Last line of defence: log unexpected errors (e.g. inside a bot timer) instead
// of shutting down every table on the server.
process.on('uncaughtException', (e) => console.error('uncaught error', e));
process.on('unhandledRejection', (e) => console.error('unhandled rejection', e));

// On shutdown (Render sends SIGTERM before each deploy) give everyone's table
// chips back to their bankrolls first.
let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: returning table chips to bankrolls…`);
  try { if (coins) await Promise.race([ctx.lobby.cashOutAll(), new Promise((r) => setTimeout(r, 8000))]); } catch (e) { console.error(e); }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Always start the game, even if the database is unavailable.
openStore()
  .then(async (r) => {
    store = r.store;
    databaseError = r.error;
    coins = makeCoins(store);
    // Chips left at tables by a crash go back to their owners.
    const refunded = await store.refundInPlay();
    if (refunded) console.log(`Refunded table chips for ${refunded} player(s) after a restart`);
  })
  .catch((e) => console.error('Storage error:', e.message))
  .finally(() => server.listen(PORT, () => {
    console.log(`CardGames running on http://localhost:${PORT} (data: ${store ? store.kind : 'none'}; owners: ${owners.size ? [...owners].join(', ') : 'none set'})`);
  }));
