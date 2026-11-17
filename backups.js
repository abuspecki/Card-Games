// Backups: a full copy of the data (everything except login sessions),
// gzip-compressed and kept in the database itself (or next to the local file).
// One is made automatically every day; the owner can make one any time,
// download it, and restore it from /admin. A restore always makes a
// "before restore" backup first, so it can be undone.
const zlib = require('zlib');

const DAY = 24 * 60 * 60 * 1000;
const KEEP = { auto: 7, manual: 10, 'before-restore': 5 };

function summarize(data) {
  const t = data.tables || {};
  if (t.file) {
    const f = t.file;
    return { users: (f.users || []).length, wallets: Object.keys(f.wallets || {}).length, feedback: (f.feedback || []).length };
  }
  return { users: (t.users || []).length, wallets: (t.wallets || []).length, feedback: (t.feedback || []).length };
}

function validate(data, kind) {
  if (!data || data.app !== 'cardgames' || !data.tables || typeof data.tables !== 'object') return 'This is not a CardGames backup file';
  if (data.kind !== kind) return `This backup was made with the ${data.kind === 'file' ? 'local test' : 'live'} database and can't be restored here`;
  const users = data.kind === 'file' ? (data.tables.file || {}).users : data.tables.users;
  if (!Array.isArray(users) || !users.length) return 'This backup contains no accounts';
  return null;
}

function createBackups(ctx) {
  const store = () => ctx.store();
  let busy = null;

  async function prune() {
    const list = await store().listBackups();
    const seen = {};
    for (const b of list) {
      seen[b.kind] = (seen[b.kind] || 0) + 1;
      if (seen[b.kind] > (KEEP[b.kind] || 5)) await store().deleteBackup(b.id);
    }
  }

  async function make(kind = 'manual') {
    const data = await store().dump();
    const text = JSON.stringify(data);
    const gz = zlib.gzipSync(text);
    const summary = summarize(data);
    const id = await store().saveBackup({ kind, size: gz.length, summary, gz });
    await prune();
    console.log(`[backup] ${kind} backup ${id}: ${summary.users} accounts, ${Math.round(gz.length / 1024)} KB`);
    return { id, kind, size: gz.length, summary };
  }

  async function read(id) {
    const gz = await store().getBackup(id);
    if (!gz) return null;
    return JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
  }

  async function restore(data) {
    const err = validate(data, store().kind);
    if (err) return { error: err };
    if (busy) return { error: 'A restore is already running' };
    busy = (async () => {
      const before = await make('before-restore');
      await store().restore(data);
      // chips that were "at a table" in the copy go back to their owners
      if (store().refundInPlay) await store().refundInPlay();
      return { ok: true, before: before.id, summary: summarize(data) };
    })();
    try { return await busy; } finally { busy = null; }
  }

  // Once a day (checked every hour, and shortly after start).
  async function daily() {
    try {
      const last = (await store().listBackups()).find((b) => b.kind === 'auto');
      if (!last || Date.now() - new Date(last.at).getTime() > DAY - 30 * 60 * 1000) await make('auto');
    } catch (e) { console.error('daily backup failed:', e.message); }
  }
  function start() {
    setTimeout(daily, 60 * 1000).unref();
    setInterval(daily, 60 * 60 * 1000).unref();
  }

  return { make, read, restore, list: () => store().listBackups(), daily, start, validate };
}

module.exports = { createBackups, summarize, validate };
