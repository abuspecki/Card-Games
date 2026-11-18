const assert = require('assert');
const { Table, eval5, bestHand } = require('../poker');
const e = (h) => eval5(h.split(' ')).score;
// Rankings
assert(e('As Ks Qs Js Ts') > e('9h 9d 9s 9c 2h'));
assert(e('9h 9d 9s 9c 2h') > e('3h 3d 3s 2c 2h'));
assert(e('3h 3d 3s 2c 2h') > e('2h 7h 9h Jh Kh'));
assert(e('2h 7h 9h Jh Kh') > e('5s 6d 7h 8c 9s'));
assert(e('5s 6d 7h 8c 9s') > e('As 2d 3h 4c 5s'), 'wheel is lowest straight');
assert(e('As 2d 3h 4c 5s') > e('Qs Qd Qh 4c 2s'));
assert(e('Ks Kd 4h 4c 2s') > e('Qs Qd Jh Jc As'));
assert(e('Ah Ad 9c 7s 3h') > e('Ah Ad 9c 7s 2h'), 'kicker');
assert.strictEqual(e('Ah Kd 9c 7s 3h'), e('As Kc 9d 7h 3s'), 'tie');
// Omaha must use exactly 2 hole cards: 4 spades on board + 1 in hand is not a flush
const om = bestHand('As Kd 7c 2h'.split(' '), '9s 8s 3s 4s Jd'.split(' '), 'omaha');
assert.notStrictEqual(om.name, 'Flush');
assert.strictEqual(bestHand('As Kd'.split(' '), '9s 8s 3s 4s Jd'.split(' '), 'holdem').name, 'Flush');
console.log('evaluator ok');

// Random simulations: chips are conserved and hands always finish.
for (const variant of ['holdem', 'omaha', 'omaha5']) {
  for (let game = 0; game < 300; game++) {
    const t = new Table({ variant, rotate: game % 3 === 0 });
    const n = 2 + (game % 7);
    for (let i = 0; i < n; i++) t.sit({ id: 'p' + i, name: 'P' + i });
    const total = n * 1000;
    for (let hand = 0; hand < 40 && t.canStart(); hand++) {
      assert(t.startHand());
      let steps = 0;
      while (t.isPlaying()) {
        assert(++steps < 500, 'hand stuck');
        const i = t.toAct;
        assert(i !== -1, 'no one to act during ' + t.stage);
        const p = t.seats[i];
        const lim = t.limits(i);
        const r = Math.random();
        let res;
        if (r < 0.15) res = t.act(p.id, 'fold');
        else if (r < 0.6 || !lim.canRaise) res = t.act(p.id, lim.toCall > 0 ? 'call' : 'check');
        else res = t.act(p.id, 'raise', lim.minTo + Math.random() * (lim.maxTo - lim.minTo + 1));
        assert(!res.error, res.error);
        const sum = t.seats.reduce((a, s) => a + (s ? s.chips + (t.isPlaying() ? s.totalBet : 0) : 0), 0);
        assert.strictEqual(sum, total, 'chips not conserved');
      }
      assert.strictEqual(t.seats.reduce((a, s) => a + (s ? s.chips : 0), 0), total);
      if (t.results.shown) assert.strictEqual(t.board.length, 5);
    }
  }
}
// Everyone folds before the river: the rest of the board is shown (display only).
{
  for (const foldAt of ['preflop', 'flop', 'turn']) {
    const t = new Table({ variant: 'holdem' });
    for (let i = 0; i < 3; i++) t.sit({ id: 'r' + i, name: 'R' + i });
    assert(t.startHand());
    const actor = () => t.seats[t.toAct];
    // everyone just calls/checks until the street we want
    let guard = 0;
    while (t.stage !== foldAt && guard++ < 50) { const p = actor(); const lim = t.limits(t.toAct); t.act(p.id, lim.toCall > 0 ? 'call' : 'check'); }
    assert.strictEqual(t.stage, foldAt);
    assert.deepStrictEqual(t.view('r0').runout, [], 'nothing shown while the hand runs');
    const boardBefore = t.board.slice();
    const total = () => t.seats.filter(Boolean).reduce((a, x) => a + x.chips, 0);
    const before = total() + t.pot();
    while (t.stage !== 'showdown') t.act(actor().id, 'fold');
    const v = t.view('r0');
    assert.deepStrictEqual(t.board, boardBefore, 'the real board is unchanged');
    assert.strictEqual(v.board.length + v.runout.length, 5, `${foldAt}: board filled up to the river`);
    const all = [...v.board, ...v.runout, ...t.seats.filter(Boolean).flatMap((x) => x.hole)];
    assert.strictEqual(new Set(all).size, all.length, 'no card twice');
    assert.strictEqual(total(), before, 'all chips accounted for');
    assert(t.log.some((l) => /would have been/.test(typeof l === 'string' ? l : l.text || '')), 'log line');
    assert(t.startHand());
    assert.deepStrictEqual(t.view('r0').runout, [], 'cleared for the next hand');
  }
}

console.log('simulation ok');
