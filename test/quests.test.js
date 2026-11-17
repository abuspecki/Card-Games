// Daily quests & achievements: same three a day, progress, rewards once, news.
const assert = require('assert');
const { createQuests, POOL, questsFor } = require('../quests');

(async () => {
  const saved = {}; const paid = [];
  const ctx = {
    store: () => ({ getQuests: async (id) => (saved[id] ? JSON.parse(JSON.stringify(saved[id])) : null), saveQuests: async (id, d) => { saved[id] = JSON.parse(JSON.stringify(d)); } }),
    coins: () => ({ adjust: async (id, c) => { paid.push([id, c]); return {}; } }),
  };
  const q = createQuests(ctx);
  const day = Date.UTC(2026, 10, 17, 12);

  // three different quests, stable for a day, changing between days
  const a = questsFor('2026-11-17'), b = questsFor('2026-11-17'), c = questsFor('2026-11-18');
  assert.strictEqual(new Set(a.map((x) => x.id)).size, 3);
  assert.deepStrictEqual(a.map((x) => x.id), b.map((x) => x.id));
  const days = new Set(); for (let d = 1; d <= 28; d++) days.add(questsFor(`2026-02-${String(d).padStart(2, '0')}`).map((x) => x.id).join());
  assert(days.size > 10, 'quests vary from day to day');

  // first win -> achievement paid exactly once
  await q.onResult(1, { mode: 'blackjack', net: 20, won: true, pot: 20 }, day);
  await q.onResult(1, { mode: 'blackjack', net: 20, won: true, pot: 20 }, day);
  assert.strictEqual(paid.filter((p) => p[1] === 50 && saved[1].ach['first-win']).length >= 1, true);
  assert.strictEqual(Object.keys(saved[1].ach).length, 1, 'first-win only once');

  // complete every quest of the day with matching results
  const v0 = await q.view(1, day);
  assert.strictEqual(v0.daily.length, 3);
  const results = {
    play10: { mode: 'bots', net: 0, won: false }, win3: { mode: 'roulette', net: 10, won: true }, variety3: null,
    bj2: { mode: 'blackjack', net: 10, won: true }, poker5: { mode: 'bots', net: 0, won: false }, roulette5: { mode: 'roulette', net: -5, won: false },
    flamingo1: { mode: 'flamingo', net: 1, won: true }, durak1: { mode: 'durak', net: 1, won: true }, gold50: { mode: 'goldrush', net: 50, won: true, depth: 6 },
    chips500: { mode: 'roulette', net: 300, won: true }, friends3: { mode: 'friends', net: 0, won: false },
  };
  for (const quest of v0.daily) {
    if (quest.id === 'variety3') { for (const m of ['durak', 'flamingo', 'roulette']) await q.onResult(1, { mode: m, net: 0, won: false }, day); continue; }
    for (let i = 0; i < 12; i++) await q.onResult(1, results[quest.id], day);
  }
  const v1 = await q.view(1, day);
  assert(v1.daily.every((x) => x.done && x.progress === x.goal), 'all three done: ' + JSON.stringify(v1.daily));
  for (const quest of v1.daily) assert.strictEqual(paid.filter((p) => p[1] === quest.reward).length >= 1, true, 'paid ' + quest.id);
  const paidBefore = paid.length;
  for (const quest of v0.daily) if (results[quest.id]) await q.onResult(1, results[quest.id], day);
  assert.strictEqual(paid.filter((p, i) => i >= paidBefore && POOL.some((x) => x.reward === p[1] && v1.daily.some((d) => d.id === x.id))).length, 0, 'quests pay once a day');

  // news are handed out once
  const news = await q.takeNews(1);
  assert(news.some((n) => n.kind === 'quest') && news.some((n) => n.kind === 'achievement'));
  assert.strictEqual((await q.takeNews(1)).length, 0);

  // next day: fresh quests, achievements stay
  const v2 = await q.view(1, day + 86400000);
  assert(v2.daily.every((x) => x.progress === 0 && !x.done));
  assert(v2.achievements.find((x) => x.id === 'first-win').done);

  // streak achievement
  await q.onStreak(2, 7);
  assert((await q.view(2)).achievements.find((x) => x.id === 'streak-7').done);
  console.log('quests ok');
})().catch((e) => { console.error(e); process.exit(1); });
