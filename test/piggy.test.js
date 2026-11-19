// The piggy bank: tips add up; at 500,000 every member gets 100 coins once,
// the rest stays in. Runs against Postgres when TEST_DATABASE_URL is set.
const assert = require('assert');
const path = require('path');
const os = require('os');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || '';
process.env.DATA_FILE = path.join(os.tmpdir(), `piggy-test-${process.pid}.json`);
const { openStore } = require('../store');
const C = require('../coins');
const { createPiggy, GOAL, REWARD } = require('../piggy');

(async () => {
  const { store } = await openStore();
  const coins = C.makeCoins(store);
  const announced = [];
  const piggy = createPiggy({ store: () => store, coins: () => coins, lobby: { announce: (t) => announced.push(t) } });
  const tag = Date.now().toString(36);
  const a = (await store.createUser(`pa_${tag}`, 'x')).id;
  const b = (await store.createUser(`pb_${tag}`, 'x')).id;
  const start = await piggy.info();
  const base = start.total;
  assert.strictEqual(start.goal, GOAL);
  const before = await Promise.all([a, b].map(async (id) => (await coins.getStatus(id)).coins));

  // fill up to just below the goal, then many tips at the same time push it over
  await piggy.add(GOAL - base - 50);
  assert.strictEqual((await piggy.info()).total, GOAL - 50);
  await Promise.all(Array.from({ length: 10 }, () => piggy.add(10)));
  assert.strictEqual((await piggy.info()).total, 50, 'paid once, the rest (50) stays in');
  const after = await Promise.all([a, b].map(async (id) => (await coins.getStatus(id)).coins));
  assert.deepStrictEqual(after.map((x, i) => x - before[i]), [REWARD, REWARD], 'every member got the reward once');
  assert.strictEqual((await coins.history(a))[0].reason, 'piggy');
  assert.strictEqual(announced.length, 1);
  console.log(`piggy ok (${store.kind})`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
