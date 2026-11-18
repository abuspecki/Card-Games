// Weekly ranking: week boundaries, the tally, prizes paid exactly once.
// Runs against Postgres when TEST_DATABASE_URL is set, otherwise a temp JSON file.
const assert = require('assert');
const path = require('path');
const os = require('os');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || '';
process.env.DATA_FILE = path.join(os.tmpdir(), `weekly-test-${process.pid}.json`);
const { openStore } = require('../store');
const C = require('../coins');
const W = require('../weekly');

(async () => {
  // ----- week keys: Monday (UTC) -----
  assert.strictEqual(W.weekKey(Date.UTC(2026, 10, 18, 12)), '2026-11-16', 'Wednesday -> Monday');
  assert.strictEqual(W.weekKey(Date.UTC(2026, 10, 16, 0, 0, 1)), '2026-11-16', 'Monday morning');
  assert.strictEqual(W.weekKey(Date.UTC(2026, 10, 22, 23, 59)), '2026-11-16', 'Sunday night');
  assert.strictEqual(W.weekKey(Date.UTC(2027, 0, 1)), '2026-12-28', 'across the new year');
  assert.strictEqual(W.prevWeek(Date.UTC(2026, 10, 18)), '2026-11-09');
  assert.strictEqual(W.weekEnd('2026-11-16'), Date.UTC(2026, 10, 23));

  const { store } = await openStore();
  const coins = C.makeCoins(store);
  const announced = [];
  const ctx = { store: () => store, coins: () => coins, lobby: { announce: (t) => announced.push(t) } };
  const weekly = W.createWeekly(ctx);
  const tag = Date.now().toString(36);
  const mk = async (n) => (await store.createUser(`${n}_${tag}`, 'x')).id;
  const [a, b, c, d, e] = [await mk('wa'), await mk('wb'), await mk('wc'), await mk('wd'), await mk('we')];
  const lastWeek = Date.UTC(2026, 10, 11, 15);   // Wednesday of the week before
  const now = Date.UTC(2026, 10, 17, 9);         // Tuesday

  // last week: a +900 (12 hands), b +400 (10), c +700 but only 3 hands, d −50, e +100 (10)
  const play = async (id, hands, total, t, mode = 'blackjack') => {
    for (let k = 0; k < hands; k++) await weekly.onResult(id, mode, k === 0 ? total : 0, k === 0 && total > 0, t);
  };
  await play(a, 12, 900, lastWeek);
  await play(b, 10, 400, lastWeek, 'roulette');
  await play(c, 3, 700, lastWeek, 'friends');
  await play(d, 10, -50, lastWeek);
  await play(e, 10, 100, lastWeek);
  await weekly.onResult(e, 'bots', 5000, true, lastWeek);     // hands against bots don't count
  await weekly.onResult(e, 'durak', 1, true, lastWeek);

  // this week: b leads
  await play(b, 2, 60, now);

  const v = await weekly.view(b, now);
  assert.strictEqual(v.week, '2026-11-16');
  assert.deepStrictEqual(v.rows.map((r) => [r.username.split('_')[0], r.net, r.place]), [['wb', 60, 1]]);
  assert.deepStrictEqual([v.me.place, v.me.net, v.me.hands], [1, 60, 2]);
  // last week's winners: a, b, e (c has too few hands, d lost chips)
  assert.deepStrictEqual(v.last.winners.map((w) => [w.username.split('_')[0], w.place, w.prize]), [['wa', 1, 500], ['wb', 2, 300], ['we', 3, 150]]);
  assert.strictEqual(v.last.winners[2].net, 100, 'bot hands did not count');

  // prizes: paid once, with a statement entry and an announcement
  const before = await Promise.all([a, b, c, e].map(async (id) => (await coins.getStatus(id)).coins));
  const paid = await weekly.payout(now);
  assert.strictEqual(paid.length, 3);
  assert.strictEqual(await weekly.payout(now), null, 'second payout refused');
  const after = await Promise.all([a, b, c, e].map(async (id) => (await coins.getStatus(id)).coins));
  assert.deepStrictEqual(after.map((x, i) => x - before[i]), [500, 300, 0, 150]);
  assert.strictEqual((await coins.history(a))[0].reason, 'weekly:1');
  assert.strictEqual(announced.length, 1);
  assert(/Winners of the week/.test(announced[0]));

  console.log(`weekly ok (${store.kind})`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
