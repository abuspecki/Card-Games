// Daily quests and achievements.
//
// Every recorded result (a hand, a spin, a game of Durak or Flamingo, a Gold
// Rush dig) is passed to onResult(). Three quests a day (the same three for
// everyone, picked from a pool by the date) and one-time achievements pay
// coins automatically when completed; the player is told on their next
// presence poll (news) and sees everything in the lounge.
const { dayString } = require('./coins');

const CHIP_GAMES = ['friends', 'bots', 'blackjack', 'roulette', 'goldrush'];
const CARD_GAMES = ['friends', 'bots', 'blackjack', 'durak', 'flamingo'];

// q.count(result) -> how much this result advances the quest
const POOL = [
  { id: 'play10', text: 'Play 10 rounds of any game', goal: 10, reward: 30, count: () => 1 },
  { id: 'win3', text: 'Win 3 rounds of any game', goal: 3, reward: 50, count: (r) => (r.won ? 1 : 0) },
  { id: 'variety3', text: 'Play 3 different games', goal: 3, reward: 50, count: (r, d) => (d.modesToday.includes(gameOf(r.mode)) ? 0 : 1), track: true },
  { id: 'bj2', text: 'Win 2 hands of Blackjack', goal: 2, reward: 40, count: (r) => (r.mode === 'blackjack' && r.won ? 1 : 0) },
  { id: 'poker5', text: "Play 5 hands of Hold'em", goal: 5, reward: 30, count: (r) => (r.mode === 'friends' || r.mode === 'bots' ? 1 : 0) },
  { id: 'roulette5', text: 'Play 5 spins of Roulette', goal: 5, reward: 30, count: (r) => (r.mode === 'roulette' ? 1 : 0) },
  { id: 'flamingo1', text: 'Win a game of Flamingo', goal: 1, reward: 60, count: (r) => (r.mode === 'flamingo' && r.won ? 1 : 0) },
  { id: 'durak1', text: 'Escape a game of Durak', goal: 1, reward: 50, count: (r) => (r.mode === 'durak' && r.won ? 1 : 0) },
  { id: 'gold50', text: 'Reach 50 m in Gold Rush and cash out', goal: 1, reward: 50, count: (r) => (r.mode === 'goldrush' && r.won && (r.depth || 0) >= 5 ? 1 : 0) },
  { id: 'chips500', text: 'Win 500 chips today', goal: 500, reward: 80, count: (r) => (CHIP_GAMES.includes(r.mode) && r.net > 0 ? r.net : 0) },
  { id: 'friends3', text: "Play 3 hands of Hold'em with real people", goal: 3, reward: 50, count: (r) => (r.mode === 'friends' ? 1 : 0) },
];

const ACHIEVEMENTS = [
  { id: 'first-win', text: 'First win', desc: 'Win your first round', reward: 50, check: (c) => c.wins >= 1 },
  { id: 'hands-100', text: 'Regular', desc: 'Play 100 rounds', reward: 100, check: (c) => c.hands >= 100 },
  { id: 'hands-1000', text: 'Part of the furniture', desc: 'Play 1,000 rounds', reward: 500, check: (c) => c.hands >= 1000 },
  { id: 'pot-1000', text: 'Big pot', desc: 'Win 1,000 chips or more in one round', reward: 150, check: (c) => c.biggestWin >= 1000 },
  { id: 'won-10000', text: 'High earner', desc: 'Win 10,000 chips in total', reward: 300, check: (c) => c.chipsWon >= 10000 },
  { id: 'all-games', text: 'All-rounder', desc: 'Play every game at least once', reward: 200, check: (c) => ['holdem', 'blackjack', 'roulette', 'durak', 'flamingo', 'goldrush'].every((g) => c.games.includes(g)) },
  { id: 'flamingo-10', text: 'Flamingo master', desc: 'Win 10 games of Flamingo', reward: 200, check: (c) => (c.byMode.flamingo || 0) >= 10 },
  { id: 'durak-10', text: 'Never the fool', desc: 'Escape 10 games of Durak', reward: 200, check: (c) => (c.byMode.durak || 0) >= 10 },
  { id: 'gold-100', text: 'Deep digger', desc: 'Cash out at 100 m in Gold Rush', reward: 200, check: (c) => c.deepest >= 10 },
  { id: 'streak-7', text: 'Every day', desc: 'Collect the daily bonus 7 days in a row', reward: 150, check: (c) => c.streak >= 7 },
];

const gameOf = (mode) => (mode === 'friends' || mode === 'bots' ? 'holdem' : mode);

// The three quests of a day: the same for everybody, different every day.
function questsFor(day) {
  let seed = 0;
  for (const ch of day) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const pool = POOL.slice();
  const out = [];
  while (out.length < 3) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    out.push(pool.splice(seed % pool.length, 1)[0]);
  }
  return out;
}

function fresh() {
  return { day: null, progress: {}, done: [], modesToday: [], ach: {}, news: [],
    c: { hands: 0, wins: 0, chipsWon: 0, biggestWin: 0, deepest: 0, streak: 0, games: [], byMode: {} } };
}

function createQuests(ctx) {
  const locks = new Map();
  const locked = (id, fn) => {
    const next = (locks.get(id) || Promise.resolve()).then(fn, fn);
    locks.set(id, next.catch(() => {}));
    return next;
  };
  const load = async (id) => ({ ...fresh(), ...((await ctx.store().getQuests(id)) || {}) });

  function rollDay(d, now) {
    const day = dayString(now);
    if (d.day !== day) { d.day = day; d.progress = {}; d.done = []; d.modesToday = []; }
    return day;
  }

  async function pay(id, d, coins, text, kind) {
    try { await ctx.coins().adjust(id, coins, 0); } catch (e) { console.error('quest reward', e); }
    d.news.push({ kind, text, coins, at: Date.now() });
    if (d.news.length > 10) d.news = d.news.slice(-10);
  }

  async function checkAchievements(id, d) {
    for (const a of ACHIEVEMENTS) {
      if (d.ach[a.id] || !a.check(d.c)) continue;
      d.ach[a.id] = Date.now();
      await pay(id, d, a.reward, a.text, 'achievement');
    }
  }

  return {
    POOL, ACHIEVEMENTS, questsFor,

    // r: { mode, net, won, pot, depth? }
    onResult(userId, r, now = Date.now()) {
      if (!userId) return Promise.resolve();
      return locked(userId, async () => {
        const d = await load(userId);
        rollDay(d, now);
        const c = d.c;
        c.hands++;
        if (r.won) { c.wins++; c.byMode[r.mode] = (c.byMode[r.mode] || 0) + 1; }
        if (CHIP_GAMES.includes(r.mode) && r.net > 0) { c.chipsWon += r.net; c.biggestWin = Math.max(c.biggestWin, r.net); }
        if (r.mode === 'goldrush' && r.won) c.deepest = Math.max(c.deepest, r.depth || 0);
        const g = gameOf(r.mode);
        if (!c.games.includes(g)) c.games.push(g);
        for (const q of questsFor(d.day)) {
          if (d.done.includes(q.id)) continue;
          const n = q.count(r, d);
          if (!n) continue;
          d.progress[q.id] = Math.min(q.goal, (d.progress[q.id] || 0) + n);
          if (d.progress[q.id] >= q.goal) { d.done.push(q.id); await pay(userId, d, q.reward, q.text, 'quest'); }
        }
        if (!d.modesToday.includes(g)) d.modesToday.push(g);
        await checkAchievements(userId, d);
        await ctx.store().saveQuests(userId, d);
      }).catch((e) => console.error('quests', e));
    },

    // daily bonus streak counts towards an achievement
    onStreak(userId, streak) {
      return locked(userId, async () => {
        const d = await load(userId);
        d.c.streak = Math.max(d.c.streak, streak);
        await checkAchievements(userId, d);
        await ctx.store().saveQuests(userId, d);
      }).catch((e) => console.error('quests', e));
    },

    async view(userId, now = Date.now()) {
      const d = await load(userId);
      const day = rollDay(d, now);
      const tomorrow = new Date(day + 'T00:00:00Z').getTime() + 86400000;
      return {
        resetsIn: tomorrow - now,
        daily: questsFor(day).map((q) => ({ id: q.id, text: q.text, goal: q.goal, reward: q.reward, progress: d.progress[q.id] || 0, done: d.done.includes(q.id) })),
        achievements: ACHIEVEMENTS.map((a) => ({ id: a.id, text: a.text, desc: a.desc, reward: a.reward, done: !!d.ach[a.id], at: d.ach[a.id] || null })),
      };
    },

    // completed quests / achievements the player has not been told about yet
    takeNews(userId) {
      return locked(userId, async () => {
        const d = await load(userId);
        if (!d.news.length) return [];
        const news = d.news;
        d.news = [];
        await ctx.store().saveQuests(userId, d);
        return news;
      });
    },
  };
}

module.exports = { createQuests, POOL, ACHIEVEMENTS, questsFor };
