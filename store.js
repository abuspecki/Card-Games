// Accounts, sessions and leaderboard stats.
// Uses Postgres when DATABASE_URL is set (needed on Render, whose disk is wiped
// on every restart). Otherwise falls back to a local JSON file for development.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MODES = ['friends', 'bots', 'blackjack', 'durak'];

// ---------- password hashing (scrypt, built into Node) ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function checkPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const real = Buffer.from(hash, 'hex');
  return real.length === test.length && crypto.timingSafeEqual(real, test);
}

// ---------- Postgres backend ----------
function postgresStore(url) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: url,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
    max: 5,
  });
  const q = (text, params) => pool.query(text, params);
  return {
    kind: 'postgres',
    async init() {
      await q(`CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        username_key TEXT NOT NULL UNIQUE,
        pass TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await q(`CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await q(`CREATE TABLE IF NOT EXISTS stats (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mode TEXT NOT NULL,
        hands INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        net BIGINT NOT NULL DEFAULT 0,
        biggest_pot INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, mode))`);
      await q(`CREATE TABLE IF NOT EXISTS wallets (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        coins INTEGER NOT NULL DEFAULT 0,
        last_daily TEXT,
        streak INTEGER NOT NULL DEFAULT 0,
        last_refill BIGINT NOT NULL DEFAULT 0,
        earned_day TEXT,
        earned_today INTEGER NOT NULL DEFAULT 0)`);
      await q(`CREATE TABLE IF NOT EXISTS user_items (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL,
        PRIMARY KEY (user_id, item_id))`);
      await q(`CREATE TABLE IF NOT EXISTS equipped (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        slot TEXT NOT NULL,
        item_id TEXT NOT NULL,
        PRIMARY KEY (user_id, slot))`);
    },
    // Run fn(wallet) with the wallet row locked, so two requests can't both
    // claim the same bonus or spend the same coins. fn returns
    // { update: {field: value}, addItem, result }.
    async updateWallet(userId, welcome, fn) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('INSERT INTO wallets (user_id, coins) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, welcome]);
        const r = await c.query('SELECT coins, last_daily, streak, last_refill::float8 AS last_refill, earned_day, earned_today FROM wallets WHERE user_id = $1 FOR UPDATE', [userId]);
        const owned = await c.query('SELECT item_id FROM user_items WHERE user_id = $1', [userId]);
        const out = fn(r.rows[0], owned.rows.map((x) => x.item_id)) || {};
        if (out.update && Object.keys(out.update).length) {
          const keys = Object.keys(out.update);
          await c.query(`UPDATE wallets SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE user_id = $1`, [userId, ...keys.map((k) => out.update[k])]);
        }
        if (out.addItem) await c.query('INSERT INTO user_items (user_id, item_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, out.addItem]);
        await c.query('COMMIT');
        return out.result;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    async getItems(userId) {
      const owned = await q('SELECT item_id FROM user_items WHERE user_id = $1', [userId]);
      const eq = await q('SELECT slot, item_id FROM equipped WHERE user_id = $1', [userId]);
      return { owned: owned.rows.map((r) => r.item_id), equipped: Object.fromEntries(eq.rows.map((r) => [r.slot, r.item_id])) };
    },
    async setEquipped(userId, slot, itemId) {
      if (!itemId) await q('DELETE FROM equipped WHERE user_id = $1 AND slot = $2', [userId, slot]);
      else await q('INSERT INTO equipped (user_id, slot, item_id) VALUES ($1, $2, $3) ON CONFLICT (user_id, slot) DO UPDATE SET item_id = EXCLUDED.item_id', [userId, slot, itemId]);
    },
    async createUser(username, pass) {
      const r = await q(
        'INSERT INTO users (username, username_key, pass) VALUES ($1, $2, $3) ON CONFLICT (username_key) DO NOTHING RETURNING id, username',
        [username, username.toLowerCase(), pass],
      );
      return r.rows[0] || null;
    },
    async getUserByName(username) {
      const r = await q('SELECT id, username, pass FROM users WHERE username_key = $1', [username.toLowerCase()]);
      return r.rows[0] || null;
    },
    async createSession(token, userId) { await q('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, userId]); },
    async getUserBySession(token) {
      const r = await q('SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1', [token]);
      return r.rows[0] || null;
    },
    async deleteSession(token) { await q('DELETE FROM sessions WHERE token = $1', [token]); },
    async recordHand(userId, mode, net, won, pot) {
      await q(`INSERT INTO stats (user_id, mode, hands, wins, net, biggest_pot) VALUES ($1, $2, 1, $3, $4, $5)
        ON CONFLICT (user_id, mode) DO UPDATE SET hands = stats.hands + 1, wins = stats.wins + EXCLUDED.wins,
        net = stats.net + EXCLUDED.net, biggest_pot = GREATEST(stats.biggest_pot, EXCLUDED.biggest_pot)`,
      [userId, mode, won ? 1 : 0, net, won ? pot : 0]);
    },
    async leaderboard(mode, limit = 50) {
      const r = await q(`SELECT u.username, s.hands, s.wins, s.net::int AS net, s.biggest_pot
        FROM stats s JOIN users u ON u.id = s.user_id WHERE s.mode = $1 AND s.hands > 0
        ORDER BY s.net DESC, s.wins DESC LIMIT $2`, [mode, limit]);
      return r.rows;
    },
    async userStats(userId) {
      const r = await q('SELECT mode, hands, wins, net::int AS net, biggest_pot FROM stats WHERE user_id = $1', [userId]);
      return r.rows;
    },
  };
}

// ---------- JSON file backend (local development) ----------
function fileStore(file) {
  let db = { nextId: 1, users: [], sessions: {}, stats: {}, wallets: {}, items: {}, equipped: {} };
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(db));
      fs.renameSync(file + '.tmp', file);
    }, 200);
  };
  const statKey = (id, mode) => `${id}:${mode}`;
  return {
    kind: 'file',
    async init() {
      try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* new database */ }
      db.wallets = db.wallets || {};
      db.items = db.items || {};
      db.equipped = db.equipped || {};
    },
    async updateWallet(userId, welcome, fn) {
      const w = db.wallets[userId] || (db.wallets[userId] = { coins: welcome, last_daily: null, streak: 0, last_refill: 0, earned_day: null, earned_today: 0 });
      const out = fn({ ...w }, (db.items[userId] || []).slice()) || {};
      if (out.update) Object.assign(w, out.update);
      if (out.addItem) {
        const list = db.items[userId] || (db.items[userId] = []);
        if (!list.includes(out.addItem)) list.push(out.addItem);
      }
      save();
      return out.result;
    },
    async getItems(userId) {
      return { owned: (db.items[userId] || []).slice(), equipped: { ...(db.equipped[userId] || {}) } };
    },
    async setEquipped(userId, slot, itemId) {
      const e = db.equipped[userId] || (db.equipped[userId] = {});
      if (itemId) e[slot] = itemId;
      else e[slot] = undefined;
      save();
    },
    async createUser(username, pass) {
      if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) return null;
      const u = { id: db.nextId++, username, pass };
      db.users.push(u);
      save();
      return { id: u.id, username };
    },
    async getUserByName(username) {
      return db.users.find((u) => u.username.toLowerCase() === username.toLowerCase()) || null;
    },
    async createSession(token, userId) { db.sessions[token] = userId; save(); },
    async getUserBySession(token) {
      const id = db.sessions[token];
      const u = id && db.users.find((x) => x.id === id);
      return u ? { id: u.id, username: u.username } : null;
    },
    async deleteSession(token) { delete db.sessions[token]; save(); },
    async recordHand(userId, mode, net, won, pot) {
      const k = statKey(userId, mode);
      const s = db.stats[k] || (db.stats[k] = { hands: 0, wins: 0, net: 0, biggest_pot: 0 });
      s.hands++; s.net += net;
      if (won) { s.wins++; s.biggest_pot = Math.max(s.biggest_pot, pot); }
      save();
    },
    async leaderboard(mode, limit = 50) {
      return db.users
        .map((u) => ({ username: u.username, ...(db.stats[statKey(u.id, mode)] || { hands: 0 }) }))
        .filter((r) => r.hands > 0)
        .sort((a, b) => b.net - a.net || b.wins - a.wins)
        .slice(0, limit);
    },
    async userStats(userId) {
      return MODES.filter((m) => db.stats[statKey(userId, m)]).map((m) => ({ mode: m, ...db.stats[statKey(userId, m)] }));
    },
  };
}

const localFile = () => fileStore(process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json'));

// Remove anything that could reveal credentials from an error message.
function safeError(e) {
  return String((e && (e.code ? `${e.code}: ${e.message}` : e.message)) || e)
    .replace(/postgres(ql)?:\/\/\S+/gi, '[connection string]')
    .replace(/npg_[A-Za-z0-9]+/g, '[secret]')
    .slice(0, 300);
}

// Open the database. If Postgres can't be reached, keep the game running on
// the local file instead of crashing, and remember why for the status check.
async function openStore() {
  // Accept a pasted snippet like  psql 'postgresql://…'  or  DATABASE_URL="postgresql://…"
  const raw = (process.env.DATABASE_URL || '').trim();
  const match = raw.match(/postgres(?:ql)?:\/\/[^\s'"`]+/i);
  const url = match ? match[0] : raw;
  if (!url) {
    const s = localFile();
    await s.init();
    return { store: s, error: null };
  }
  try {
    const s = postgresStore(url);
    await s.init();
    return { store: s, error: null };
  } catch (e) {
    const error = safeError(e);
    console.error('Could not open the database, running in test mode instead:', error);
    const s = localFile();
    await s.init();
    return { store: s, error };
  }
}

module.exports = { openStore, hashPassword, checkPassword, MODES, safeError };
