// Gold Rush: multipliers, digging, cave-ins, cash-out, limits, house edge, shutdown.
const assert = require('assert');
const { createGoldRush, LEVELS, EDGE, multiplier, ladder } = require('../goldrush');

// a tiny wallet: chips + chips held for running digs
function fakeCtx() {
  const w = { chips: 10000, in_play: 0 }; const records = []; const rewards = [];
  const coins = {
    async buyIn(u, amount, min) { if (w.chips < min) return { error: 'Not enough chips' }; const t = Math.min(w.chips, amount); w.chips -= t; w.in_play += t; return { amount: t }; },
    async cashOut(u, amount, boughtIn) { w.chips += amount; w.in_play -= boughtIn; return {}; },
  };
  return { w, records, rewards, ctx: { coins: () => coins, store: () => ({ recordHand: async (...a) => records.push(a) }), reward: async (u, r) => rewards.push(r) } };
}
const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };

(async () => {
  // multipliers: rising, same house edge everywhere
  for (const k of Object.keys(LEVELS)) {
    const l = ladder(k);
    assert.strictEqual(l.length, LEVELS[k].depth);
    for (let i = 1; i < l.length; i++) assert(l[i] > l[i - 1], 'multiplier rises');
    for (let s = 1; s <= LEVELS[k].depth; s++) {
      const ev = Math.pow(LEVELS[k].p, s) * multiplier(k, s);
      assert(ev <= 1 - EDGE + 1e-9 && ev > 1 - EDGE - 0.01, `edge ${k} step ${s}: ${ev}`);
    }
  }
  assert.strictEqual(multiplier('medium', 1), 1.15);

  // dig twice, cash out
  let f = fakeCtx();
  let g = createGoldRush(f.ctx, { rand: seq([0.1]) });          // always safe
  assert((await g.start(1, 5, 'easy')).error, 'minimum stake');
  assert((await g.start(1, 100, 'nope')).error, 'level');
  assert((await g.start(1, 20000, 'easy')).error, 'maximum stake');
  let r = await g.start(1, 100, 'medium');
  assert(r.ok && f.w.chips === 9900 && f.w.in_play === 100, 'stake held like table chips');
  assert((await g.start(1, 100, 'medium')).error, 'one dig at a time');
  r = await g.dig(1); assert.strictEqual(r.round.step, 1);
  r = await g.dig(1); assert.strictEqual(r.round.multiplier, multiplier('medium', 2));
  r = await g.cashout(1);
  assert.strictEqual(r.payout, Math.floor(100 * multiplier('medium', 2)));
  assert.strictEqual(f.w.chips, 9900 + r.payout); assert.strictEqual(f.w.in_play, 0);
  assert.deepStrictEqual(f.records[0].slice(1), ['goldrush', r.payout - 100, true, r.payout - 100]);
  assert.strictEqual(f.rewards.length, 1, 'a win earns coins');
  assert((await g.dig(1)).error, 'round over');

  // cave-in
  f = fakeCtx(); g = createGoldRush(f.ctx, { rand: seq([0.1, 0.99]) });
  await g.start(1, 200, 'hard'); await g.dig(1);
  r = await g.dig(1);
  assert(r.collapsed && r.lost === 200);
  assert.strictEqual(f.w.chips, 9800); assert.strictEqual(f.w.in_play, 0);
  assert.strictEqual(f.records[0][2], -200);

  // cash out before digging: stake back
  f = fakeCtx(); g = createGoldRush(f.ctx, { rand: seq([0.1]) });
  await g.start(1, 300, 'easy'); r = await g.cashout(1);
  assert.strictEqual(r.payout, 300); assert.strictEqual(f.w.chips, 10000);

  // reaching the bottom pays out automatically
  f = fakeCtx(); g = createGoldRush(f.ctx, { rand: seq([0.01]) });
  await g.start(1, 10, 'extreme');
  for (let i = 0; i < LEVELS.extreme.depth - 1; i++) await g.dig(1);
  r = await g.dig(1);
  assert(r.bottom && r.payout === Math.floor(10 * multiplier('extreme', LEVELS.extreme.depth)));
  assert.strictEqual(g.state(1).round, null);

  // parallel requests are handled one after another
  f = fakeCtx(); g = createGoldRush(f.ctx, { rand: seq([0.1]) });
  await g.start(1, 100, 'easy');
  const res = await Promise.all([g.cashout(1), g.cashout(1), g.dig(1)]);
  assert.strictEqual(res.filter((x) => x.ok).length, 1, 'only one cash-out');
  assert.strictEqual(f.w.chips, 10000);

  // shutdown pays running digs
  f = fakeCtx(); g = createGoldRush(f.ctx, { rand: seq([0.1]) });
  await g.start(1, 100, 'easy'); await g.dig(1);
  await g.cashOutAll();
  assert.strictEqual(f.w.chips, 9900 + Math.floor(100 * multiplier('easy', 1))); assert.strictEqual(f.w.in_play, 0);

  // long-run return close to 97 % (cash out after 3 tunnels on medium)
  f = fakeCtx(); f.w.chips = 1e9; g = createGoldRush(f.ctx);
  let staked = 0, back = 0;
  for (let i = 0; i < 20000; i++) {
    await g.start(1, 100, 'medium'); staked += 100;
    let dead = false;
    for (let s = 0; s < 3 && !dead; s++) dead = !!(await g.dig(1)).collapsed;
    if (!dead) back += (await g.cashout(1)).payout;
  }
  const rtp = back / staked;
  assert(rtp > 0.93 && rtp < 1.01, 'return to player ' + rtp);
  console.log(`goldrush ok — RTP ${(rtp * 100).toFixed(1)} %`);
})().catch((e) => { console.error(e); process.exit(1); });
