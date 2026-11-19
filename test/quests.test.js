// Daily quests & achievements: same three a day, progress, rewards once, news.
const assert = require('assert');
const { createQuests, POOL, questsFor } = require('../quests');

(async () => {
  const saved = {}; const paid = []; const granted = [];
  const ctx = {
    store: () => ({ getQuests: async (id) => (saved[id] ? JSON.parse(JSON.stringify(saved[id])) : null), saveQuests: async (id, d) => { saved[id] = JSON.parse(JSON.stringify(d)); } }),
    coins: () => ({ adjust: async (id, c) => { paid.push([id, c]); return {}; }, grantItem: async (id, item) => { granted.push([id, item]); return true; } }),
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
    roulette3: { mode: 'roulette', net: 10, won: true }, durak2: { mode: 'durak', net: 0, won: false }, flamingo3: { mode: 'flamingo', net: 0, won: false },
    pot500: { mode: 'friends', net: 600, won: true }, bjrun3: { mode: 'blackjack', net: 10, won: true },
  };
  const events = { tip1: 'tip', box1: 'box', gift1: 'gift', friend5: 'friendHand' };
  for (const quest of v0.daily) {
    if (events[quest.id]) { for (let i = 0; i < 6; i++) await q.onEvent(1, events[quest.id], 100, day); continue; }
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
  // every quest in the pool can be completed
  for (const quest of POOL) assert(results[quest.id] !== undefined || events[quest.id], 'test covers ' + quest.id);

  // a run quest falls back to 0 on a loss
  const runDay = (() => { for (let d = 0; d < 400; d++) { const t = day + d * 86400000; if (questsFor(new Date(t).toISOString().slice(0, 10)).some((x) => x.id === 'bjrun3')) return t; } })();
  await q.onResult(5, { mode: 'blackjack', net: 10, won: true }, runDay);
  await q.onResult(5, { mode: 'blackjack', net: 10, won: true }, runDay);
  await q.onResult(5, { mode: 'blackjack', net: -10, won: false }, runDay);
  await q.onResult(5, { mode: 'roulette', net: 10, won: true }, runDay);
  assert.strictEqual((await q.view(5, runDay)).daily.find((x) => x.id === 'bjrun3').progress, 0);
  for (let i = 0; i < 3; i++) await q.onResult(5, { mode: 'blackjack', net: 10, won: true }, runDay);
  assert((await q.view(5, runDay)).daily.find((x) => x.id === 'bjrun3').done);

  // achievements in tiers unlock tags; tips add up
  await q.onEvent(6, 'tip', 30000);
  assert((await q.view(6)).achievements.find((x) => x.id === 'tip-25000').done);
  assert(granted.some(([id, item]) => id === 6 && item === 'tag-generous'), 'generous tag granted');
  const n = granted.length; await q.onEvent(6, 'tip', 1);
  assert.strictEqual(granted.filter(([id]) => id === 6).length, granted.slice(0, n).filter(([id]) => id === 6).length, 'tags only once');

  // a completed category pays once
  const { boxItems } = require('../coins');
  const felts = boxItems('felt').map((i) => i.id);
  await q.onEvent(7, 'collection', { owned: felts.slice(1) });
  assert.strictEqual((await q.view(7)).sets.length, 0);
  await q.onEvent(7, 'collection', { owned: felts });
  await q.onEvent(7, 'collection', { owned: felts });
  const v7 = await q.view(7);
  assert.deepStrictEqual(v7.sets, ['felt']);
  assert(v7.achievements.find((x) => x.id === 'set-1').done);
  assert.strictEqual(paid.filter(([id, c]) => id === 7 && c === 300).length, 2, 'set reward + achievement, once each');

  // streak milestones
  await q.onStreak(8, 30);
  assert((await q.view(8)).achievements.find((x) => x.id === 'streak-30').done);
  assert(granted.some(([id, item]) => id === 8 && item === 'tag-loyal'));
  console.log('quests ok');
})().catch((e) => { console.error(e); process.exit(1); });
