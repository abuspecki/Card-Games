// Economy rules: daily bonus, chips <-> tables, bankruptcy, conversion, shop.
// Runs against Postgres when TEST_DATABASE_URL is set, otherwise a temp JSON file.
const assert = require('assert');
const path = require('path');
const os = require('os');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || '';
process.env.DATA_FILE = path.join(os.tmpdir(), `coins-test-${process.pid}.json`);
const { openStore } = require('../store');
const C = require('../coins');

(async () => {
  const { store } = await openStore();
  const coins = C.makeCoins(store);
  const tag = Date.now().toString(36);
  const newUser = async (n) => (await store.createUser(`${n}_${tag}`, 'x')).id;
  const DAY = 86400000;
  const t0 = Date.UTC(2026, 10, 10, 12);

  // ----- welcome + daily bonus -----
  const id = await newUser('coin');
  let st = await coins.getStatus(id);
  assert.strictEqual(st.coins, C.WELCOME_COINS);
  assert.strictEqual(st.chips, C.WELCOME_CHIPS);
  const amounts = [];
  for (let d = 0; d < 9; d++) amounts.push((await coins.claimDaily(id, t0 + d * DAY)).amount);
  assert.deepStrictEqual(amounts, [100, 125, 150, 175, 200, 225, 250, 250, 250]);
  assert((await coins.claimDaily(id, t0 + 8 * DAY + 3600000)).error, 'second claim same day refused');
  assert.strictEqual((await coins.claimDaily(id, t0 + 10 * DAY)).amount, 100, 'missed day resets streak');
  const both = await Promise.all([coins.claimDaily(id, t0 + 11 * DAY), coins.claimDaily(id, t0 + 11 * DAY)]);
  assert.strictEqual(both.filter((r) => r.amount).length, 1, 'double claim');

  // ----- table coin rewards capped per day -----
  let total = 0;
  for (let k = 0; k < 30; k++) total += (await coins.earn(id, 40, t0 + 11 * DAY)).amount;
  assert.strictEqual(total, C.TABLE_DAILY_CAP);

  // ----- chips: buy-in / cash-out -----
  const p = await newUser('player');
  let r = await coins.buyIn(p, 1000, 200);
  assert.strictEqual(r.amount, 1000);
  let b = await coins.balances(p);
  assert.deepStrictEqual([b.chips, b.inPlay], [4000, 1000]);
  await coins.cashOut(p, 1750, 1000); // won 750 at the table
  b = await coins.balances(p);
  assert.deepStrictEqual([b.chips, b.inPlay], [5750, 0]);
  assert((await coins.buyIn(p, 1000, 10000)).error, 'minimum buy-in enforced');
  // buy-ins can't overdraw even when fired together
  await coins.adjust(p, 0, -5750 + 1500); // 1500 chips
  const buys = await Promise.all([coins.buyIn(p, 1000, 200), coins.buyIn(p, 1000, 200), coins.buyIn(p, 1000, 200)]);
  b = await coins.balances(p);
  assert.strictEqual(b.chips + b.inPlay, 1500, 'chips conserved under concurrent buy-ins');
  assert(b.chips >= 0);
  assert.strictEqual(buys.filter((x) => !x.error).reduce((a, x) => a + x.amount, 0), b.inPlay);

  // crash refund: chips at tables come back
  await store.refundInPlay();
  b = await coins.balances(p);
  assert.deepStrictEqual([b.chips, b.inPlay], [1500, 0]);

  // ----- conversion: only chips above the floor, daily cap -----
  assert((await coins.convert(p, 1)).error, 'below the floor nothing converts');
  await coins.adjust(p, 0, 5000 + 4000 - 1500); // 9000 chips -> 40 convertible coins
  st = await coins.getStatus(p);
  assert.strictEqual(st.convert.maxCoins, 40);
  r = await coins.convert(p, 25, t0);
  assert.strictEqual(r.converted, 25);
  b = await coins.balances(p);
  assert.strictEqual(b.chips, 9000 - 2500);
  assert.strictEqual(b.coins, C.WELCOME_COINS + 25);
  assert((await coins.convert(p, 16, t0)).error, 'cannot convert below floor');
  await coins.adjust(p, 0, 100000);
  r = await coins.convert(p, C.CONVERT_DAILY_MAX, t0);
  assert(r.error, 'daily cap includes earlier conversions');
  r = await coins.convert(p, C.CONVERT_DAILY_MAX - 25, t0);
  assert.strictEqual(r.converted, C.CONVERT_DAILY_MAX - 25);
  assert((await coins.convert(p, 1, t0)).error, 'daily cap reached');
  assert.strictEqual((await coins.convert(p, 10, t0 + DAY)).converted, 10, 'cap resets next day');
  assert((await coins.convert(p, 0)).error && (await coins.convert(p, -5)).error && (await coins.convert(p, 'abc')).error, 'bad amounts refused');
  // concurrent conversions never exceed the cap
  const q = await newUser('conv');
  await coins.adjust(q, 0, 100000);
  const conv = await Promise.all(Array.from({ length: 8 }, () => coins.convert(q, 100, t0)));
  assert.strictEqual(conv.filter((x) => x.converted).length, 3, 'only 300 coins/day even in parallel');

  // ----- bankruptcy refill -----
  const z = await newUser('broke');
  assert((await coins.claimBankrupt(z, t0)).error, 'not bankrupt with welcome chips');
  await coins.buyIn(z, 5000, 1); // all chips at a table
  assert((await coins.claimBankrupt(z, t0)).error, 'chips at a table still count');
  await coins.cashOut(z, 40, 5000); // lost almost everything
  r = await coins.claimBankrupt(z, t0);
  assert.strictEqual(r.chips, 1040);
  await coins.adjust(z, 0, -1040);
  assert((await coins.claimBankrupt(z, t0 + 60000)).error, 'cooldown');
  assert.strictEqual((await coins.claimBankrupt(z, t0 + C.BANKRUPT_COOLDOWN)).amount, C.BANKRUPT_GRANT);
  // free chips never become convertible
  assert.strictEqual((await coins.getStatus(z)).convert.maxCoins, 0);

  // ----- shop -----
  const s = await newUser('shopper');
  await coins.adjust(s, 2000, 0);
  r = await coins.buy(s, 'pf-crest');
  assert.strictEqual(r.coins, C.WELCOME_COINS + 2000 - 450);
  assert((await coins.buy(s, 'pf-crest')).error, 'no double buy');
  const dup = await Promise.all([coins.buy(s, 'bg-marble'), coins.buy(s, 'bg-marble'), coins.buy(s, 'bg-marble')]);
  assert.strictEqual(dup.filter((x) => x.item).length, 1, 'concurrent double buy prevented');
  assert((await coins.equip(s, 'badge', 'title-duke')).error, 'cannot equip unowned');
  assert((await coins.equip(s, 'felt', 'pf-crest')).error, 'wrong slot');
  assert.ok((await coins.equip(s, 'avatar', 'pf-crest')).ok);
  assert.ok((await coins.buy(s, 'title-baron')).item);
  assert.ok((await coins.equip(s, 'badge', 'title-baron')).ok);
  assert.deepStrictEqual(await coins.lookOf(s), { avatar: 'pf:crest', badge: 't:Baron' });
  // retired items can't be bought any more…
  assert((await coins.buy(s, 'avatar-lion')).error, 'retired items are not sold');
  // …but players who own one keep it and can still use it
  await store.updateWallet(s, { coins: 0, chips: 0 }, () => ({ addItem: 'avatar-lion', result: true }));
  assert.ok((await coins.equip(s, 'avatar', 'avatar-lion')).ok, 'owned retired item still usable');
  assert.strictEqual((await coins.lookOf(s)).avatar, '🦁');
  // gestures: only owned ones can be used, and they can't be equipped
  assert.strictEqual(await coins.gestureOf(s, 'gesture-hat'), null);
  assert.ok((await coins.buy(s, 'gesture-hat')).item);
  assert.strictEqual((await coins.gestureOf(s, 'gesture-hat')).preview, 'tips the hat');
  assert.strictEqual(await coins.gestureOf(s, 'pf-crest'), null, 'only gestures');
  assert((await coins.equip(s, 'gesture', 'gesture-hat')).error, 'gestures are not a slot');
  // every item has a unique id and a known slot
  assert.strictEqual(new Set(C.CATALOG.map((i) => i.id)).size, C.CATALOG.length, 'unique ids');
  assert(C.CATALOG.every((i) => C.SHOP_TABS.includes(i.slot)), 'every item belongs to a shop tab');
  assert(C.SHOP_TABS.every((slot) => C.CATALOG.some((i) => i.slot === slot && !i.retired)), 'every tab has items for sale');
  assert((await coins.buy(s, 'nope')).error);
  assert(C.SLOTS.every((slot) => C.CATALOG.some((i) => i.slot === slot)), 'every slot has items');

  // ----- rewards -----
  assert.strictEqual(C.rewardFor({ mode: 'friends', won: true, pot: 1250 }, false), 22);
  assert.strictEqual(C.rewardFor({ mode: 'blackjack', won: true, net: 150 }, true), 16);
  assert.strictEqual(C.rewardFor({ mode: 'durak', won: false }, true), 0);
  console.log(`coins ok (${store.kind})`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
