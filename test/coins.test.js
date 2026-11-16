const assert = require('assert');
const path = require('path');
const os = require('os');
process.env.DATABASE_URL = '';
process.env.DATA_FILE = path.join(os.tmpdir(), `coins-test-${process.pid}.json`);
const { openStore } = require('../store');
const { makeCoins, rewardFor, CATALOG } = require('../coins');

(async () => {
  const { store } = await openStore();
  const coins = makeCoins(store);
  const user = await store.createUser('coin_tester', 'x');
  const id = user.id;
  const DAY = 86400000;
  const t0 = Date.UTC(2026, 10, 10, 12);

  let st = await coins.getStatus(id);
  assert.strictEqual(st.coins, 200, 'welcome coins');
  assert.strictEqual(st.daily.ready, true);

  // Daily bonus: 100, then 125, 150 … capped at 250 on day 7+
  const amounts = [];
  for (let d = 0; d < 9; d++) amounts.push((await coins.claimDaily(id, t0 + d * DAY)).amount);
  assert.deepStrictEqual(amounts, [100, 125, 150, 175, 200, 225, 250, 250, 250]);
  assert(( await coins.claimDaily(id, t0 + 8 * DAY + 3600000)).error, 'second claim same day refused');
  // Missing a day resets the streak
  assert.strictEqual((await coins.claimDaily(id, t0 + 10 * DAY)).amount, 100);
  // Two claims at the same moment: only one pays
  const both = await Promise.all([coins.claimDaily(id, t0 + 11 * DAY), coins.claimDaily(id, t0 + 11 * DAY)]);
  assert.strictEqual(both.filter((r) => r.amount).length, 1, 'double claim');

  // Table earnings capped at 500 per day
  let total = 0;
  for (let k = 0; k < 30; k++) total += (await coins.earn(id, 40, t0 + 11 * DAY)).amount;
  assert.strictEqual(total, 500);
  assert.strictEqual((await coins.earn(id, 40, t0 + 12 * DAY)).amount, 40, 'cap resets next day');

  // Shop: buy, can't buy twice, can't afford, equip
  const before = await coins.balance(id);
  const r = await coins.buy(id, 'badge-crown');
  assert.strictEqual(r.coins, before - 800);
  assert((await coins.buy(id, 'badge-crown')).error, 'no double buy');
  assert((await coins.equip(id, 'badge', 'badge-diamond')).error, 'cannot equip unowned');
  assert((await coins.equip(id, 'felt', 'badge-crown')).error, 'wrong slot');
  assert.ok((await coins.equip(id, 'badge', 'badge-crown')).ok);
  assert.strictEqual(await coins.badgeOf(id), '👑');
  await coins.equip(id, 'badge', null);
  assert.strictEqual(await coins.badgeOf(id), null);

  // Spend down, then refill rules
  const u2 = (await store.createUser('broke_tester', 'x')).id;
  assert((await coins.claimRefill(u2, t0)).error, 'no refill with 200 coins');
  await coins.buy(u2, 'badge-star'); // 200 -> 50
  assert((await coins.claimRefill(u2, t0)).error, 'exactly 50 is not under 50');
  assert((await coins.buy(u2, 'badge-fire')).error, 'cannot afford');
  await store.updateWallet(u2, 200, () => ({ update: { coins: 10 } }));
  assert.strictEqual((await coins.claimRefill(u2, t0)).coins, 110);
  await store.updateWallet(u2, 200, () => ({ update: { coins: 0 } }));
  assert((await coins.claimRefill(u2, t0 + 3600000)).error, 'refill cooldown');
  assert.strictEqual((await coins.claimRefill(u2, t0 + 4 * 3600000)).amount, 100);

  // Rewards
  assert.strictEqual(rewardFor({ mode: 'friends', won: true, pot: 1250 }, false), 22);
  assert.strictEqual(rewardFor({ mode: 'bots', won: true, pot: 99999 }, false), 50);
  assert.strictEqual(rewardFor({ mode: 'blackjack', won: true, net: 150 }, true), 16);
  assert.strictEqual(rewardFor({ mode: 'durak', won: true }, false), 15);
  assert.strictEqual(rewardFor({ mode: 'durak', won: false }, true), 0);
  assert(CATALOG.every((i) => i.price > 0));
  console.log('coins ok');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
