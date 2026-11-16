// Accounts, sessions and leaderboard stats.
// Uses Postgres when DATABASE_URL is set (needed on Render, whose disk is wiped
// on every restart). Otherwise falls back to a local JSON file for development.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MODES = ['friends', 'bots'];

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
  let db = { nextId: 1, users: [], sessions: {}, stats: {} };
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

function createStore() {
  return process.env.DATABASE_URL
    ? postgresStore(process.env.DATABASE_URL)
    : fileStore(process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json'));
}

module.exports = { createStore, hashPassword, checkPassword, MODES };
