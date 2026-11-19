// Persistent data: accounts, sessions, stats, wallets (coins + chips), shop
// items, friends, feedback and activity.
// Uses Postgres when DATABASE_URL is set (needed on Render, whose disk is wiped
// on every restart). Otherwise falls back to a local JSON file for development.
// Both backends implement the same interface.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MODES = ['friends', 'bots', 'blackjack', 'durak', 'roulette', 'flamingo', 'goldrush', 'tourney', 'draw'];
const FEEDBACK_CATEGORIES = ['bug', 'suggestion', 'feature', 'general'];
const FEEDBACK_STATUSES = ['new', 'read', 'resolved'];

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

const WALLET_FIELDS = ['coins', 'chips', 'in_play', 'last_daily', 'streak', 'last_refill', 'last_bankrupt',
  'earned_day', 'earned_today', 'converted_day', 'converted_today', 'sent_day', 'sent_today'];
// Restore order: parents before the tables that point at them.
const BACKUP_TABLES = ['users', 'stats', 'wallets', 'user_items', 'equipped', 'friends', 'feedback', 'activity',
  'tasks', 'task_notes', 'dev_keys', 'meta', 'hand_log', 'quests', 'admin_log', 'error_log', 'coin_log', 'weekly'];
const pair = (x, y) => (x < y ? [x, y] : [y, x]);

// ---------- Postgres backend ----------
function postgresStore(url) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: url,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
    max: 6,
  });
  const q = (text, params) => pool.query(text, params);
  const num = (r) => Number(r) || 0;

  return {
    kind: 'postgres',
    flush() {},
    async init() {
      await q(`CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        username_key TEXT NOT NULL UNIQUE,
        pass TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await q('ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT false');
      await q('ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT');
      await q('ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen BIGINT NOT NULL DEFAULT 0');
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
      // Existing wallets receive the welcome chips when this column is added.
      await q('ALTER TABLE wallets ADD COLUMN IF NOT EXISTS chips INTEGER NOT NULL DEFAULT 5000');
      await q('ALTER TABLE wallets ADD COLUMN IF NOT EXISTS in_play INTEGER NOT NULL DEFAULT 0');
      await q('ALTER TABLE wallets ADD COLUMN IF NOT EXISTS last_bankrupt BIGINT NOT NULL DEFAULT 0');
      await q('ALTER TABLE wallets ADD COLUMN IF NOT EXISTS converted_day TEXT');
      await q('ALTER TABLE wallets ADD COLUMN IF NOT EXISTS converted_today INTEGER NOT NULL DEFAULT 0');
      await q('ALTER TABLE wallets ADD COLUMN IF NOT EXISTS sent_day TEXT');
      await q('ALTER TABLE wallets ADD COLUMN IF NOT EXISTS sent_today INTEGER NOT NULL DEFAULT 0');
      await q(`CREATE TABLE IF NOT EXISTS user_items (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL,
        PRIMARY KEY (user_id, item_id))`);
      await q(`CREATE TABLE IF NOT EXISTS equipped (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        slot TEXT NOT NULL,
        item_id TEXT NOT NULL,
        PRIMARY KEY (user_id, slot))`);
      await q(`CREATE TABLE IF NOT EXISTS friends (
        a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        requested_by INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (a, b),
        CHECK (a < b))`);
      await q(`CREATE TABLE IF NOT EXISTS feedback (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        username TEXT,
        category TEXT NOT NULL,
        message TEXT NOT NULL,
        context TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await q(`CREATE TABLE IF NOT EXISTS activity (
        day TEXT NOT NULL,
        game TEXT NOT NULL,
        hands INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, game))`);
      await q('ALTER TABLE users ADD COLUMN IF NOT EXISTS theme TEXT');
      await q('ALTER TABLE feedback ADD COLUMN IF NOT EXISTS task_id INTEGER');
      await q(`CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        priority INTEGER NOT NULL DEFAULT 3,
        status TEXT NOT NULL DEFAULT 'pending',
        category TEXT,
        source TEXT NOT NULL DEFAULT 'owner',
        created_by TEXT,
        progress INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        started_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ)`);
      await q(`CREATE TABLE IF NOT EXISTS task_notes (
        id SERIAL PRIMARY KEY,
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        author TEXT,
        kind TEXT NOT NULL DEFAULT 'note',
        text TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await q(`CREATE TABLE IF NOT EXISTS dev_keys (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        hash TEXT NOT NULL UNIQUE,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_used TIMESTAMPTZ,
        revoked BOOLEAN NOT NULL DEFAULT false)`);
      await q(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT, at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await q(`CREATE TABLE IF NOT EXISTS hand_log (
        id BIGSERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mode TEXT NOT NULL, net INTEGER NOT NULL, won BOOLEAN NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await q('CREATE INDEX IF NOT EXISTS hand_log_user ON hand_log (user_id, id DESC)');
      await q('CREATE TABLE IF NOT EXISTS quests (user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data JSONB NOT NULL)');
      await q(`CREATE TABLE IF NOT EXISTS admin_log (
        id BIGSERIAL PRIMARY KEY, by_user TEXT NOT NULL, action TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await q(`CREATE TABLE IF NOT EXISTS error_log (
        key TEXT PRIMARY KEY, source TEXT NOT NULL, message TEXT NOT NULL, stack TEXT, context TEXT,
        count INTEGER NOT NULL DEFAULT 1, first_at BIGINT NOT NULL, last_at BIGINT NOT NULL)`);
      await q('ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change BOOLEAN NOT NULL DEFAULT false');
      await q(`CREATE TABLE IF NOT EXISTS coin_log (
        id BIGSERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        coins INTEGER NOT NULL, chips INTEGER NOT NULL, reason TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await q('CREATE INDEX IF NOT EXISTS coin_log_user ON coin_log (user_id, id DESC)');
      await q(`CREATE TABLE IF NOT EXISTS weekly (
        week TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        net BIGINT NOT NULL DEFAULT 0, hands INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (week, user_id))`);
      await q(`CREATE TABLE IF NOT EXISTS backups (
        id BIGSERIAL PRIMARY KEY, kind TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now(),
        size INTEGER NOT NULL, summary JSONB, data BYTEA NOT NULL)`);
    },

    // ----- backups: every table except sessions (and the backups themselves) -----
    async dump() {
      const tables = {};
      for (const t of BACKUP_TABLES) tables[t] = (await q(`SELECT * FROM ${t}`)).rows;
      return { app: 'cardgames', version: 1, kind: 'postgres', at: new Date().toISOString(), tables };
    },
    async restore(data) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`TRUNCATE ${['sessions', ...BACKUP_TABLES].join(', ')} RESTART IDENTITY CASCADE`);
        for (const t of BACKUP_TABLES) {
          const rows = data.tables[t] || [];
          const cols = (await client.query('SELECT column_name, column_default FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1', [t])).rows;
          const known = new Set(cols.map((c) => c.column_name));
          const present = new Set();
          for (const r of rows) for (const k of Object.keys(r)) if (known.has(k)) present.add(k);
          const list = [...present].map((c) => `"${c}"`).join(', ');
          for (let i = 0; rows.length && i < rows.length; i += 1000) {
            await client.query(`INSERT INTO ${t} (${list}) SELECT ${list} FROM json_populate_recordset(NULL::${t}, $1::json)`, [JSON.stringify(rows.slice(i, i + 1000))]);
          }
          for (const c of cols.filter((x) => /^nextval/.test(x.column_default || ''))) {
            await client.query(`SELECT setval(pg_get_serial_sequence('${t}', '${c.column_name}'), COALESCE((SELECT MAX("${c.column_name}") FROM ${t}), 1), (SELECT MAX("${c.column_name}") FROM ${t}) IS NOT NULL)`);
          }
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally { client.release(); }
    },
    async saveBackup({ kind, size, summary, gz }) {
      const r = await q('INSERT INTO backups (kind, size, summary, data) VALUES ($1, $2, $3, $4) RETURNING id', [kind, size, JSON.stringify(summary), gz]);
      return String(r.rows[0].id);
    },
    async listBackups() {
      return (await q('SELECT id::text AS id, kind, at, size, summary FROM backups ORDER BY id DESC')).rows;
    },
    async getBackup(id) {
      const r = await q('SELECT data FROM backups WHERE id = $1', [Number(id) || 0]);
      return r.rows[0] ? r.rows[0].data : null;
    },
    async deleteBackup(id) { await q('DELETE FROM backups WHERE id = $1', [Number(id) || 0]); },

    // ----- passwords -----
    async setPassword(userId, pass, mustChange) {
      await q('UPDATE users SET pass = $2, must_change = $3 WHERE id = $1', [userId, pass, !!mustChange]);
    },

    // ----- error monitoring -----
    async saveError(g) {
      await q(`INSERT INTO error_log (key, source, message, stack, context, count, first_at, last_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (key) DO UPDATE SET message = $3, stack = COALESCE(NULLIF($4, ''), error_log.stack), context = COALESCE(NULLIF($5, ''), error_log.context), count = $6, last_at = $8`,
      [g.key, g.source, g.message, g.stack || '', g.context || '', g.count, g.firstAt, g.lastAt]);
    },
    async loadErrors() {
      const r = await q('SELECT * FROM error_log ORDER BY last_at DESC LIMIT 300');
      return r.rows.map((x) => ({ key: x.key, source: x.source, message: x.message, stack: x.stack || '', context: x.context || '', count: x.count, firstAt: Number(x.first_at), lastAt: Number(x.last_at) }));
    },
    async clearErrors(key) {
      if (key) await q('DELETE FROM error_log WHERE key = $1', [key]); else await q('DELETE FROM error_log');
    },

    // ----- one-time jobs: returns true the first time a key is claimed -----
    async claimOnce(key) {
      const r = await q('INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING RETURNING key', [key, 'done']);
      return r.rowCount === 1;
    },

    // ----- the piggy bank (dealer tips): add, read, and take a full load exactly once -----
    async piggyAdd(amount) {
      const r = await q(`INSERT INTO meta (key, value) VALUES ('piggy', $1) ON CONFLICT (key)
        DO UPDATE SET value = (COALESCE(NULLIF(meta.value, ''), '0')::bigint + $1::bigint)::text, at = now() RETURNING value`, [String(Math.floor(amount))]);
      return Number(r.rows[0].value);
    },
    async piggyTotal() {
      const r = await q(`SELECT value FROM meta WHERE key = 'piggy'`);
      return r.rows[0] ? Number(r.rows[0].value) || 0 : 0;
    },
    async piggyTake(goal) {
      const r = await q(`UPDATE meta SET value = (value::bigint - $1::bigint)::text, at = now() WHERE key = 'piggy' AND value::bigint >= $1::bigint RETURNING value`, [String(goal)]);
      return r.rowCount ? Number(r.rows[0].value) : null;
    },

    // ----- users & sessions -----
    async createUser(username, pass) {
      const r = await q(
        'INSERT INTO users (username, username_key, pass) VALUES ($1, $2, $3) ON CONFLICT (username_key) DO NOTHING RETURNING id, username',
        [username, username.toLowerCase(), pass],
      );
      return r.rows[0] || null;
    },
    async getUserByName(username) {
      const r = await q('SELECT id, username, pass, banned, ban_reason, must_change FROM users WHERE username_key = $1', [String(username).toLowerCase()]);
      return r.rows[0] || null;
    },
    async getUser(id) {
      const r = await q('SELECT id, username, banned, ban_reason, last_seen::float8 AS last_seen, created_at FROM users WHERE id = $1', [id]);
      return r.rows[0] || null;
    },
    async createSession(token, userId) { await q('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, userId]); },
    async getUserBySession(token) {
      const r = await q('SELECT u.id, u.username, u.must_change FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1 AND NOT u.banned', [token]);
      return r.rows[0] || null;
    },
    async deleteSession(token) { await q('DELETE FROM sessions WHERE token = $1', [token]); },
    async deleteUserSessions(userId) { await q('DELETE FROM sessions WHERE user_id = $1', [userId]); },
    async touchUser(userId, now) { await q('UPDATE users SET last_seen = $2 WHERE id = $1', [userId, now]); },
    async setBanned(userId, banned, reason) {
      await q('UPDATE users SET banned = $2, ban_reason = $3 WHERE id = $1', [userId, banned, banned ? reason || null : null]);
    },

    // ----- stats -----
    async recordHand(userId, mode, net, won, pot) {
      await q(`INSERT INTO stats (user_id, mode, hands, wins, net, biggest_pot) VALUES ($1, $2, 1, $3, $4, $5)
        ON CONFLICT (user_id, mode) DO UPDATE SET hands = stats.hands + 1, wins = stats.wins + EXCLUDED.wins,
        net = stats.net + EXCLUDED.net, biggest_pot = GREATEST(stats.biggest_pot, EXCLUDED.biggest_pot)`,
      [userId, mode, won ? 1 : 0, net, won ? pot : 0]);
      await q('INSERT INTO hand_log (user_id, mode, net, won) VALUES ($1, $2, $3, $4)', [userId, mode, Math.round(net) || 0, !!won]);
      // keep the history short: the newest 200 per player
      if (Math.random() < 0.05) await q('DELETE FROM hand_log WHERE user_id = $1 AND id < (SELECT MIN(id) FROM (SELECT id FROM hand_log WHERE user_id = $1 ORDER BY id DESC LIMIT 200) t)', [userId]);
    },
    // ----- weekly ranking -----
    async recordWeekly(week, userId, net, won) {
      await q(`INSERT INTO weekly (week, user_id, net, hands, wins) VALUES ($1, $2, $3, 1, $4)
        ON CONFLICT (week, user_id) DO UPDATE SET net = weekly.net + EXCLUDED.net, hands = weekly.hands + 1, wins = weekly.wins + EXCLUDED.wins`,
      [week, userId, Math.round(net) || 0, won ? 1 : 0]);
    },
    async weeklyBoard(week, limit = 20) {
      return (await q(`SELECT w.user_id, u.username, w.net::int AS net, w.hands, w.wins FROM weekly w JOIN users u ON u.id = w.user_id
        WHERE w.week = $1 AND NOT u.banned ORDER BY w.net DESC, w.wins DESC, w.hands ASC LIMIT $2`, [week, limit])).rows;
    },
    async weeklyOf(week, userId) {
      const r = await q(`SELECT net::int AS net, hands, wins, 1 + (SELECT COUNT(*)::int FROM weekly x JOIN users u ON u.id = x.user_id
        WHERE x.week = $1 AND NOT u.banned AND x.net > w.net) AS place FROM weekly w WHERE w.week = $1 AND w.user_id = $2`, [week, userId]);
      return r.rows[0] || null;
    },
    async coinLog(userId, limit = 60) {
      return (await q('SELECT coins, chips, reason, at FROM coin_log WHERE user_id = $1 ORDER BY id DESC LIMIT $2', [userId, limit])).rows;
    },
    async handHistory(userId, limit = 50) {
      const r = await q('SELECT mode, net, won, at FROM hand_log WHERE user_id = $1 ORDER BY id DESC LIMIT $2', [userId, limit]);
      return r.rows;
    },
    async recentHands(limit = 60) {
      const r = await q(`SELECT u.username, h.mode, h.net, h.won, h.at FROM hand_log h JOIN users u ON u.id = h.user_id ORDER BY h.id DESC LIMIT $1`, [limit]);
      return r.rows;
    },
    async allUserIds() { return (await q('SELECT id FROM users WHERE NOT banned')).rows.map((r) => r.id); },
    async getQuests(userId) { const r = await q('SELECT data FROM quests WHERE user_id = $1', [userId]); return r.rows[0] ? r.rows[0].data : null; },
    async saveQuests(userId, data) { await q('INSERT INTO quests (user_id, data) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data = $2', [userId, JSON.stringify(data)]); },
    async logAdmin(by, action) { await q('INSERT INTO admin_log (by_user, action) VALUES ($1, $2)', [by, String(action).slice(0, 300)]); },
    async adminLog(limit = 40) { return (await q('SELECT by_user, action, at FROM admin_log ORDER BY id DESC LIMIT $1', [limit])).rows; },
    // mode: one mode, or a list of modes added together (e.g. the lobby's overall ranking)
    async leaderboard(mode, limit = 50) {
      const modes = Array.isArray(mode) ? mode : [mode];
      const r = await q(`SELECT u.username, SUM(s.hands)::int AS hands, SUM(s.wins)::int AS wins, SUM(s.net)::int AS net, MAX(s.biggest_pot)::int AS biggest_pot
        FROM stats s JOIN users u ON u.id = s.user_id WHERE s.mode = ANY($1) AND s.hands > 0 AND NOT u.banned
        GROUP BY u.id, u.username ORDER BY SUM(s.net) DESC, SUM(s.wins) DESC LIMIT $2`, [modes, limit]);
      return r.rows;
    },
    async userStats(userId) {
      const r = await q('SELECT mode, hands, wins, net::int AS net, biggest_pot FROM stats WHERE user_id = $1', [userId]);
      return r.rows;
    },

    // ----- wallet -----
    // Run fn(wallet, ownedItems) with the wallet row locked, so two requests
    // can't both claim the same bonus or spend the same coins/chips.
    // fn returns { update: {field: value}, addItem, result }.
    async updateWallet(userId, init, fn) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('INSERT INTO wallets (user_id, coins, chips) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [userId, init.coins, init.chips]);
        const r = await c.query(`SELECT coins, chips, in_play, last_daily, streak, last_refill::float8 AS last_refill,
          last_bankrupt::float8 AS last_bankrupt, earned_day, earned_today, converted_day, converted_today, sent_day, sent_today
          FROM wallets WHERE user_id = $1 FOR UPDATE`, [userId]);
        const owned = await c.query('SELECT item_id FROM user_items WHERE user_id = $1', [userId]);
        const out = fn(r.rows[0], owned.rows.map((x) => x.item_id)) || {};
        if (out.update) {
          const keys = Object.keys(out.update).filter((k) => WALLET_FIELDS.includes(k));
          if (keys.length) {
            await c.query(`UPDATE wallets SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE user_id = $1`, [userId, ...keys.map((k) => out.update[k])]);
          }
        }
        if (out.addItem) await c.query('INSERT INTO user_items (user_id, item_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, out.addItem]);
        if (out.log) {
          await c.query('INSERT INTO coin_log (user_id, coins, chips, reason) VALUES ($1, $2, $3, $4)', [userId, out.log.coins, out.log.chips, String(out.log.reason).slice(0, 80)]);
          // keep the statement short: the newest 150 per player
          if (Math.random() < 0.05) await c.query('DELETE FROM coin_log WHERE user_id = $1 AND id < (SELECT MIN(id) FROM (SELECT id FROM coin_log WHERE user_id = $1 ORDER BY id DESC LIMIT 150) t)', [userId]);
        }
        await c.query('COMMIT');
        return out.result;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    // After a crash, chips that were sitting at tables go back to their owners.
    async refundInPlay() {
      const r = await q('UPDATE wallets SET chips = chips + in_play, in_play = 0 WHERE in_play > 0 RETURNING user_id');
      return r.rowCount;
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

    // ----- friends -----
    async getFriendship(x, y) {
      const [a, b] = pair(x, y);
      const r = await q('SELECT status, requested_by FROM friends WHERE a = $1 AND b = $2', [a, b]);
      return r.rows[0] || null;
    },
    async addFriendRequest(from, to) {
      const [a, b] = pair(from, to);
      await q('INSERT INTO friends (a, b, status, requested_by) VALUES ($1, $2, \'pending\', $3) ON CONFLICT DO NOTHING', [a, b, from]);
    },
    async acceptFriend(x, y) {
      const [a, b] = pair(x, y);
      await q('UPDATE friends SET status = \'accepted\' WHERE a = $1 AND b = $2', [a, b]);
    },
    async removeFriendship(x, y) {
      const [a, b] = pair(x, y);
      await q('DELETE FROM friends WHERE a = $1 AND b = $2', [a, b]);
    },
    async listFriends(userId) {
      const r = await q(`SELECT u.id, u.username, u.last_seen::float8 AS last_seen, f.status, f.requested_by
        FROM friends f JOIN users u ON u.id = CASE WHEN f.a = $1 THEN f.b ELSE f.a END
        WHERE (f.a = $1 OR f.b = $1) AND NOT u.banned ORDER BY u.username_key`, [userId]);
      return r.rows;
    },
    async countFriends(userId) {
      const r = await q('SELECT count(*)::int AS n FROM friends WHERE (a = $1 OR b = $1) AND status = \'accepted\'', [userId]);
      return r.rows[0].n;
    },

    // ----- feedback -----
    async addFeedback(f) {
      const r = await q('INSERT INTO feedback (user_id, username, category, message, context) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [f.userId || null, f.username || null, f.category, f.message, f.context || null]);
      return r.rows[0].id;
    },
    async listFeedback(status, limit = 200) {
      const r = status
        ? await q('SELECT id, username, category, message, context, status, task_id, created_at FROM feedback WHERE status = $1 ORDER BY id DESC LIMIT $2', [status, limit])
        : await q('SELECT id, username, category, message, context, status, task_id, created_at FROM feedback ORDER BY id DESC LIMIT $1', [limit]);
      return r.rows;
    },
    async setFeedbackStatus(id, status) {
      const r = await q('UPDATE feedback SET status = $2 WHERE id = $1', [id, status]);
      return r.rowCount > 0;
    },
    async removeFeedback(id) {
      const r = await q('DELETE FROM feedback WHERE id = $1', [id]);
      return r.rowCount > 0;
    },

    // ----- activity & admin -----
    async recordActivity(day, game) {
      await q('INSERT INTO activity (day, game, hands) VALUES ($1, $2, 1) ON CONFLICT (day, game) DO UPDATE SET hands = activity.hands + 1', [day, game]);
    },
    async activity(sinceDay) {
      const r = await q('SELECT day, game, hands FROM activity WHERE day >= $1 ORDER BY day', [sinceDay]);
      return r.rows;
    },
    // ----- preferences -----
    async setTheme(userId, theme) { await q('UPDATE users SET theme = $2 WHERE id = $1', [userId, theme]); },
    async getTheme(userId) { const r = await q('SELECT theme FROM users WHERE id = $1', [userId]); return r.rows[0] ? r.rows[0].theme : null; },


    async listPlayers({ search = '', limit = 50, offset = 0 } = {}) {
      const like = `%${String(search).toLowerCase().replace(/[%_\\]/g, '\\$&')}%`;
      const rows = await q(`SELECT u.id, u.username, u.created_at, u.last_seen::float8 AS last_seen, u.banned, u.ban_reason,
          COALESCE(w.coins, 0) AS coins, COALESCE(w.chips, 0) AS chips, COALESCE(w.in_play, 0) AS in_play,
          COALESCE((SELECT sum(hands) FROM stats s WHERE s.user_id = u.id), 0)::int AS hands,
          COALESCE((SELECT sum(wins) FROM stats s WHERE s.user_id = u.id), 0)::int AS wins
        FROM users u LEFT JOIN wallets w ON w.user_id = u.id
        WHERE u.username_key LIKE $1 ORDER BY u.last_seen DESC, u.id DESC LIMIT $2 OFFSET $3`, [like, limit, offset]);
      const total = await q('SELECT count(*)::int AS n FROM users WHERE username_key LIKE $1', [like]);
      return { players: rows.rows, total: total.rows[0].n };
    },
    // Economy: where coins and chips came from and went (last days), and the richest players.
    async economy(days = 7) {
      const flows = (await q(`SELECT split_part(reason, ':', 1) AS kind, COALESCE(sum(coins), 0)::float8 AS coins, COALESCE(sum(chips), 0)::float8 AS chips, count(*)::int AS n
        FROM coin_log WHERE at > now() - ($1 || ' days')::interval GROUP BY 1 ORDER BY 1`, [String(days)])).rows;
      const richest = (await q(`SELECT u.username, (w.chips + w.in_play)::float8 AS chips, w.coins::float8 AS coins FROM wallets w JOIN users u ON u.id = w.user_id
        WHERE NOT u.banned ORDER BY w.chips + w.in_play DESC LIMIT 5`)).rows;
      return { flows: flows.map((f) => ({ kind: f.kind, coins: num(f.coins), chips: num(f.chips), n: f.n })), richest: richest.map((x) => ({ username: x.username, chips: num(x.chips), coins: num(x.coins) })) };
    },
    async totals(now) {
      const r = await q(`SELECT
          (SELECT count(*) FROM users)::int AS players,
          (SELECT count(*) FROM users WHERE banned)::int AS banned,
          (SELECT count(*) FROM users WHERE last_seen > $1)::int AS active_day,
          (SELECT count(*) FROM users WHERE created_at > now() - interval '7 days')::int AS new_week,
          (SELECT COALESCE(sum(coins), 0) FROM wallets)::float8 AS coins,
          (SELECT COALESCE(sum(chips), 0) FROM wallets)::float8 AS chips,
          (SELECT COALESCE(sum(in_play), 0) FROM wallets)::float8 AS in_play,
          (SELECT count(*) FROM feedback WHERE status = 'new')::int AS feedback_new,
          (SELECT COALESCE(sum(hands), 0) FROM stats)::float8 AS hands_total`, [now - 86400000]);
      const t = r.rows[0];
      for (const k of Object.keys(t)) t[k] = num(t[k]);
      return t;
    },
  };
}

// ---------- JSON file backend (local development) ----------
function fileStore(file) {
  let db = null;
  let saveTimer = null;
  const writeNow = () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(db));
    fs.renameSync(file + '.tmp', file);
  };
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(writeNow, 200);
  };
  const statKey = (id, mode) => `${id}:${mode}`;
  const backupDir = path.join(path.dirname(file), `${path.basename(file, '.json')}-backups`);
  let seq = 0;
  const userById = (id) => db.users.find((u) => u.id === id);
  const freshWallet = (init) => ({ coins: init.coins, chips: init.chips, in_play: 0, last_daily: null, streak: 0, last_refill: 0,
    last_bankrupt: 0, earned_day: null, earned_today: 0, converted_day: null, converted_today: 0, sent_day: null, sent_today: 0 });

  return {
    kind: 'file',
    flush() { if (db) writeNow(); },
    async init() {
      try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { db = null; }
      db = { nextId: 1, users: [], sessions: {}, stats: {}, wallets: {}, items: {}, equipped: {},
        friends: {}, feedback: [], nextFeedback: 1, activity: {}, tasks: [], nextTask: 1, notes: [], nextNote: 1,
        devKeys: [], nextKey: 1, themes: {}, ...(db || {}) };
      for (const w of Object.values(db.wallets)) {
        if (w.chips === undefined) w.chips = 5000;
        Object.assign(w, { ...freshWallet({ coins: w.coins, chips: w.chips }), ...w });
      }
      for (const u of db.users) { u.banned = !!u.banned; u.last_seen = u.last_seen || 0; u.created_at = u.created_at || new Date().toISOString(); }
    },

    // ----- users & sessions -----
    async createUser(username, pass) {
      if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) return null;
      const u = { id: db.nextId++, username, pass, banned: false, ban_reason: null, last_seen: 0, created_at: new Date().toISOString() };
      db.users.push(u);
      save();
      return { id: u.id, username };
    },
    async getUserByName(username) {
      return db.users.find((u) => u.username.toLowerCase() === String(username).toLowerCase()) || null;
    },
    async getUser(id) {
      const u = userById(id);
      return u ? { id: u.id, username: u.username, banned: u.banned, ban_reason: u.ban_reason, last_seen: u.last_seen, created_at: u.created_at } : null;
    },
    async createSession(token, userId) { db.sessions[token] = userId; save(); },
    async getUserBySession(token) {
      const u = userById(db.sessions[token]);
      return u && !u.banned ? { id: u.id, username: u.username, must_change: !!u.must_change } : null;
    },
    async deleteSession(token) { delete db.sessions[token]; save(); },
    async deleteUserSessions(userId) {
      for (const [t, id] of Object.entries(db.sessions)) if (id === userId) delete db.sessions[t];
      save();
    },
    async touchUser(userId, now) { const u = userById(userId); if (u) { u.last_seen = now; save(); } },
    async setPassword(userId, pass, mustChange) { const u = userById(userId); if (u) { u.pass = pass; u.must_change = !!mustChange; save(); } },

    // ----- backups: the whole file except sessions, kept as .json.gz next to it -----
    async dump() {
      const copy = JSON.parse(JSON.stringify(db));
      copy.sessions = {};
      return { app: 'cardgames', version: 1, kind: 'file', at: new Date().toISOString(), tables: { file: copy } };
    },
    async restore(data) {
      const next = JSON.parse(JSON.stringify(data.tables.file));
      db = { ...db, ...next, sessions: {} };
      writeNow();
    },
    async saveBackup({ kind, size, summary, gz }) {
      fs.mkdirSync(backupDir, { recursive: true });
      const id = String(Date.now() + (seq++ % 1000));
      fs.writeFileSync(path.join(backupDir, `${id}.json.gz`), gz);
      fs.writeFileSync(path.join(backupDir, `${id}.meta.json`), JSON.stringify({ id, kind, at: new Date().toISOString(), size, summary }));
      return id;
    },
    async listBackups() {
      let names = [];
      try { names = fs.readdirSync(backupDir).filter((n) => n.endsWith('.meta.json')); } catch { return []; }
      return names.map((n) => { try { return JSON.parse(fs.readFileSync(path.join(backupDir, n), 'utf8')); } catch { return null; } })
        .filter(Boolean).sort((a, b) => Number(b.id) - Number(a.id));
    },
    async getBackup(id) {
      if (!/^\d+$/.test(String(id))) return null;
      try { return fs.readFileSync(path.join(backupDir, `${id}.json.gz`)); } catch { return null; }
    },
    async deleteBackup(id) {
      if (!/^\d+$/.test(String(id))) return;
      for (const n of [`${id}.json.gz`, `${id}.meta.json`]) { try { fs.unlinkSync(path.join(backupDir, n)); } catch {} }
    },
    async setBanned(userId, banned, reason) {
      const u = userById(userId);
      if (u) { u.banned = banned; u.ban_reason = banned ? reason || null : null; save(); }
    },

    // ----- stats -----
    async recordHand(userId, mode, net, won, pot) {
      const k = statKey(userId, mode);
      const s = db.stats[k] || (db.stats[k] = { hands: 0, wins: 0, net: 0, biggest_pot: 0 });
      s.hands++; s.net += net;
      if (won) { s.wins++; s.biggest_pot = Math.max(s.biggest_pot, pot); }
      db.handLog = db.handLog || [];
      db.handLog.push({ user_id: userId, mode, net: Math.round(net) || 0, won: !!won, at: new Date().toISOString() });
      if (db.handLog.length > 5000) db.handLog = db.handLog.slice(-4000);
      save();
    },
    async handHistory(userId, limit = 50) {
      return (db.handLog || []).filter((h) => h.user_id === userId).slice(-limit).reverse().map(({ user_id, ...h }) => h);
    },
    async recentHands(limit = 60) {
      return (db.handLog || []).slice(-limit).reverse().map(({ user_id, ...h }) => ({ username: (userById(user_id) || {}).username || '?', ...h }));
    },
    async allUserIds() { return db.users.filter((u) => !u.banned).map((u) => u.id); },
    async getQuests(userId) { return (db.quests || {})[userId] ? JSON.parse(JSON.stringify(db.quests[userId])) : null; },
    async saveQuests(userId, data) { db.quests = db.quests || {}; db.quests[userId] = JSON.parse(JSON.stringify(data)); save(); },
    async logAdmin(by, action) { db.adminLog = db.adminLog || []; db.adminLog.push({ by_user: by, action: String(action).slice(0, 300), at: new Date().toISOString() }); if (db.adminLog.length > 500) db.adminLog.shift(); save(); },
    async adminLog(limit = 40) { return (db.adminLog || []).slice(-limit).reverse(); },
    async leaderboard(mode, limit = 50) {
      const modes = Array.isArray(mode) ? mode : [mode];
      return db.users.filter((u) => !u.banned)
        .map((u) => modes.map((m) => db.stats[statKey(u.id, m)]).filter(Boolean).reduce((a, x) => ({
          username: u.username, hands: a.hands + x.hands, wins: a.wins + x.wins, net: a.net + x.net, biggest_pot: Math.max(a.biggest_pot, x.biggest_pot || 0),
        }), { username: u.username, hands: 0, wins: 0, net: 0, biggest_pot: 0 }))
        .filter((r) => r.hands > 0)
        .sort((a, b) => b.net - a.net || b.wins - a.wins)
        .slice(0, limit);
    },
    async userStats(userId) {
      return MODES.filter((m) => db.stats[statKey(userId, m)]).map((m) => ({ mode: m, ...db.stats[statKey(userId, m)] }));
    },

    // ----- wallet -----
    async updateWallet(userId, init, fn) {
      const w = db.wallets[userId] || (db.wallets[userId] = freshWallet(init));
      const out = fn({ ...w }, (db.items[userId] || []).slice()) || {};
      if (out.update) for (const k of Object.keys(out.update)) if (WALLET_FIELDS.includes(k)) w[k] = out.update[k];
      if (out.addItem) {
        const list = db.items[userId] || (db.items[userId] = []);
        if (!list.includes(out.addItem)) list.push(out.addItem);
      }
      if (out.log) {
        db.coinLog = db.coinLog || [];
        db.coinLog.push({ user_id: userId, coins: out.log.coins, chips: out.log.chips, reason: String(out.log.reason).slice(0, 80), at: new Date().toISOString() });
        if (db.coinLog.length > 20000) db.coinLog = db.coinLog.slice(-15000);
      }
      save();
      return out.result;
    },
    async recordWeekly(week, userId, net, won) {
      db.weekly = db.weekly || {};
      const w = db.weekly[week] || (db.weekly[week] = {});
      const e = w[userId] || (w[userId] = { net: 0, hands: 0, wins: 0 });
      e.net += Math.round(net) || 0; e.hands++; if (won) e.wins++;
      const weeks = Object.keys(db.weekly).sort();
      while (weeks.length > 10) delete db.weekly[weeks.shift()];
      save();
    },
    async weeklyBoard(week, limit = 20) {
      const w = (db.weekly || {})[week] || {};
      return Object.entries(w).map(([id, e]) => ({ user_id: Number(id), username: (userById(Number(id)) || {}).username, banned: (userById(Number(id)) || {}).banned, ...e }))
        .filter((e) => e.username && !e.banned).sort((a, b) => b.net - a.net || b.wins - a.wins || a.hands - b.hands).slice(0, limit)
        .map(({ banned, ...e }) => e);
    },
    async weeklyOf(week, userId) {
      const all = await this.weeklyBoard(week, 1e6);
      const i = all.findIndex((e) => e.user_id === userId);
      if (i === -1) return null;
      const better = all.filter((e) => e.net > all[i].net).length;
      return { net: all[i].net, hands: all[i].hands, wins: all[i].wins, place: better + 1 };
    },
    async coinLog(userId, limit = 60) {
      return (db.coinLog || []).filter((e) => e.user_id === userId).slice(-limit).reverse().map(({ user_id, ...e }) => e);
    },
    async saveError(g) { db.errors = db.errors || {}; db.errors[g.key] = { ...g }; save(); },
    async loadErrors() { return Object.values(db.errors || {}); },
    async clearErrors(key) { db.errors = db.errors || {}; if (key) delete db.errors[key]; else db.errors = {}; save(); },
    async claimOnce(key) {
      db.meta = db.meta || {};
      if (db.meta[key]) return false;
      db.meta[key] = Date.now();
      save();
      return true;
    },
    async piggyAdd(amount) { db.piggy = (db.piggy || 0) + Math.floor(amount); save(); return db.piggy; },
    async piggyTotal() { return db.piggy || 0; },
    async piggyTake(goal) { if ((db.piggy || 0) < goal) return null; db.piggy -= goal; save(); return db.piggy; },
    async refundInPlay() {
      let n = 0;
      for (const w of Object.values(db.wallets)) if (w.in_play > 0) { w.chips += w.in_play; w.in_play = 0; n++; }
      save();
      return n;
    },
    async getItems(userId) {
      const eq = Object.fromEntries(Object.entries(db.equipped[userId] || {}).filter(([, v]) => v));
      return { owned: (db.items[userId] || []).slice(), equipped: eq };
    },
    async setEquipped(userId, slot, itemId) {
      const e = db.equipped[userId] || (db.equipped[userId] = {});
      if (itemId) e[slot] = itemId; else e[slot] = null;
      save();
    },

    // ----- friends -----
    async getFriendship(x, y) { const f = db.friends[pair(x, y).join(':')]; return f ? { status: f.status, requested_by: f.requested_by } : null; },
    async addFriendRequest(from, to) {
      const k = pair(from, to).join(':');
      if (!db.friends[k]) db.friends[k] = { status: 'pending', requested_by: from };
      save();
    },
    async acceptFriend(x, y) { const f = db.friends[pair(x, y).join(':')]; if (f) { f.status = 'accepted'; save(); } },
    async removeFriendship(x, y) { delete db.friends[pair(x, y).join(':')]; save(); },
    async listFriends(userId) {
      const out = [];
      for (const [k, f] of Object.entries(db.friends)) {
        const [a, b] = k.split(':').map(Number);
        if (a !== userId && b !== userId) continue;
        const o = userById(a === userId ? b : a);
        if (o && !o.banned) out.push({ id: o.id, username: o.username, last_seen: o.last_seen, status: f.status, requested_by: f.requested_by });
      }
      return out.sort((x, y) => x.username.toLowerCase().localeCompare(y.username.toLowerCase()));
    },
    async countFriends(userId) { return (await this.listFriends(userId)).filter((f) => f.status === 'accepted').length; },

    // ----- feedback -----
    async addFeedback(f) {
      const id = db.nextFeedback++;
      db.feedback.push({ id, user_id: f.userId || null, username: f.username || null, category: f.category, message: f.message,
        context: f.context || null, status: 'new', task_id: null, created_at: new Date().toISOString() });
      save();
      return id;
    },
    async listFeedback(status, limit = 200) {
      return db.feedback.filter((f) => !status || f.status === status).slice(-limit).reverse()
        .map(({ user_id, ...rest }) => rest);
    },
    async setFeedbackStatus(id, status) {
      const f = db.feedback.find((x) => x.id === id);
      if (f) { f.status = status; save(); }
      return !!f;
    },
    async removeFeedback(id) {
      const before = db.feedback.length;
      db.feedback = db.feedback.filter((x) => x.id !== id);
      save();
      return db.feedback.length < before;
    },

    // ----- activity & admin -----
    async recordActivity(day, game) {
      const k = `${day}|${game}`;
      db.activity[k] = (db.activity[k] || 0) + 1;
      save();
    },
    async activity(sinceDay) {
      return Object.entries(db.activity).map(([k, hands]) => { const [day, game] = k.split('|'); return { day, game, hands }; })
        .filter((r) => r.day >= sinceDay).sort((a, b) => a.day.localeCompare(b.day));
    },
    // ----- preferences -----
    async setTheme(userId, theme) { db.themes[userId] = theme; save(); },
    async getTheme(userId) { return db.themes[userId] || null; },


    async listPlayers({ search = '', limit = 50, offset = 0 } = {}) {
      const s = String(search).toLowerCase();
      const all = db.users.filter((u) => u.username.toLowerCase().includes(s)).map((u) => {
        const w = db.wallets[u.id] || {};
        const st = MODES.map((m) => db.stats[statKey(u.id, m)]).filter(Boolean);
        return { id: u.id, username: u.username, created_at: u.created_at, last_seen: u.last_seen, banned: u.banned, ban_reason: u.ban_reason,
          coins: w.coins || 0, chips: w.chips || 0, in_play: w.in_play || 0,
          hands: st.reduce((a, x) => a + x.hands, 0), wins: st.reduce((a, x) => a + x.wins, 0) };
      }).sort((a, b) => b.last_seen - a.last_seen || b.id - a.id);
      return { players: all.slice(offset, offset + limit), total: all.length };
    },
    async economy(days = 7) {
      const since = Date.now() - days * 86400000;
      const by = {};
      for (const e of db.coinLog || []) {
        if (Date.parse(e.at) < since) continue;
        const k = String(e.reason).split(':')[0];
        const f = by[k] || (by[k] = { kind: k, coins: 0, chips: 0, n: 0 });
        f.coins += e.coins; f.chips += e.chips; f.n++;
      }
      const richest = db.users.filter((u) => !u.banned && db.wallets[u.id]).map((u) => ({ username: u.username, chips: db.wallets[u.id].chips + db.wallets[u.id].in_play, coins: db.wallets[u.id].coins }))
        .sort((a, b) => b.chips - a.chips).slice(0, 5);
      return { flows: Object.values(by).sort((a, b) => a.kind.localeCompare(b.kind)), richest };
    },
    async totals(now) {
      const ws = Object.values(db.wallets);
      const sum = (f) => ws.reduce((a, w) => a + (w[f] || 0), 0);
      const weekAgo = Date.now() - 7 * 86400000;
      return {
        players: db.users.length,
        banned: db.users.filter((u) => u.banned).length,
        active_day: db.users.filter((u) => u.last_seen > now - 86400000).length,
        new_week: db.users.filter((u) => new Date(u.created_at).getTime() > weekAgo).length,
        coins: sum('coins'), chips: sum('chips'), in_play: sum('in_play'),
        feedback_new: db.feedback.filter((f) => f.status === 'new').length,
        hands_total: Object.values(db.stats).reduce((a, s) => a + s.hands, 0),
      };
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

module.exports = { BACKUP_TABLES, openStore, hashPassword, checkPassword, MODES, FEEDBACK_CATEGORIES, FEEDBACK_STATUSES, safeError };
