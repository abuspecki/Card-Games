// Passwords (change your own, owner sets a temporary one) and backups
// (make, download, restore from the list and from a file). Boots the real
// server; uses TEST_DATABASE_URL if set, else a temp file.
const assert = require('assert');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const WebSocket = require('ws');

const PORT = 5100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const tag = Date.now().toString(36).slice(-5);
const OWNER = `own_${tag}`;
const env = {
  ...process.env, PORT: String(PORT), OWNER_USERNAMES: OWNER,
  DATABASE_URL: process.env.TEST_DATABASE_URL || '',
  DATA_FILE: path.join(os.tmpdir(), `account-test-${tag}.json`),
  DRAIN_MS: '1000',
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
const stop = () => new Promise((r) => { proc.removeAllListeners('exit'); proc.on('exit', r); proc.kill('SIGTERM'); });
async function call(method, url, token, body) {
  const r = await fetch(BASE + url, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
const login = (u, p) => call('POST', '/api/login', null, { username: u, password: p });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await start();
  const A = `ann_${tag}`, B = `ben_${tag}`;
  const to = (await call('POST', '/api/register', null, { username: OWNER, password: 'owner123' })).data.token;
  const ta = (await call('POST', '/api/register', null, { username: A, password: 'secret123' })).data.token;
  const tb = (await call('POST', '/api/register', null, { username: B, password: 'secret123' })).data.token;
  const idOf = async (u) => (await call('GET', `/api/admin/players?search=${u}`, to)).data.players[0].id;

  // ----- change your own password -----
  const ta2 = (await login(A, 'secret123')).data.token;            // a second device
  assert.strictEqual((await call('POST', '/api/me/password', null, { current: 'secret123', password: 'newpass1' })).status, 401);
  let r = await call('POST', '/api/me/password', ta, { current: 'wrong', password: 'newpass1' });
  assert.strictEqual(r.status, 400, 'wrong current password');
  assert.strictEqual((await call('POST', '/api/me/password', ta, { current: 'secret123', password: '123' })).status, 400, 'too short');
  assert.strictEqual((await call('POST', '/api/me/password', ta, { current: 'secret123', password: 'secret123' })).status, 400, 'same as old');
  r = await call('POST', '/api/me/password', ta, { current: 'secret123', password: 'newpass1' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.strictEqual((await call('GET', '/api/me', ta)).status, 200, 'this device stays signed in');
  assert.strictEqual((await call('GET', '/api/me', ta2)).status, 401, 'other devices are signed out');
  assert.strictEqual((await login(A, 'secret123')).status, 401, 'old password no longer works');
  assert.strictEqual((await login(A, 'newpass1')).status, 200);

  // ----- owner sets a temporary password -----
  const idB = await idOf(B);
  assert.strictEqual((await call('POST', `/api/admin/players/${idB}/password`, ta, {})).status, 403, 'owners only');
  assert.strictEqual((await call('POST', `/api/admin/players/${await idOf(OWNER)}/password`, to, {})).status, 400, 'not for owners');
  r = await call('POST', `/api/admin/players/${idB}/password`, to, {});
  assert.strictEqual(r.status, 200);
  const temp = r.data.password;
  assert.ok(/^[a-z2-9]{4}-[a-z2-9]{4}$/.test(temp), temp);
  assert.strictEqual((await call('GET', '/api/me', tb)).status, 401, 'signed out everywhere');
  assert.strictEqual((await login(B, 'secret123')).status, 401);
  r = await login(B, temp);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.mustChange, true, 'login says: choose a new one');
  const tb2 = r.data.token;
  assert.strictEqual((await call('GET', '/api/me', tb2)).data.mustChange, true);
  r = await call('POST', '/api/me/password', tb2, { password: 'benspass' });   // no current password needed now
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.strictEqual((await call('GET', '/api/me', tb2)).data.mustChange, false);
  assert.strictEqual((await call('POST', '/api/me/password', tb2, { password: 'another1' })).status, 400, 'now the current one is needed again');
  assert.ok((await call('GET', '/api/admin/activity', to)).data.log.some((l) => l.action.includes(`temporary password for ${B}`)));

  // ----- backups -----
  assert.strictEqual((await call('GET', '/api/admin/backups', ta)).status, 403);
  r = await call('POST', '/api/admin/backups', to, {});
  assert.strictEqual(r.status, 200);
  const first = r.data.backup;
  assert.ok(first.summary.users >= 3 && first.size > 100);
  const idA = await idOf(A);
  const coinsBefore = (await call('GET', '/api/wallet', ta)).data.coins;
  await call('POST', `/api/admin/players/${idA}/adjust`, to, { coins: 500 });
  assert.strictEqual((await call('GET', '/api/wallet', ta)).data.coins, coinsBefore + 500);

  // download
  const dl = await fetch(`${BASE}/api/admin/backups/${first.id}/download`, { headers: { Authorization: 'Bearer ' + to } });
  assert.strictEqual(dl.status, 200);
  assert.ok(/attachment; filename="cardgames-backup-/.test(dl.headers.get('content-disposition')));
  const file = await dl.json();
  assert.strictEqual(file.app, 'cardgames');
  assert.ok(JSON.stringify(file).includes(A));
  assert.ok(!JSON.stringify(file).includes(ta), 'no login sessions in a backup');

  // no restore while someone is playing
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  await new Promise((res) => { ws.on('message', (d) => { const m = JSON.parse(d); if (m.t === 'joined' || m.t === 'error') res(); }); ws.on('open', () => ws.send(JSON.stringify({ t: 'join', room: 'BLACKJACK-1', session: ta }))); });
  r = await call('POST', `/api/admin/backups/${first.id}/restore`, to, { confirm: 'RESTORE' });
  assert.strictEqual(r.status, 409, JSON.stringify(r.data));
  ws.send(JSON.stringify({ t: 'leave' }));
  ws.close();
  await wait(800);

  assert.strictEqual((await call('POST', `/api/admin/backups/${first.id}/restore`, to, {})).status, 400, 'must be confirmed');
  r = await call('POST', `/api/admin/backups/${first.id}/restore`, to, { confirm: 'RESTORE' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.strictEqual(r.data.signedIn, true);
  assert.strictEqual((await call('GET', '/api/me', to)).status, 200, 'the owner stays signed in');
  assert.strictEqual((await call('GET', '/api/me', ta)).status, 401, 'everyone else signs in again');
  const ta3 = (await login(A, 'newpass1')).data.token;
  assert.strictEqual((await call('GET', '/api/wallet', ta3)).data.coins, coinsBefore, 'back to the saved state');
  const list = (await call('GET', '/api/admin/backups', to)).data.backups;
  const before = list.find((b) => b.kind === 'before-restore');
  assert.ok(before && list.some((b) => b.kind === 'manual'));

  // restore from a downloaded file: undo the restore
  const undo = await (await fetch(`${BASE}/api/admin/backups/${before.id}/download`, { headers: { Authorization: 'Bearer ' + to } })).json();
  assert.strictEqual((await call('POST', '/api/admin/restore-upload', to, { confirm: 'RESTORE', backup: { app: 'other' } })).status, 400, 'not a backup');
  assert.strictEqual((await call('POST', '/api/admin/restore-upload', to, { confirm: 'RESTORE', backup: { ...undo, kind: undo.kind === 'file' ? 'postgres' : 'file' } })).status, 400, 'other database kind');
  r = await call('POST', '/api/admin/restore-upload', to, { confirm: 'RESTORE', backup: undo });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  const ta4 = (await login(A, 'newpass1')).data.token;
  assert.strictEqual((await call('GET', '/api/wallet', ta4)).data.coins, coinsBefore + 500, 'undone');

  // the site keeps working after a restore: new accounts get fresh ids
  const C = `cid_${tag}`;
  r = await call('POST', '/api/register', null, { username: C, password: 'secret123' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  assert.strictEqual((await call('GET', '/api/wallet', r.data.token)).status, 200);

  // and survives a restart
  await stop();
  await start();
  assert.strictEqual((await login(B, 'benspass')).status, 200);
  assert.ok((await call('GET', '/api/admin/backups', (await login(OWNER, 'owner123')).data.token)).data.backups.length >= 3);

  await stop();
  console.log(`account ok (${env.DATABASE_URL ? 'postgres' : 'file'})`);
  process.exit(0);
})().catch(async (e) => { console.error(e); try { await stop(); } catch {} process.exit(1); });
