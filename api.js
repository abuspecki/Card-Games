// HTTP API: accounts, wallet & shop, friends & profiles, feedback, and the
// owner dashboard. Every request is validated here, on the server.
const crypto = require('crypto');
const { hashPassword, checkPassword, MODES, FEEDBACK_CATEGORIES, FEEDBACK_STATUSES } = require('./store');
const { CATALOG, SHOP_TABS, CONVERT_RATE, CONVERT_FLOOR, CONVERT_DAILY_MAX, BANKRUPT_GRANT, COIN_TO_CHIPS, dayString } = require('./coins');
const fb = require('./feedback');
const taskboard = require('./taskboard');

const THEMES = ['light', 'dark', 'system'];

const ONLINE_WINDOW = 70 * 1000;   // seen this recently = online
const INVITE_TTL = 10 * 60 * 1000;
const MAX_FRIENDS = 200;

function createApi(ctx) {
  // ctx: { store(), coins(), lobby, databaseError(), owners: Set(lowercase usernames) }
  const json = (res, code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (c) => { data += c; if (data.length > 20000) { reject(new Error('too large')); req.destroy(); } });
      req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('bad json')); } });
    });
  }

  // ----- rate limits -----
  const buckets = new Map();
  function limited(key, max, windowMs) {
    const now = Date.now();
    const b = buckets.get(key);
    if (!b || now > b.reset) { buckets.set(key, { count: 1, reset: now + windowMs }); return false; }
    b.count++;
    return b.count > max;
  }
  setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k); }, 60000).unref();

  const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const bearer = (req) => String(req.headers.authorization || '').replace(/^Bearer /, '');
  const isOwner = (user) => !!user && ctx.owners.has(user.username.toLowerCase());

  async function currentUser(req) {
    const token = bearer(req);
    if (!token || token.length > 200) return null;
    const user = await ctx.store().getUserBySession(token);
    if (user) {
      // Remember when we last saw them (used for "online" and activity), at most every 20s.
      const now = Date.now();
      if (now - (lastTouch.get(user.id) || 0) > 20000) {
        lastTouch.set(user.id, now);
        ctx.store().touchUser(user.id, now).catch(() => {});
      }
    }
    return user;
  }
  const lastTouch = new Map();

  async function newSession(user) {
    const token = crypto.randomBytes(32).toString('hex');
    await ctx.store().createSession(token, user.id);
    return { token, username: user.username, isOwner: isOwner(user) };
  }

  // Online if seen recently or sitting at a table with a live connection.
  function presence(userId, lastSeen) {
    const where = ctx.lobby.locate(userId);
    const online = (where && where.connected) || Date.now() - Number(lastSeen || 0) < ONLINE_WINDOW;
    return { online, where: online && where ? { table: where.table, tableName: where.tableName, game: where.game } : null };
  }

  // ----- friend invites (short-lived, kept in memory) -----
  const invites = new Map(); // userId -> [{ id, from, table, tableName, at }]
  function invitesFor(userId) {
    const list = (invites.get(userId) || []).filter((i) => Date.now() - i.at < INVITE_TTL);
    invites.set(userId, list);
    return list;
  }

  // ---------- routes ----------
  async function handle(req, res, url) {
    const store = ctx.store();
    const coins = ctx.coins();
    const ip = clientIp(req);
    const method = req.method;

    // ===== accounts =====
    if (method === 'POST' && (url === '/api/register' || url === '/api/login')) {
      if (limited(`auth:${ip}`, 15, 10 * 60 * 1000)) return json(res, 429, { error: 'Too many attempts. Try again in a few minutes.' });
      const body = await readBody(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (url === '/api/register') {
        if (!/^[A-Za-z0-9_-]{3,16}$/.test(username)) return json(res, 400, { error: 'Username: 3–16 letters, numbers, _ or -' });
        if (password.length < 6 || password.length > 100) return json(res, 400, { error: 'Password must be at least 6 characters' });
        if (limited(`register:${ip}`, 5, 60 * 60 * 1000)) return json(res, 429, { error: 'Too many new accounts from your network. Try again later.' });
        const user = await store.createUser(username, hashPassword(password));
        if (!user) return json(res, 409, { error: 'That username is taken' });
        return json(res, 200, await newSession(user));
      }
      const user = await store.getUserByName(username);
      if (!user || !checkPassword(password, user.pass)) return json(res, 401, { error: 'Wrong username or password' });
      if (user.banned) return json(res, 403, { error: `This account has been suspended${user.ban_reason ? `: ${user.ban_reason}` : ''}` });
      return json(res, 200, await newSession(user));
    }
    if (method === 'POST' && url === '/api/logout') {
      const token = bearer(req);
      if (token) await store.deleteSession(token);
      return json(res, 200, { ok: true });
    }
    if (method === 'GET' && url === '/api/me') {
      const user = await currentUser(req);
      if (!user) return json(res, 401, { error: 'Not logged in' });
      return json(res, 200, { username: user.username, isOwner: isOwner(user), theme: await store.getTheme(user.id), stats: await store.userStats(user.id) });
    }
    if (method === 'POST' && url === '/api/me/theme') {
      const user = await currentUser(req);
      if (!user) return json(res, 401, { error: 'Please sign in first' });
      const body = await readBody(req);
      if (!THEMES.includes(body.theme)) return json(res, 400, { error: 'Unknown theme' });
      await store.setTheme(user.id, body.theme);
      return json(res, 200, { ok: true });
    }

    // ===== public data =====
    if (method === 'GET' && url === '/api/leaderboard') {
      const mode = new URL(req.url, 'http://x').searchParams.get('mode');
      const m = MODES.includes(mode) ? mode : 'friends';
      return json(res, 200, { mode: m, persistent: store.kind === 'postgres', databaseError: ctx.databaseError(), rows: await store.leaderboard(m) });
    }
    if (method === 'GET' && url === '/api/tables') return json(res, 200, { tables: [...ctx.lobby.rooms.values()].map(ctx.lobby.tableSummary) });
    if (method === 'GET' && url === '/api/status') {
      return json(res, 200, {
        database: store.kind === 'postgres' ? 'connected' : (process.env.DATABASE_URL ? 'failed' : 'not configured'),
        databaseError: ctx.databaseError(),
      });
    }
    if (method === 'GET' && url === '/api/shop') {
      return json(res, 200, { items: CATALOG, slots: SHOP_TABS, rules: { convertRate: CONVERT_RATE, convertFloor: CONVERT_FLOOR, convertDailyMax: CONVERT_DAILY_MAX, bankruptGrant: BANKRUPT_GRANT, coinToChips: COIN_TO_CHIPS } });
    }
    const profileMatch = url.match(/^\/api\/players\/([A-Za-z0-9_-]{1,16})$/);
    if (method === 'GET' && profileMatch) {
      const viewer = await currentUser(req);
      const u = await store.getUserByName(profileMatch[1]);
      if (!u || u.banned) return json(res, 404, { error: 'Player not found' });
      const full = await store.getUser(u.id);
      const look = await coins.lookOf(u.id);
      let friendship = null;
      if (viewer && viewer.id !== u.id) {
        const f = await store.getFriendship(viewer.id, u.id);
        friendship = f ? (f.status === 'accepted' ? 'friends' : f.requested_by === viewer.id ? 'sent' : 'received') : 'none';
      }
      return json(res, 200, {
        username: u.username, memberSince: full.created_at, ...look,
        ...presence(u.id, full.last_seen),
        stats: await store.userStats(u.id), friends: await store.countFriends(u.id),
        isMe: !!viewer && viewer.id === u.id, friendship,
      });
    }

    // ===== feedback (guests welcome) =====
    if (method === 'POST' && url === '/api/feedback') {
      const user = await currentUser(req);
      if (limited(`fb:${ip}`, 5, 60 * 60 * 1000) || (user && limited(`fbu:${user.id}`, 15, 24 * 60 * 60 * 1000))) {
        return json(res, 429, { error: 'Thanks — you\'ve sent a lot of feedback already. Please try again later.' });
      }
      const body = await readBody(req);
      const category = FEEDBACK_CATEGORIES.includes(body.category) ? body.category : 'general';
      const message = String(body.message || '').trim();
      if (message.length < 5) return json(res, 400, { error: 'Please write a little more (at least 5 characters)' });
      if (message.length > 2000) return json(res, 400, { error: 'Please keep it under 2,000 characters' });
      const context = String(body.context || '').slice(0, 200);
      await store.addFeedback({ userId: user && user.id, username: user ? user.username : null, category, message, context });
      return json(res, 200, { ok: true });
    }

    // ===== everything below needs an account =====
    const user = await currentUser(req);
    const needsAuth = url.startsWith('/api/wallet') || url.startsWith('/api/shop/') || url.startsWith('/api/friends') || url.startsWith('/api/presence') || url.startsWith('/api/admin');
    if (needsAuth && !user) return json(res, 401, { error: 'Please sign in first' });

    // ----- wallet -----
    if (url.startsWith('/api/wallet') || url.startsWith('/api/shop/')) {
      if (method === 'GET' && url === '/api/wallet') return json(res, 200, await coins.getStatus(user.id));
      if (method !== 'POST') return json(res, 404, { error: 'Not found' });
      if (limited(`wallet:${user.id}`, 60, 60 * 1000)) return json(res, 429, { error: 'Slow down a little' });
      const body = await readBody(req);
      let r;
      if (url === '/api/wallet/daily') r = await coins.claimDaily(user.id);
      else if (url === '/api/wallet/bankrupt') r = await coins.claimBankrupt(user.id);
      else if (url === '/api/wallet/convert') r = await coins.convert(user.id, body.coins);
      else if (url === '/api/wallet/buychips') r = await coins.buyChips(user.id, body.coins);
      else if (url === '/api/shop/buy') r = await coins.buy(user.id, String(body.item || ''));
      else if (url === '/api/shop/equip') {
        r = await coins.equip(user.id, String(body.slot || ''), body.item ? String(body.item) : null);
        if (r.ok && (body.slot === 'badge' || body.slot === 'avatar')) ctx.lobby.refreshLook(user.id);
      } else return json(res, 404, { error: 'Not found' });
      if (r.error) return json(res, 400, r);
      return json(res, 200, { ...r, wallet: await coins.getStatus(user.id) });
    }

    // ----- presence: heartbeat + invites + pending requests -----
    if (url === '/api/presence') {
      const friends = await store.listFriends(user.id);
      return json(res, 200, {
        invites: invitesFor(user.id),
        requests: friends.filter((f) => f.status === 'pending' && f.requested_by !== user.id).length,
        onlineFriends: friends.filter((f) => f.status === 'accepted' && presence(f.id, f.last_seen).online).length,
      });
    }

    // ----- friends -----
    if (url.startsWith('/api/friends')) {
      if (method === 'GET' && url === '/api/friends') {
        const list = await store.listFriends(user.id);
        const out = await Promise.all(list.map(async (f) => ({
          username: f.username,
          status: f.status === 'accepted' ? 'friend' : f.requested_by === user.id ? 'sent' : 'received',
          ...(f.status === 'accepted' ? presence(f.id, f.last_seen) : { online: false, where: null }),
          avatar: (await coins.lookOf(f.id)).avatar,
        })));
        return json(res, 200, { friends: out });
      }
      if (method !== 'POST') return json(res, 404, { error: 'Not found' });
      const body = await readBody(req);
      const other = await store.getUserByName(String(body.username || ''));
      if (!other || other.banned) return json(res, 404, { error: 'No player with that name' });
      if (other.id === user.id) return json(res, 400, { error: 'That\'s you!' });
      const rel = await store.getFriendship(user.id, other.id);

      if (url === '/api/friends/request') {
        if (limited(`freq:${user.id}`, 30, 60 * 60 * 1000)) return json(res, 429, { error: 'Too many friend requests — try again later' });
        if (rel && rel.status === 'accepted') return json(res, 400, { error: `You're already friends with ${other.username}` });
        if (rel && rel.requested_by === user.id) return json(res, 400, { error: 'Request already sent' });
        if (rel && rel.requested_by === other.id) { // they asked first: accept
          await store.acceptFriend(user.id, other.id);
          return json(res, 200, { ok: true, status: 'friend' });
        }
        if ((await store.countFriends(user.id)) >= MAX_FRIENDS) return json(res, 400, { error: `You can have up to ${MAX_FRIENDS} friends` });
        await store.addFriendRequest(user.id, other.id);
        return json(res, 200, { ok: true, status: 'sent' });
      }
      if (url === '/api/friends/respond') {
        if (!rel || rel.status !== 'pending' || rel.requested_by !== other.id) return json(res, 400, { error: 'No request from that player' });
        if (body.accept) { await store.acceptFriend(user.id, other.id); return json(res, 200, { ok: true, status: 'friend' }); }
        await store.removeFriendship(user.id, other.id);
        return json(res, 200, { ok: true, status: 'none' });
      }
      if (url === '/api/friends/remove') {
        if (!rel) return json(res, 400, { error: 'You aren\'t connected with that player' });
        await store.removeFriendship(user.id, other.id);
        return json(res, 200, { ok: true, status: 'none' });
      }
      if (url === '/api/friends/invite') {
        if (!rel || rel.status !== 'accepted') return json(res, 400, { error: 'You can only invite friends' });
        const room = ctx.lobby.rooms.get(String(body.table || '').toUpperCase());
        if (!room) return json(res, 400, { error: 'Unknown table' });
        if (limited(`inv:${user.id}`, 20, 10 * 60 * 1000)) return json(res, 429, { error: 'Too many invites — try again in a few minutes' });
        const list = invitesFor(other.id).filter((i) => i.from !== user.username);
        list.push({ id: crypto.randomUUID(), from: user.username, table: room.id, tableName: room.name, game: room.game, at: Date.now() });
        invites.set(other.id, list.slice(-10));
        return json(res, 200, { ok: true });
      }
      if (url === '/api/friends/dismiss') {
        invites.set(user.id, invitesFor(user.id).filter((i) => i.id !== String(body.id || '')));
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'Not found' });
    }

    // ===== owner dashboard =====
    if (url.startsWith('/api/admin')) {
      if (!isOwner(user)) return json(res, 403, { error: 'Owners only' });
      const now = Date.now();

      if (method === 'GET' && url === '/api/admin/feedback/overview') {
        return json(res, 200, fb.analyze(await store.listFeedback(null, 5000)));
      }
      // The development board lives in GitHub Issues (see taskboard.js).
      if (method === 'GET' && url === '/api/admin/tasks') {
        try { return json(res, 200, await taskboard.board()); }
        catch (e) { return json(res, 502, { error: `Could not reach GitHub (${e.message})`, links: taskboard.links() }); }
      }
      // Feedback -> a pre-filled "new task" form on GitHub; the feedback is marked read.
      if (method === 'POST' && url === '/api/admin/feedback/totask') {
        const body = await readBody(req);
        const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Number.isInteger).slice(0, 200);
        if (!ids.length) return json(res, 400, { error: 'Choose some feedback first' });
        const all = await store.listFeedback(null, 5000);
        const chosen = all.filter((f) => ids.includes(f.id));
        if (!chosen.length) return json(res, 404, { error: 'Feedback not found' });
        const lead = fb.analyze(chosen).clusters[0];
        const beschreibung = `Aus ${chosen.length} Feedback-Nachricht${chosen.length === 1 ? '' : 'en'} (${lead.topicLabel}, ${lead.level}):\n\n`
          + chosen.map((f) => `- ${f.username || 'Gast'}: ${f.message.replace(/\s+/g, ' ')}`).join('\n');
        for (const f of chosen) if (f.status === 'new') await store.setFeedbackStatus(f.id, 'read');
        return json(res, 200, { ok: true, url: taskboard.links({ title: lead.title, beschreibung }).newTask });
      }

      if (method === 'GET' && url === '/api/admin/overview') {
        const since = dayString(now - 13 * 86400000);
        return json(res, 200, {
          totals: await store.totals(now),
          live: ctx.lobby.liveStats(),
          activity: await store.activity(since),
          database: store.kind,
        });
      }
      if (method === 'GET' && url === '/api/admin/players') {
        const sp = new URL(req.url, 'http://x').searchParams;
        const search = String(sp.get('search') || '').slice(0, 32);
        const offset = Math.max(0, Math.floor(Number(sp.get('offset')) || 0));
        const r = await store.listPlayers({ search, limit: 50, offset });
        r.players = r.players.map((p) => ({ ...p, ...presence(p.id, p.last_seen), isOwner: ctx.owners.has(p.username.toLowerCase()) }));
        return json(res, 200, r);
      }
      const pm = url.match(/^\/api\/admin\/players\/(\d+)(?:\/(ban|unban|adjust))?$/);
      if (pm) {
        const id = Number(pm[1]);
        const target = await store.getUser(id);
        if (!target) return json(res, 404, { error: 'Player not found' });
        if (method === 'GET' && !pm[2]) {
          return json(res, 200, {
            player: { ...target, ...presence(id, target.last_seen), isOwner: ctx.owners.has(target.username.toLowerCase()) },
            wallet: await coins.getStatus(id),
            stats: await store.userStats(id),
            friends: await store.countFriends(id),
          });
        }
        if (method !== 'POST') return json(res, 404, { error: 'Not found' });
        const body = await readBody(req);
        if (pm[2] === 'ban') {
          if (ctx.owners.has(target.username.toLowerCase())) return json(res, 400, { error: 'Owners can\'t be banned' });
          const reason = String(body.reason || '').trim().slice(0, 200);
          await store.setBanned(id, true, reason);
          await store.deleteUserSessions(id);
          await ctx.lobby.kick(id, `Your account has been suspended${reason ? `: ${reason}` : ''}`);
          console.log(`[admin] ${user.username} banned ${target.username}${reason ? ` (${reason})` : ''}`);
          return json(res, 200, { ok: true });
        }
        if (pm[2] === 'unban') {
          await store.setBanned(id, false, null);
          console.log(`[admin] ${user.username} unbanned ${target.username}`);
          return json(res, 200, { ok: true });
        }
        if (pm[2] === 'adjust') {
          const r = await coins.adjust(id, body.coins, body.chips);
          if (r.error) return json(res, 400, r);
          console.log(`[admin] ${user.username} adjusted ${target.username}: coins ${body.coins || 0}, chips ${body.chips || 0}`);
          return json(res, 200, { ok: true, ...r });
        }
      }
      if (method === 'GET' && url === '/api/admin/feedback') {
        const status = new URL(req.url, 'http://x').searchParams.get('status');
        return json(res, 200, { feedback: await store.listFeedback(FEEDBACK_STATUSES.includes(status) ? status : null) });
      }
      const fm = url.match(/^\/api\/admin\/feedback\/(\d+)(?:\/(delete))?$/);
      if (fm && method === 'POST') {
        const id = Number(fm[1]);
        if (fm[2] === 'delete') return json(res, (await store.removeFeedback(id)) ? 200 : 404, { ok: true });
        const body = await readBody(req);
        if (!FEEDBACK_STATUSES.includes(body.status)) return json(res, 400, { error: 'Unknown status' });
        return json(res, (await store.setFeedbackStatus(id, body.status)) ? 200 : 404, { ok: true });
      }
      return json(res, 404, { error: 'Not found' });
    }

    return json(res, 404, { error: 'Not found' });
  }

  return {
    handle: (req, res, url) => handle(req, res, url).catch((e) => {
      if (e && /too large|bad json/.test(e.message)) return json(res, 400, { error: 'Bad request' });
      console.error('api error', e);
      json(res, 500, { error: 'Server error' });
    }),
  };
}

module.exports = { createApi };
