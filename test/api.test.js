// End-to-end API test: boots the real server and exercises accounts, chips at
// tables, conversion, friends, invites, profiles, feedback, the owner dashboard,
// bans and shutdown cash-out. Uses TEST_DATABASE_URL if set, else a temp file.
const assert = require('assert');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = 5100 + Math.floor(Math.random() * 800); // away from a dev server on 4400
const BASE = `http://localhost:${PORT}`;
const tag = Date.now().toString(36).slice(-5);
const OWNER = `boss_${tag}`;
const env = {
  ...process.env, PORT: String(PORT), OWNER_USERNAMES: OWNER,
  DATABASE_URL: process.env.TEST_DATABASE_URL || '',
  DATA_FILE: path.join(os.tmpdir(), `api-test-${tag}.json`),
  DRAIN_MS: '1500',   // don't wait the full 20 s for running hands on shutdown
};

let proc;
function start() {
  return new Promise((resolve, reject) => {
    proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env });
    proc.stdout.on('data', (d) => { if (/running on/.test(String(d))) resolve(); });
    proc.stderr.on('data', (d) => process.stderr.write(d));
    proc.on('exit', (c) => reject(new Error('server exited ' + c)));
  });
}
const stop = (sig = 'SIGTERM') => new Promise((r) => { proc.removeAllListeners('exit'); proc.on('exit', r); proc.kill(sig); });

async function call(method, url, token, body) {
  const r = await fetch(BASE + url, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
const register = async (u) => (await call('POST', '/api/register', null, { username: u, password: 'secret123' })).data.token;

// A table connection that collects messages.
function sit(table, token, name) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    const msgs = [];
    ws.on('message', (d) => { const m = JSON.parse(d); msgs.push(m); if (m.t === 'joined' || m.t === 'error') resolve({ ws, msgs, first: m }); });
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', room: table, session: token, name })));
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await start();
  const A = `ann_${tag}`, B = `bob_${tag}`;
  const ta = await register(A);
  const tb = await register(B);
  const to = await register(OWNER);

  // ----- chips follow you to the table and back -----
  let w = (await call('GET', '/api/wallet', ta)).data;
  assert.deepStrictEqual([w.chips, w.coins, w.inPlay], [5000, 200, 0]);
  let s = await sit('HOLDEM-1', ta);
  assert.strictEqual(s.first.t, 'joined');
  await wait(300);
  w = (await call('GET', '/api/wallet', ta)).data;
  assert.deepStrictEqual([w.chips, w.inPlay], [4000, 1000], 'buy-in moved 1000 chips to the table');
  const state = s.msgs.filter((m) => m.t === 'state').pop();
  assert.strictEqual(state.state.seats[state.state.mySeat].chips, 1000);
  s.ws.send(JSON.stringify({ t: 'leave' }));
  await wait(400);
  w = (await call('GET', '/api/wallet', ta)).data;
  assert.deepStrictEqual([w.chips, w.inPlay], [5000, 0], 'cash-out on leave');

  // High roller: accounts only, and Durak HR needs a 10k bankroll
  const guest = await sit('HOLDEM-2', null, 'Guesty');
  assert.strictEqual(guest.first.t, 'error');
  guest.ws.close();
  const hr = await sit('DURAK-2', ta);
  assert.strictEqual(hr.first.t, 'error');
  assert(/10,000 chips/.test(hr.first.msg));
  hr.ws.close();
  // Guests still play free at normal tables
  const g2 = await sit('BLACKJACK-1', null, 'Visitor');
  assert.strictEqual(g2.first.t, 'joined');
  g2.ws.close();

  // ----- names with umlauts and spaces; failed attempts do not use up the network's quota -----
  let reg = await call('POST', '/api/register', null, { username: '  Jörg   Müller ', password: 'secret123' });
  assert.strictEqual(reg.status, 200, JSON.stringify(reg.data));
  assert.strictEqual(reg.data.username, 'Jörg Müller', 'spaces tidied');
  assert.strictEqual((await call('POST', '/api/login', null, { username: 'jörg müller', password: 'secret123' })).status, 200, 'login ignores case');
  assert.strictEqual((await call('GET', '/api/players/' + encodeURIComponent('Jörg Müller'), null)).status, 200, 'profile with umlauts');
  assert.strictEqual((await call('POST', '/api/register', null, { username: 'ab', password: 'secret123' })).status, 400, 'too short');
  assert.strictEqual((await call('POST', '/api/register', null, { username: 'bad<name>', password: 'secret123' })).status, 400, 'no symbols');
  for (let k = 0; k < 8; k++) assert.strictEqual((await call('POST', '/api/register', null, { username: 'Jörg Müller', password: 'secret123' })).status, 409, 'taken');
  reg = await call('POST', '/api/register', null, { username: 'Zoë', password: 'secret123' });
  assert.strictEqual(reg.status, 200, 'failed attempts did not block the network');

  // ----- wallet endpoints -----
  let r = await call('POST', '/api/wallet/convert', ta, { coins: 5 });
  assert.strictEqual(r.data.spentChips, 550, '5 coins cost 550 chips (100 each + 10 % fee)');
  assert.strictEqual((await call('POST', '/api/wallet/convert', ta, { coins: 999999 })).status, 400, 'per-exchange limit');
  r = await call('POST', '/api/wallet/bankrupt', ta);
  assert.strictEqual(r.status, 400, 'no top-up above 1,000 chips');
  r = await call('POST', '/api/wallet/daily', ta);
  assert.strictEqual(r.data.amount, 100);
  r = await call('GET', '/api/wallet', null);
  assert.strictEqual(r.status, 401);

  // ----- friends, presence, invites, profiles -----
  r = await call('POST', '/api/friends/request', ta, { username: B });
  assert.strictEqual(r.data.status, 'sent');
  r = await call('POST', '/api/friends/request', ta, { username: B });
  assert.strictEqual(r.status, 400, 'no duplicate request');
  assert.strictEqual((await call('POST', '/api/friends/request', ta, { username: A })).status, 400, 'not yourself');
  assert.strictEqual((await call('POST', '/api/friends/request', ta, { username: 'nobody_' + tag })).status, 404);
  let fb = (await call('GET', '/api/friends', tb)).data.friends;
  assert.deepStrictEqual(fb.map((f) => [f.username, f.status]), [[A, 'received']]);
  assert.strictEqual((await call('GET', '/api/presence', tb)).data.requests, 1);
  assert.strictEqual((await call('POST', '/api/friends/invite', ta, { username: B, table: 'HOLDEM-1' })).status, 400, 'invite needs friendship');
  r = await call('POST', '/api/friends/respond', tb, { username: A, accept: true });
  assert.strictEqual(r.data.status, 'friend');
  const fa = (await call('GET', '/api/friends', ta)).data.friends;
  assert.strictEqual(fa[0].status, 'friend');
  assert.strictEqual(fa[0].online, true, 'B was just active');
  r = await call('POST', '/api/friends/invite', ta, { username: B, table: 'BLACKJACK-1' });
  assert.strictEqual(r.status, 200);
  const pres = (await call('GET', '/api/presence', tb)).data;
  assert.strictEqual(pres.invites.length, 1);
  assert.strictEqual(pres.invites[0].from, A);
  await call('POST', '/api/friends/dismiss', tb, { username: A, id: pres.invites[0].id });
  assert.strictEqual((await call('GET', '/api/presence', tb)).data.invites.length, 0);
  // where a friend is playing
  const sb = await sit('BLACKJACK-1', tb);
  await wait(200);
  const where = (await call('GET', '/api/friends', ta)).data.friends[0].where;
  assert.strictEqual(where && where.table, 'BLACKJACK-1');
  let prof = (await call('GET', `/api/players/${B}`, ta)).data;
  assert.strictEqual(prof.friendship, 'friends');
  assert.strictEqual(prof.username, B);
  assert.strictEqual(prof.pass, undefined, 'no password hash leaks');
  assert.strictEqual((await call('GET', '/api/players/ghost_' + tag, null)).status, 404);
  r = await call('POST', '/api/friends/remove', ta, { username: B });
  assert.strictEqual((await call('GET', '/api/friends', ta)).data.friends.length, 0);

  // ----- feedback -----
  assert.strictEqual((await call('POST', '/api/feedback', null, { category: 'bug', message: 'hi' })).status, 400, 'too short');
  assert.strictEqual((await call('POST', '/api/feedback', null, { category: 'bug', message: 'The river card overlaps the pot on my phone' })).status, 200);
  assert.strictEqual((await call('POST', '/api/feedback', ta, { category: 'nonsense', message: 'Please add Omaha back!' })).status, 200);

  // ----- owner dashboard -----
  assert.strictEqual((await call('GET', '/api/admin/overview', ta)).status, 403, 'non-owners blocked');
  assert.strictEqual((await call('GET', '/api/admin/overview', null)).status, 401);
  assert.strictEqual((await call('GET', '/api/me', to)).data.isOwner, true);
  const ov = (await call('GET', '/api/admin/overview', to)).data;
  assert(ov.totals.players >= 3);
  assert(ov.totals.feedback_new >= 2);
  assert(ov.live.humans >= 1);
  const pl = (await call('GET', `/api/admin/players?search=${tag}`, to)).data;
  assert.strictEqual(pl.total, 3);
  const bob = pl.players.find((p) => p.username === B);
  const boss = pl.players.find((p) => p.username === OWNER);
  const fbl = (await call('GET', '/api/admin/feedback', to)).data.feedback;
  const mine = fbl.find((f) => /Omaha/.test(f.message));
  assert.strictEqual(mine.category, 'general', 'unknown category falls back');
  assert.strictEqual(mine.username, A);
  assert.strictEqual((await call('POST', `/api/admin/feedback/${mine.id}`, to, { status: 'resolved' })).status, 200);
  assert.strictEqual((await call('GET', '/api/admin/feedback?status=resolved', to)).data.feedback.some((f) => f.id === mine.id), true);
  assert.strictEqual((await call('POST', `/api/admin/feedback/${mine.id}/delete`, to)).status, 200);
  // adjust balances
  r = await call('POST', `/api/admin/players/${bob.id}/adjust`, to, { coins: 500, chips: -100 });
  assert.strictEqual(r.data.coins, 700);
  // ban: kicked from the table with chips returned, sessions dead, login refused
  assert.strictEqual((await call('POST', `/api/admin/players/${boss.id}/ban`, to, {})).status, 400, 'owners cannot be banned');
  const kicked = new Promise((res) => sb.ws.on('message', (d) => { if (JSON.parse(d).t === 'kicked') res(); }));
  assert.strictEqual((await call('POST', `/api/admin/players/${bob.id}/ban`, to, { reason: 'test' })).status, 200);
  await kicked;
  assert.strictEqual((await call('GET', '/api/wallet', tb)).status, 401, 'session revoked');
  r = await call('POST', '/api/login', null, { username: B, password: 'secret123' });
  assert.strictEqual(r.status, 403);
  assert(/suspended/.test(r.data.error));
  const det = (await call('GET', `/api/admin/players/${bob.id}`, to)).data;
  assert.strictEqual(det.player.banned, true);
  assert.strictEqual(det.wallet.inPlay, 0, 'chips returned on ban');
  assert.strictEqual(det.wallet.chips, 4900);
  assert.strictEqual((await call('GET', `/api/players/${B}`, null)).status, 404, 'banned profile hidden');
  assert.strictEqual((await call('POST', `/api/admin/players/${bob.id}/unban`, to)).status, 200);
  const tb2 = (await call('POST', '/api/login', null, { username: B, password: 'secret123' })).data.token;
  assert(tb2, 'can log in after unban');

  // ----- BigV is always an owner -----
  let tv = (await call('POST', '/api/register', null, { username: 'BigV', password: 'secret123' })).data.token;
  if (!tv) tv = (await call('POST', '/api/login', null, { username: 'BigV', password: 'secret123' })).data.token;
  assert.strictEqual((await call('GET', '/api/me', tv)).data.isOwner, true, 'BigV is an owner');
  assert.strictEqual((await call('GET', '/api/admin/overview', tv)).status, 200);

  // ----- theme preference -----
  assert.strictEqual((await call('POST', '/api/me/theme', ta, { theme: 'dark' })).status, 200);
  assert.strictEqual((await call('GET', '/api/me', ta)).data.theme, 'dark');
  assert.strictEqual((await call('POST', '/api/me/theme', ta, { theme: 'neon' })).status, 400);

  // ----- the Bank: coins back into chips -----
  const before = (await call('GET', '/api/wallet', ta)).data;
  r = await call('POST', '/api/wallet/buychips', ta, { coins: 50 });
  assert.strictEqual(r.data.gotChips, 50 * before.buyChips.rate);
  assert.strictEqual(r.data.wallet.coins, before.coins - 50);
  assert.strictEqual(r.data.wallet.chips, before.chips + 50 * before.buyChips.rate);
  assert.strictEqual((await call('POST', '/api/wallet/buychips', ta, { coins: 999999 })).status, 400);
  assert.strictEqual((await call('POST', '/api/wallet/buychips', ta, { coins: -3 })).status, 400);
  // Trading in a circle always loses: chips bought with coins convert back at a worse rate.
  assert(before.buyChips.rate < before.convert.rate);

  // ----- task board: owners only; the old developer-key board is gone -----
  assert.strictEqual((await call('GET', '/api/admin/tasks', ta)).status, 403, 'players cannot see the board');
  assert.strictEqual((await fetch(BASE + '/api/tasks')).status, 404, 'old board API removed');

  // ----- feedback centre: ranking, convert to task, auto-resolve -----
  await call('POST', '/api/feedback', ta, { category: 'bug', message: 'The game crashes when I fold on my phone and I lose chips' });
  await call('POST', '/api/feedback', tb2, { category: 'bug', message: 'Game crashes after I fold on the phone, chips lost' });
  const fov = (await call('GET', '/api/admin/feedback/overview', to)).data;
  const crash = fov.clusters.find((c) => /crash/i.test(c.message));
  assert.strictEqual(crash.count, 2, 'duplicates merged');
  assert.strictEqual(crash.level, 'critical');
  assert.strictEqual(fov.clusters[0].message, crash.message, 'most important first');
  r = await call('POST', '/api/admin/feedback/totask', to, { ids: crash.ids });
  assert(r.data.url.startsWith('https://github.com/') && /template=aufgabe\.yml/.test(r.data.url) && /beschreibung=/.test(r.data.url), 'feedback opens a pre-filled task form');
  const readNow = (await call('GET', '/api/admin/feedback?status=read', to)).data.feedback;
  assert(crash.ids.every((x) => readNow.some((f) => f.id === x)), 'turned-into-task feedback is marked read');

  // ----- Gold Rush through the API: stake held, then paid out -----
  assert.strictEqual((await call('POST', '/api/goldrush/start', null, { stake: 50, level: 'easy' })).status, 401, 'members only');
  const gw0 = (await call('GET', '/api/wallet', ta)).data.chips;
  let gres = await call('POST', '/api/goldrush/start', ta, { stake: 50, level: 'easy' });
  assert.strictEqual(gres.status, 200, JSON.stringify(gres.data));
  assert.strictEqual(gres.data.wallet.chips, gw0 - 50);
  assert.strictEqual(gres.data.wallet.inPlay, 50, 'stake held like table chips');
  assert.strictEqual((await call('GET', '/api/goldrush', ta)).data.round.stake, 50);
  gres = await call('POST', '/api/goldrush/cashout', ta);
  assert.strictEqual(gres.data.payout, 50, 'cash out before digging returns the stake');
  assert.strictEqual(gres.data.wallet.chips, gw0);
  assert.strictEqual((await call('POST', '/api/goldrush/dig', ta)).status, 400, 'no dig without a round');

  // ----- error monitoring: browser reports are grouped and shown to owners -----
  for (let k = 0; k < 3; k++) await call('POST', '/api/client-error', ta, { message: `TypeError: x is undefined (id ${k}23)`, stack: 'at app.js:1:2', where: '/?table=HOLDEM-1' });
  assert.strictEqual((await call('GET', '/api/admin/errors', ta)).status, 403, 'owners only');
  let errs = (await call('GET', '/api/admin/errors', to)).data.errors;
  const be = errs.find((e) => e.source === 'browser' && /x is undefined/.test(e.message));
  assert(be && be.count === 3, 'similar reports are grouped');
  assert(/HOLDEM-1/.test(be.context) && be.stack, 'context and stack kept');
  await call('POST', '/api/admin/errors/clear', to, { key: be.key });
  errs = (await call('GET', '/api/admin/errors', to)).data.errors;
  assert(!errs.some((e) => e.key === be.key), 'resolved');

  // ----- announced update: countdown, then no new hands; status tells when it is safe -----
  assert.strictEqual((await call('POST', '/api/admin/maintenance', ta, { minutes: 5 })).status, 403, 'owners only');
  let mt = await call('POST', '/api/admin/maintenance', to, { minutes: 5 });
  assert(mt.data.maintenance.msLeft > 4 * 60000 && !mt.data.maintenance.paused);
  assert((await call('GET', '/api/tables', null)).data.maintenance, 'lobby sees the notice');
  mt = await call('POST', '/api/admin/maintenance', to, { minutes: 0 });
  assert.strictEqual(mt.data.maintenance, null, 'cancelled');
  const st0 = (await call('GET', '/api/status', null)).data;
  assert.strictEqual(typeof st0.idle, 'boolean');
  assert.strictEqual(typeof st0.players, 'number');

  // ----- owners can watch a table without a seat -----
  const watch = (session) => new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    const got = [];
    ws.on('message', (d) => { const m = JSON.parse(d); got.push(m); if (m.t === 'error' || (m.t === 'state' && m.watching)) resolve({ ws, m, got }); });
    ws.on('open', () => ws.send(JSON.stringify({ t: 'watch', room: 'HOLDEM-1', session })));
  });
  const notOwner = await watch(ta);
  assert.strictEqual(notOwner.m.t, 'error', 'only owners may watch');
  notOwner.ws.close();
  const hum0 = (await call('GET', '/api/tables', null)).data.tables.find((x) => x.id === 'HOLDEM-1').humans;
  const w1 = await watch(to);
  assert.strictEqual(w1.m.state.mySeat, -1, 'watcher has no seat');
  assert(w1.got.some((x) => x.t === 'watching'));
  assert.strictEqual((await call('GET', '/api/tables', null)).data.tables.find((x) => x.id === 'HOLDEM-1').humans, hum0, 'watching takes no seat');
  w1.ws.send(JSON.stringify({ t: 'addBot' }));
  await wait(200);
  assert.strictEqual((await call('GET', '/api/tables', null)).data.tables.find((x) => x.id === 'HOLDEM-1').bots, 0, 'watchers cannot act');
  w1.ws.close();

  // ----- leaving over HTTP: works even when the game connection is gone -----
  const seatsAt = async (id) => (await call('GET', '/api/tables', null)).data.tables.find((x) => x.id === id).humans;
  const g1 = await sit('DURAK-1', null, 'Gast');
  assert.strictEqual(g1.first.t, 'joined');
  g1.ws.terminate();                                   // connection dropped
  await wait(150);
  assert.strictEqual(await seatsAt('DURAK-1'), 1, 'seat kept for a reconnect');
  assert.strictEqual((await call('POST', '/api/leave', null, { table: 'DURAK-1', token: 'wrong' })).data.left, 0);
  assert.strictEqual((await call('POST', '/api/leave', null, { table: 'DURAK-1', token: g1.first.token })).data.left, 1);
  assert.strictEqual(await seatsAt('DURAK-1'), 0, 'guest seat freed by token');
  let wb = (await call('GET', '/api/wallet', tb2)).data.chips;
  const m1 = await sit('BLACKJACK-1', tb2);
  assert.strictEqual(m1.first.t, 'joined');
  assert.strictEqual((await call('GET', '/api/me', tb2)).data.seat.table, 'BLACKJACK-1', '/api/me shows where you sit');
  const goneMsg = new Promise((r) => m1.ws.on('message', (d) => { if (JSON.parse(d).t === 'left') r(true); }));
  assert.strictEqual((await call('POST', '/api/leave', tb2, {})).data.left, 1, 'members leave by account, no token needed');
  assert(await Promise.race([goneMsg, wait(1000).then(() => false)]), 'the open table screen is told');
  await wait(150);
  assert.strictEqual((await call('GET', '/api/me', tb2)).data.seat, null);
  assert.strictEqual((await call('GET', '/api/wallet', tb2)).data.chips, wb, 'chips back in the bankroll');
  assert.strictEqual((await call('POST', '/api/leave', null, {})).status, 400);

  // ----- shutdown returns chips; restart refunds anything left -----
  const s2 = await sit('BLACKJACK-2', tb2);
  assert.strictEqual(s2.first.t, 'joined');
  await wait(300);
  w = (await call('GET', '/api/wallet', tb2)).data;
  assert.strictEqual(w.inPlay, 4900, 'high roller buy-in takes what you have');
  // bet in the middle of a hand, then the server restarts: the hand is called off, the bet comes back
  let lastBj = null;
  const betPlaced = new Promise((r) => s2.ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'state') lastBj = { stage: m.state.stage, limits: m.state.limits, me: m.state.seats[m.state.mySeat], maint: m.maintenance };
    if (m.t === 'error') lastBj = { error: m.msg };
    if (m.t === 'state' && m.state.limits && m.state.limits.phase === 'bet') s2.ws.send(JSON.stringify({ t: 'action', action: 'bet', amount: 500 }));
    if (m.t === 'state' && m.state.seats[m.state.mySeat] && m.state.seats[m.state.mySeat].chips === 4400) r(true);
  }));
  assert(await Promise.race([betPlaced, wait(12000).then(() => false)]), '500 bet placed: ' + JSON.stringify(lastBj));
  await stop('SIGTERM');
  await start();
  w = (await call('GET', '/api/wallet', tb2)).data;
  assert.deepStrictEqual([w.chips, w.inPlay], [4900 + 1000, 0], 'chips back after restart, plus the 1,000 update bonus');
  await call('POST', '/api/admin/players/' + (await call('GET', '/api/admin/players?search=' + B, to)).data.players[0].id + '/adjust', to, { chips: -1000 });
  // crash (no graceful shutdown) is refunded at the next start
  const s3 = await sit('HOLDEM-1', tb2);
  await wait(300);
  assert.strictEqual((await call('GET', '/api/wallet', tb2)).data.inPlay, 1000);
  await stop('SIGKILL');
  await start();
  w = (await call('GET', '/api/wallet', tb2)).data;
  assert.deepStrictEqual([w.chips, w.inPlay], [4900, 0], 'crash refund');
  s3.ws.close();

  await stop('SIGTERM');
  console.log(`api ok (${env.DATABASE_URL ? 'postgres' : 'file'})`);
  process.exit(0);
})().catch(async (e) => { console.error(e); try { await stop('SIGKILL'); } catch {} process.exit(1); });
