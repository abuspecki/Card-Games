// End-to-end API test: boots the real server and exercises accounts, chips at
// tables, conversion, friends, invites, profiles, feedback, the owner dashboard,
// bans and shutdown cash-out. Uses TEST_DATABASE_URL if set, else a temp file.
const assert = require('assert');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = 4300 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}`;
const tag = Date.now().toString(36).slice(-5);
const OWNER = `boss_${tag}`;
const env = {
  ...process.env, PORT: String(PORT), OWNER_USERNAMES: OWNER,
  DATABASE_URL: process.env.TEST_DATABASE_URL || '',
  DATA_FILE: path.join(os.tmpdir(), `api-test-${tag}.json`),
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

  // ----- wallet endpoints -----
  let r = await call('POST', '/api/wallet/convert', ta, { coins: 5 });
  assert.strictEqual(r.status, 400, 'welcome chips do not convert');
  r = await call('POST', '/api/wallet/bankrupt', ta);
  assert.strictEqual(r.status, 400, 'not bankrupt');
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

  // ----- shutdown returns chips; restart refunds anything left -----
  const s2 = await sit('BLACKJACK-2', tb2);
  assert.strictEqual(s2.first.t, 'joined');
  await wait(300);
  w = (await call('GET', '/api/wallet', tb2)).data;
  assert.strictEqual(w.inPlay, 4900, 'high roller buy-in takes what you have');
  await stop('SIGTERM');
  await start();
  w = (await call('GET', '/api/wallet', tb2)).data;
  assert.deepStrictEqual([w.chips, w.inPlay], [4900, 0], 'chips back after restart');
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
