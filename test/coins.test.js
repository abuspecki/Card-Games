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

  // ----- the Bank: one rate (100 chips = 1 coin), 10 % fee each way -----
  assert.strictEqual(C.CONVERT_RATE, 110);
  assert.strictEqual(C.COIN_TO_CHIPS, 90);
  st = await coins.getStatus(p);                      // 1500 chips
  assert.strictEqual(st.convert.maxCoins, 13);
  assert.deepStrictEqual(st.rules, { chipsPerCoin: 100, fee: 0.1, topUpTo: 1000 });
  r = await coins.convert(p, 10);
  assert.strictEqual(r.converted, 10);
  assert.strictEqual(r.spentChips, 1100);
  b = await coins.balances(p);
  assert.strictEqual(b.chips, 400);
  assert.strictEqual(b.coins, C.WELCOME_COINS + 10);
  assert((await coins.convert(p, 4)).error, 'not enough chips');
  r = await coins.buyChips(p, 10);
  assert.strictEqual(r.gotChips, 900);
  b = await coins.balances(p);
  assert.strictEqual(b.chips, 1300, 'a round trip costs the fee both ways');
  assert((await coins.convert(p, 0)).error && (await coins.convert(p, -5)).error && (await coins.convert(p, 'abc')).error, 'bad amounts refused');
  assert((await coins.convert(p, C.BUYCHIPS_MAX + 1)).error, 'per-exchange limit');
  // concurrent exchanges never overdraw
  const q = await newUser('conv');                     // 5000 chips
  const conv = await Promise.all(Array.from({ length: 8 }, () => coins.convert(q, 10)));
  assert.strictEqual(conv.filter((x) => x.converted).length, 4, '4 x 1100 fits into 5000, the rest is refused');
  assert.strictEqual((await coins.balances(q)).chips, 600);

  // ----- coins from the tables: 1 per 100 chips won, at least 1 -----
  assert.strictEqual(C.rewardFor({ won: true, mode: 'friends', net: 460 }), 5);
  assert.strictEqual(C.rewardFor({ won: true, mode: 'blackjack', net: 20 }), 1);
  assert.strictEqual(C.rewardFor({ won: true, mode: 'roulette', net: 3500 }), 35);
  assert.strictEqual(C.rewardFor({ won: true, mode: 'durak', net: 1 }), 10);
  assert.strictEqual(C.rewardFor({ won: false, mode: 'friends', net: -50 }), 0);

  // ----- the daily top-up to 1,000 chips -----
  const z = await newUser('broke');
  assert((await coins.claimBankrupt(z, t0)).error, 'not below 1,000 with welcome chips');
  await coins.buyIn(z, 5000, 1); // all chips at a table
  assert((await coins.claimBankrupt(z, t0)).error, 'chips at a table still count');
  await coins.cashOut(z, 40, 5000); // lost almost everything
  st = await coins.getStatus(z);
  assert(st.bankrupt.ready && st.bankrupt.amount === 960);
  r = await coins.claimBankrupt(z, t0);
  assert.strictEqual(r.amount, 960);
  assert.strictEqual(r.chips, 1000, 'topped up to exactly 1,000');
  await coins.adjust(z, 0, -900);
  assert((await coins.claimBankrupt(z, t0 + 3600000)).error, 'once a day');
  assert.strictEqual((await coins.claimBankrupt(z, t0 + DAY)).amount, 900, 'again the next day');
  const twice = await Promise.all([coins.claimBankrupt(z, t0 + 3 * DAY + 1), coins.claimBankrupt(z, t0 + 3 * DAY + 1)]);
  assert(twice.every((x) => x.error), 'at 1,000 there is nothing to top up');

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

  // ----- statement: every booking with its reason, table buy-ins are not listed -----
  const sid = await newUser('stmt');
  await coins.claimDaily(sid, t0);
  await coins.convert(sid, 2);
  await coins.buyChips(sid, 1);
  await coins.earn(sid, 7, t0, 'win:blackjack');
  await coins.buy(sid, 'title-hon');
  await coins.adjust(sid, 5, 0, 'quest:Win 3 hands');
  const bi = await coins.buyIn(sid, 500, 100);
  await coins.cashOut(sid, 700, bi.amount);
  await coins.earn(sid, 999, t0, 'win:roulette');               // capped at the daily limit
  const capped = await coins.earn(sid, 5, t0, 'win:roulette');
  assert.deepStrictEqual([capped.amount, capped.capped, capped.today, capped.cap], [0, true, C.TABLE_DAILY_CAP, C.TABLE_DAILY_CAP]);
  const log = await coins.history(sid);
  assert.deepStrictEqual(log.map((e) => [e.reason, e.coins, e.chips]), [
    ['win:roulette', C.TABLE_DAILY_CAP - 7, 0],
    ['quest:Win 3 hands', 5, 0],
    ['shop:title-hon', -150, 0],
    ['win:blackjack', 7, 0],
    ['bank', -1, C.COIN_TO_CHIPS],
    ['bank', 2, -2 * C.CONVERT_RATE],
    ['daily:1', 100, 0],
  ], JSON.stringify(log));
  const sum = log.reduce((a, e) => a + e.coins, C.WELCOME_COINS);
  assert.strictEqual(sum, (await coins.getStatus(sid)).coins, 'the statement adds up to the balance');

  // ----- rewards -----
  assert.strictEqual(C.rewardFor({ mode: 'friends', won: true, net: 1250, pot: 1500 }), 13);
  assert.strictEqual(C.rewardFor({ mode: 'durak', won: false }), 0);
  console.log(`coins ok (${store.kind})`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
