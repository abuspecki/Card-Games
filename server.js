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
const { makeCoins, rewardFor } = require('./coins');
const { createGoldRush } = require('./goldrush');
const { createErrorLog } = require('./errorlog');
const { createQuests } = require('./quests');
const { createBackups } = require('./backups');
const { createWeekly } = require('./weekly');
// Error monitoring first, so every console.error from here on is recorded.
const errors = createErrorLog();
errors.hookConsole();
const UPDATE_BONUS = 1000; // chips for every member who is playing when the server restarts
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
// BigV is always an owner (the account already exists, so the name can't be claimed by anyone else).
const DEFAULT_OWNERS = ['bigv'];
const owners = new Set([...DEFAULT_OWNERS, ...String(process.env.OWNER_USERNAMES || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)]);

let store = null;
let coins = null;
let databaseError = null;
const ctx = { store: () => store, coins: () => coins, databaseError: () => databaseError, owners };
ctx.errors = errors;
ctx.lobby = createLobby(ctx);
// Coins for a win outside the tables (Gold Rush), with the same daily cap.
ctx.reward = (userId, result) => { const n = rewardFor(result); return n ? coins.earn(userId, n, Date.now(), `win:${result.mode}`) : null; };
ctx.goldrush = createGoldRush(ctx);
ctx.quests = createQuests(ctx);
ctx.backups = createBackups(ctx);
ctx.weekly = createWeekly(ctx);
const api = createApi(ctx);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'SAMEORIGIN',
};

// ---------- static files: one CSS and one JS bundle, cached by the browser ----------
// At start-up the stylesheets and scripts that index.html lists are joined into
// /bundle.css and /bundle.js (named by a content hash), so a visit needs 2
// requests instead of ~19, and repeat visits load them from the browser cache.
const crypto = require('crypto');
const hashOf = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);
const bundles = {};
let indexHtml = null;
function buildBundles() {
  try {
    let html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
    const bodyAt = html.indexOf('<body');
    const css = [];
    html = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)">\n?/g, (m, href) => { css.push(href); return css.length === 1 ? '@@CSS@@' : ''; });
    const js = [];
    const head = html.slice(0, html.indexOf('<body'));
    let body = html.slice(html.indexOf('<body'));
    body = body.replace(/ *<script src="([^"]+)"><\/script>\n?/g, (m, src) => { js.push(src); return js.length === 1 ? '@@JS@@' : ''; });
    if (!css.length || !js.length || bodyAt === -1) return;
    const cssBuf = Buffer.from(css.map((f) => `/* ${f} */\n` + fs.readFileSync(path.join(PUBLIC, f), 'utf8')).join('\n'));
    const jsBuf = Buffer.from(js.map((f) => `/* ${f} */\n` + fs.readFileSync(path.join(PUBLIC, f), 'utf8') + '\n;').join('\n'));
    const ch = hashOf(cssBuf), jh = hashOf(jsBuf);
    bundles['/bundle.css'] = { data: cssBuf, type: 'text/css; charset=utf-8', hash: ch };
    bundles['/bundle.js'] = { data: jsBuf, type: 'text/javascript; charset=utf-8', hash: jh };
    indexHtml = Buffer.from((head + body)
      .replace('@@CSS@@', `<link rel="stylesheet" href="/bundle.css?v=${ch}">\n`)
      .replace('@@JS@@', `  <script src="/bundle.js?v=${jh}"></script>\n`));
  } catch (e) {
    console.error('bundle error (serving files one by one)', e.message);
  }
}
buildBundles();

function sendFile(req, res, data, type, cache) {
  const etag = '"' + hashOf(data) + '"';
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', cache);
  if (req.headers['if-none-match'] === etag) { res.writeHead(304); return res.end(); }
  res.writeHead(200, { 'Content-Type': type });
  res.end(data);
}

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
  // The service worker must not be cached for long, or updates would be slow to arrive.
  if (url === '/sw.js') {
    return fs.readFile(path.join(PUBLIC, 'sw.js'), (err, data) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.setHeader('Service-Worker-Allowed', '/');
      sendFile(req, res, data, 'text/javascript; charset=utf-8', 'no-cache');
    });
  }
  if (bundles[url]) return sendFile(req, res, bundles[url].data, bundles[url].type, 'public, max-age=31536000, immutable');
  if ((url === '/' || url === '/index.html') && indexHtml) return sendFile(req, res, indexHtml, 'text/html; charset=utf-8', 'no-cache');
  const route = { '/': 'index.html', '/admin': 'admin.html' }[url] || url;
  const file = path.normalize(path.join(PUBLIC, route));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    // Other files: the browser keeps them but checks for changes (cheap 304s).
    sendFile(req, res, data, TYPES[path.extname(file)] || 'application/octet-stream', /\.(png|jpe?g|svg|webp|mp3|wav|ogg|ico)$/.test(file) ? 'public, max-age=86400' : 'no-cache');
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
  try {
    if (coins) {
      // Let running hands finish first (Render waits ~30 s after SIGTERM).
      const calm = await ctx.lobby.drain(Number(process.env.DRAIN_MS) || 20000);
      console.log(calm ? 'All hands finished — shutting down' : 'Some hands still running — calling them off');
      // Everyone playing right now gets a thank-you for the interruption.
      const playing = new Set([...ctx.lobby.seatedAccounts(), ...ctx.goldrush._rounds.keys()]);
      const work = Promise.all([ctx.lobby.cashOutAll(), ctx.goldrush.cashOutAll()])
        .then(() => Promise.all([...playing].map((id) => coins.adjust(id, 0, UPDATE_BONUS, 'bonus').catch((e) => console.error('update bonus', e)))))
        .then(() => console.log(`Update bonus: ${UPDATE_BONUS} chips for ${playing.size} player(s)`));
      await Promise.race([work, new Promise((r) => setTimeout(r, 8000))]);
    }
  } catch (e) { console.error(e); }
  try { await errors.flush(); } catch { /* ignore */ }
  try { if (store && store.flush) store.flush(); } catch (e) { console.error('flush', e); }
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
    await errors.attach(store);
    // every recorded result also counts for quests and achievements
    const recordHand = store.recordHand.bind(store);
    store.recordHand = async (userId, mode, net, won, pot, extra = {}) => {
      await recordHand(userId, mode, net, won, pot);
      ctx.quests.onResult(userId, { mode, net, won, pot, depth: extra.depth });
      ctx.weekly.onResult(userId, mode, net, won);
    };
    // Chips left at tables by a crash go back to their owners.
    const refunded = await store.refundInPlay();
    if (refunded) console.log(`Refunded table chips for ${refunded} player(s) after a restart`);
    // a full backup every day
    ctx.backups.start();
    // the weekly ranking pays last week's prizes once the new week has begun
    ctx.weekly.start();
    // One-time thank-you for the players interrupted by the Gold Rush update
    // (the old server could not pay the update bonus yet). Runs only once.
    if (await store.claimOnce('update-bonus-2026-11-17-goldrush')) {
      for (const name of ['Eule_Mit_Keule', 'Flöti']) {
        const u = await store.getUserByName(name);
        if (u) { await coins.adjust(u.id, 0, UPDATE_BONUS, 'bonus'); console.log(`Update bonus: ${UPDATE_BONUS} chips for ${u.username}`); }
      }
    }
  })
  .catch((e) => console.error('Storage error:', e.message))
  .finally(() => server.listen(PORT, () => {
    console.log(`CardGames running on http://localhost:${PORT} (data: ${store ? store.kind : 'none'}; owners: ${owners.size ? [...owners].join(', ') : 'none set'})`);
  }));
