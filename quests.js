// Daily quests and achievements.
//
// Every recorded result (a hand, a spin, a game of Durak or Flamingo, a Gold
// Rush dig) is passed to onResult(). Three quests a day (the same three for
// everyone, picked from a pool by the date) and one-time achievements pay
// coins automatically when completed; the player is told on their next
// presence poll (news) and sees everything in the lounge.
const { dayString } = require('./coins');

const CHIP_GAMES = ['friends', 'bots', 'blackjack', 'roulette', 'goldrush', 'draw'];
const CARD_GAMES = ['friends', 'bots', 'blackjack', 'durak', 'flamingo'];
const HOLDEM = (r) => r.mode === 'friends' || r.mode === 'bots';

// Daily quests. Result quests: count(result) -> how much this result advances it.
// Event quests (`event`): advanced by onEvent() — a tip, a box, a chip gift, a round with a friend.
// Run quests (`run`): the progress is a streak that falls back to 0 on a loss.
const POOL = [
  { id: 'play10', text: 'Play 10 rounds of any game', goal: 10, reward: 30, count: () => 1 },
  { id: 'win3', text: 'Win 3 rounds of any game', goal: 3, reward: 50, count: (r) => (r.won ? 1 : 0) },
  { id: 'variety3', text: 'Play 3 different games', goal: 3, reward: 50, count: (r, d) => (d.modesToday.includes(gameOf(r.mode)) ? 0 : 1), track: true },
  { id: 'bj2', text: 'Win 2 hands of Blackjack', goal: 2, reward: 40, count: (r) => (r.mode === 'blackjack' && r.won ? 1 : 0) },
  { id: 'poker5', text: "Play 5 hands of Hold'em", goal: 5, reward: 30, count: (r) => (HOLDEM(r) ? 1 : 0) },
  { id: 'roulette5', text: 'Play 5 spins of Roulette', goal: 5, reward: 30, count: (r) => (r.mode === 'roulette' ? 1 : 0) },
  { id: 'flamingo1', text: 'Win a game of Flamingo', goal: 1, reward: 60, count: (r) => (r.mode === 'flamingo' && r.won ? 1 : 0) },
  { id: 'durak1', text: 'Escape a game of Durak', goal: 1, reward: 50, count: (r) => (r.mode === 'durak' && r.won ? 1 : 0) },
  { id: 'gold50', text: 'Reach 50 m in Gold Rush and cash out', goal: 1, reward: 50, count: (r) => (r.mode === 'goldrush' && r.won && (r.depth || 0) >= 5 ? 1 : 0) },
  { id: 'chips500', text: 'Win 500 chips today', goal: 500, reward: 80, count: (r) => (CHIP_GAMES.includes(r.mode) && r.net > 0 ? r.net : 0) },
  { id: 'friends3', text: "Play 3 hands of Hold'em with real people", goal: 3, reward: 50, count: (r) => (r.mode === 'friends' ? 1 : 0) },
  { id: 'roulette3', text: 'Win 3 spins of Roulette', goal: 3, reward: 50, count: (r) => (r.mode === 'roulette' && r.won ? 1 : 0) },
  { id: 'durak2', text: 'Play 2 games of Durak', goal: 2, reward: 40, count: (r) => (r.mode === 'durak' ? 1 : 0) },
  { id: 'flamingo3', text: 'Play 3 games of Flamingo', goal: 3, reward: 40, count: (r) => (r.mode === 'flamingo' ? 1 : 0) },
  { id: 'pot500', text: "Win a Hold'em pot of 500 chips or more", goal: 1, reward: 60, count: (r) => (HOLDEM(r) && r.won && r.net >= 500 ? 1 : 0) },
  { id: 'bjrun3', text: 'Win 3 hands of Blackjack in a row', goal: 3, reward: 80, run: (r) => (r.mode !== 'blackjack' ? null : r.won) },
  { id: 'tip1', text: 'Tip a dealer', goal: 1, reward: 30, event: 'tip' },
  { id: 'box1', text: 'Open a skin box', goal: 1, reward: 40, event: 'box' },
  { id: 'gift1', text: 'Send chips to a friend', goal: 1, reward: 40, event: 'gift' },
  { id: 'friend5', text: 'Play 5 rounds at a table with a friend', goal: 5, reward: 60, event: 'friendHand' },
];

// Achievements in tiers (bronze, silver, gold). Many unlock a player tag.
const A = (id, tier, text, desc, reward, check, tag) => ({ id, tier, text, desc, reward, check, tag: tag || null });
const ACHIEVEMENTS = [
  A('first-win', 'bronze', 'First win', 'Win your first round', 50, (c) => c.wins >= 1),
  A('wins-100', 'silver', 'Winner', 'Win 100 rounds', 300, (c) => c.wins >= 100, 'tag-winner'),
  A('wins-1000', 'gold', 'Champion', 'Win 1,000 rounds', 1000, (c) => c.wins >= 1000, 'tag-champion'),
  A('hands-100', 'bronze', 'Regular', 'Play 100 rounds', 100, (c) => c.hands >= 100, 'tag-regular'),
  A('hands-1000', 'silver', 'Part of the furniture', 'Play 1,000 rounds', 500, (c) => c.hands >= 1000, 'tag-furniture'),
  A('hands-10000', 'gold', 'Institution', 'Play 10,000 rounds', 2000, (c) => c.hands >= 10000, 'tag-institution'),
  A('won-10000', 'bronze', 'High earner', 'Win 10,000 chips in total', 300, (c) => c.chipsWon >= 10000, 'tag-earner'),
  A('won-100000', 'silver', 'Shark', 'Win 100,000 chips in total', 800, (c) => c.chipsWon >= 100000, 'tag-shark'),
  A('won-1000000', 'gold', 'Whale', 'Win 1,000,000 chips in total', 2500, (c) => c.chipsWon >= 1000000, 'tag-whale'),
  A('pot-1000', 'bronze', 'Big pot', 'Win 1,000 chips or more in one round', 150, (c) => c.biggestWin >= 1000),
  A('pot-10000', 'silver', 'Huge pot', 'Win 10,000 chips or more in one round', 500, (c) => c.biggestWin >= 10000, 'tag-pothunter'),
  A('pot-100000', 'gold', 'Monster pot', 'Win 100,000 chips or more in one round', 1500, (c) => c.biggestWin >= 100000),
  A('all-games', 'silver', 'All-rounder', 'Play every game at least once', 200, (c) => ['holdem', 'blackjack', 'roulette', 'durak', 'flamingo', 'goldrush'].every((g) => c.games.includes(g)), 'tag-allrounder'),
  A('flamingo-10', 'bronze', 'Flamingo master', 'Win 10 games of Flamingo', 200, (c) => (c.byMode.flamingo || 0) >= 10),
  A('flamingo-50', 'gold', 'Flamingo royalty', 'Win 50 games of Flamingo', 800, (c) => (c.byMode.flamingo || 0) >= 50, 'tag-flamingo'),
  A('durak-10', 'bronze', 'Never the fool', 'Escape 10 games of Durak', 200, (c) => (c.byMode.durak || 0) >= 10),
  A('durak-50', 'gold', 'Durak master', 'Escape 50 games of Durak', 800, (c) => (c.byMode.durak || 0) >= 50, 'tag-durak'),
  A('gold-100', 'silver', 'Deep digger', 'Cash out at 100 m in Gold Rush', 200, (c) => c.deepest >= 10, 'tag-digger'),
  A('streak-7', 'bronze', 'Every day', 'Collect the daily bonus 7 days in a row', 150, (c) => c.streak >= 7),
  A('streak-30', 'silver', 'Loyal', 'Collect the daily bonus 30 days in a row', 1000, (c) => c.streak >= 30, 'tag-loyal'),
  A('streak-100', 'gold', 'Devoted', 'Collect the daily bonus 100 days in a row', 5000, (c) => c.streak >= 100, 'tag-devoted'),
  A('tip-1000', 'bronze', 'Tipper', 'Tip dealers 1,000 chips in total', 100, (c) => c.tipped >= 1000),
  A('tip-25000', 'silver', 'Generous', 'Tip dealers 25,000 chips in total', 400, (c) => c.tipped >= 25000, 'tag-generous'),
  A('tip-250000', 'gold', 'Patron of the house', 'Tip dealers 250,000 chips in total', 1500, (c) => c.tipped >= 250000, 'tag-patron'),
  A('box-10', 'bronze', 'Unboxing', 'Open 10 skin boxes', 150, (c) => c.boxes >= 10),
  A('box-50', 'silver', 'Unboxer', 'Open 50 skin boxes', 500, (c) => c.boxes >= 50, 'tag-unboxer'),
  A('skins-25', 'silver', 'Collector', 'Own 25 skins', 300, (c) => c.skins >= 25, 'tag-collector'),
  A('skins-60', 'gold', 'Curator', 'Own 60 skins', 1000, (c) => c.skins >= 60, 'tag-curator'),
  A('set-1', 'silver', 'Completionist', 'Complete a whole category in your collection', 300, (c) => c.sets >= 1, 'tag-completionist'),
  A('gift-10000', 'silver', 'Good friend', 'Send friends 10,000 chips in total', 300, (c) => c.gifted >= 10000, 'tag-goodfriend'),
  A('friends-50', 'silver', 'Socialite', 'Play 50 rounds at a table with friends', 300, (c) => c.friendHands >= 50, 'tag-socialite'),
  A('quests-30', 'silver', 'Questor', 'Complete 30 daily quests', 300, (c) => c.quests >= 30, 'tag-questor'),
  A('quests-150', 'gold', 'Quest master', 'Complete 150 daily quests', 1000, (c) => c.quests >= 150),
];
// Completing a whole category of box skins pays once.
const SET_REWARD = 300;

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
    tagsGiven: [], sets: [], run: {},
    c: { hands: 0, wins: 0, chipsWon: 0, biggestWin: 0, deepest: 0, streak: 0, games: [], byMode: {},
      tipped: 0, boxes: 0, skins: 0, sets: 0, gifted: 0, friendHands: 0, quests: 0 } };
}

function createQuests(ctx) {
  const locks = new Map();
  const locked = (id, fn) => {
    const next = (locks.get(id) || Promise.resolve()).then(fn, fn);
    locks.set(id, next.catch(() => {}));
    return next;
  };
  const load = async (id) => {
    const base = fresh();
    const d = { ...base, ...((await ctx.store().getQuests(id)) || {}) };
    d.c = { ...base.c, ...d.c };   // counters added later start at 0
    return d;
  };

  function rollDay(d, now) {
    const day = dayString(now);
    if (d.day !== day) { d.day = day; d.progress = {}; d.done = []; d.modesToday = []; d.run = {}; }
    return day;
  }

  async function pay(id, d, coins, text, kind) {
    try { await ctx.coins().adjust(id, coins, 0, `${kind === 'achievement' ? 'achievement' : 'quest'}:${text}`); } catch (e) { console.error('quest reward', e); }
    d.news.push({ kind, text, coins, at: Date.now() });
    if (d.news.length > 10) d.news = d.news.slice(-10);
  }

  async function checkAchievements(id, d) {
    for (const a of ACHIEVEMENTS) {
      if (!d.ach[a.id] && a.check(d.c)) {
        d.ach[a.id] = Date.now();
        await pay(id, d, a.reward, a.text, 'achievement');
      }
      // the tag of a finished achievement (also for achievements finished before tags existed)
      if (d.ach[a.id] && a.tag && !d.tagsGiven.includes(a.tag)) {
        try { await ctx.coins().grantItem(id, a.tag); d.tagsGiven.push(a.tag); } catch (e) { console.error('tag', e); }
      }
    }
  }

  async function finishQuest(id, d, q) {
    d.done.push(q.id);
    d.c.quests++;
    await pay(id, d, q.reward, q.text, 'quest');
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
          if (d.done.includes(q.id) || q.event) continue;
          if (q.run) {
            const w = q.run(r);
            if (w === null) continue;
            d.progress[q.id] = w ? Math.min(q.goal, (d.progress[q.id] || 0) + 1) : 0;
          } else {
            const n = q.count(r, d);
            if (!n) continue;
            d.progress[q.id] = Math.min(q.goal, (d.progress[q.id] || 0) + n);
          }
          if (d.progress[q.id] >= q.goal) await finishQuest(userId, d, q);
        }
        if (!d.modesToday.includes(g)) d.modesToday.push(g);
        await checkAchievements(userId, d);
        await ctx.store().saveQuests(userId, d);
      }).catch((e) => console.error('quests', e));
    },

    // Things that are not a game result:
    //   tip (chips), box, gift (chips), friendHand, collection ({ owned: [...item ids] })
    onEvent(userId, kind, value = 1, now = Date.now()) {
      if (!userId) return Promise.resolve();
      return locked(userId, async () => {
        const d = await load(userId);
        rollDay(d, now);
        const c = d.c;
        if (kind === 'tip') c.tipped += Math.max(0, Number(value) || 0);
        if (kind === 'box') c.boxes++;
        if (kind === 'gift') c.gifted += Math.max(0, Number(value) || 0);
        if (kind === 'friendHand') c.friendHands++;
        if (kind === 'collection' && value && Array.isArray(value.owned)) {
          const { CATALOG, SHOP_TABS, boxItems } = require('./coins');
          const owned = new Set(value.owned);
          c.skins = CATALOG.filter((i) => owned.has(i.id) && !i.earned).length;
          for (const slot of SHOP_TABS) {
            const items = boxItems(slot);
            if (!items.length || d.sets.includes(slot) || !items.every((i) => owned.has(i.id))) continue;
            d.sets.push(slot);
            await pay(userId, d, SET_REWARD, `set:${slot}`, 'set');
          }
          c.sets = d.sets.length;
        }
        for (const q of questsFor(d.day)) {
          if (q.event !== kind || d.done.includes(q.id)) continue;
          d.progress[q.id] = Math.min(q.goal, (d.progress[q.id] || 0) + 1);
          if (d.progress[q.id] >= q.goal) await finishQuest(userId, d, q);
        }
        await checkAchievements(userId, d);
        await ctx.store().saveQuests(userId, d);
      }).catch((e) => console.error('quests', e));
    },

    // categories this player has completed
    async sets(userId) { return (await load(userId)).sets; },

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
        achievements: ACHIEVEMENTS.map((a) => ({ id: a.id, tier: a.tier, text: a.text, desc: a.desc, reward: a.reward, tag: a.tag, done: !!d.ach[a.id], at: d.ach[a.id] || null })),
        sets: d.sets, setReward: SET_REWARD,
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

module.exports = { createQuests, POOL, ACHIEVEMENTS, questsFor, SET_REWARD };
