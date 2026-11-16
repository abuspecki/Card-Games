const assert = require('assert');
const { Table } = require('../poker');
const bots = require('../bots');

// Equity sanity: aces beat a random hand most of the time; 7-2 does not.
const aa = bots.equity(['As', 'Ah'], [], 'holdem', 1, 2000);
const s72 = bots.equity(['7c', '2d'], [], 'holdem', 1, 2000);
assert(aa > 0.8 && aa < 0.9, 'AA equity ' + aa);
assert(s72 > 0.27 && s72 < 0.4, '72o equity ' + s72);
console.log(`equity ok (AA ${aa.toFixed(2)}, 72o ${s72.toFixed(2)})`);

// Bots vs a random player: legal actions, chips conserved, quick decisions.
let slowest = 0;
const profit = { bots: 0, random: 0 };
for (const variant of ['holdem', 'omaha', 'omaha5']) {
  for (let game = 0; game < 6; game++) {
    const t = new Table({ variant });
    const n = 2 + (game % 5);
    t.sit({ id: 'human', name: 'Random' });
    for (let i = 1; i < n; i++) t.sit({ id: 'b' + i, name: 'B' + i, isBot: true, botStyle: bots.randomStyle() });
    const total = n * 1000;
    for (let hand = 0; hand < 15 && t.canStart(); hand++) {
      t.startHand();
      let steps = 0;
      while (t.isPlaying()) {
        assert(++steps < 300, 'stuck');
        const i = t.toAct;
        const p = t.seats[i];
        let d;
        if (p.isBot) {
          const t0 = Date.now();
          d = bots.decide(t, i);
          slowest = Math.max(slowest, Date.now() - t0);
        } else {
          const lim = t.limits(i), r = Math.random();
          d = r < 0.2 ? { action: lim.toCall ? 'fold' : 'check' } : r < 0.75 || !lim.canRaise
            ? { action: lim.toCall ? 'call' : 'check' } : { action: 'raise', amount: lim.minTo + Math.random() * (lim.maxTo - lim.minTo) };
        }
        const res = t.act(p.id, d.action, d.amount);
        assert(!res.error, `${p.name} ${JSON.stringify(d)}: ${res.error}`);
      }
      assert.strictEqual(t.seats.reduce((a, s) => a + (s ? s.chips : 0), 0), total);
    }
    const h = t.seats[0];
    profit.random += h.chips - 1000;
  }
}
console.log(`bots ok — slowest decision ${slowest}ms, random player net result: ${profit.random}`);
