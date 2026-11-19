// Five Card Draw: bots play many hands; chips are never created or lost, every
// player always holds five different cards, the draw follows the rules.
const assert = require('assert');
const { Draw } = require('../games/draw');

const t = new Draw({ smallBlind: 5, bigBlind: 10, startingStack: 1000 });
t.onEvent = () => {};
for (let i = 0; i < 5; i++) t.sit({ id: 'p' + i, name: 'P' + i, isBot: true, botStyle: ['tight', 'normal', 'wild'][i % 3] });
const seated = () => t.seats.filter(Boolean);
let hands = 0, showdowns = 0, draws = 0;
for (let h = 0; h < 800; h++) {
  seated().forEach((s) => { if (s.chips === 0) s.chips = 1000; });
  const before = seated().reduce((a, s) => a + s.chips, 0);
  assert(t.startHand(), 'hand starts');
  for (let n = 0; t.isPlaying(); n++) {
    assert(n < 300, 'hand finishes');
    const i = t.toAct;
    const d = t.botAction(i);
    if (d.action === 'draw') draws++;
    const r = t.act(t.seats[i].id, d.action, d.amount);
    assert(!r.error, `${d.action}: ${r.error} (${t.stage})`);
    // nobody holds the same card twice, and no two players share a card
    const all = seated().filter((s) => s.inHand).flatMap((s) => s.hole);
    assert.strictEqual(new Set(all).size, all.length, 'cards are unique');
  }
  hands++;
  if (t.results.shown) showdowns++;
  seated().filter((s) => s.inHand).forEach((s) => assert.strictEqual(s.hole.length, 5));
  assert.strictEqual(seated().reduce((a, s) => a + s.chips, 0), before, 'chips are kept');
}
assert(showdowns > 50 && draws > 500, `showdowns ${showdowns}, draws ${draws}`);

// the draw rules: up to three cards, four only when keeping an ace
const u = new Draw({ smallBlind: 5, bigBlind: 10, startingStack: 1000 });
u.onEvent = () => {};
u.sit({ id: 'a', name: 'A' }); u.sit({ id: 'b', name: 'B' });
u.startHand();
while (u.stage === 'bet1') { const i = u.toAct; const lim = u.limits(i); u.act(u.seats[i].id, lim.toCall ? 'call' : 'check'); }
assert.strictEqual(u.stage, 'draw');
const i = u.toAct, me = u.seats[i];
assert(u.act(me.id, 'call').error, 'no betting during the draw');
me.hole = ['2s', '5d', '8c', 'Jh', 'Kd'];
assert(u.act(me.id, 'draw', [0, 1, 2, 3]).error, 'four only with an ace');
me.hole = ['2s', '5d', '8c', 'Jh', 'Ad'];
const kept = me.hole[4];
assert(!u.act(me.id, 'draw', [0, 1, 2, 3]).error, 'four when keeping an ace');
assert.strictEqual(me.hole[4], kept);
assert.strictEqual(me.drawn, 4);
// the other player stands pat, then the second betting round
const j = u.toAct;
assert(!u.act(u.seats[j].id, 'draw', []).error);
assert.strictEqual(u.stage, 'bet2');
// what others see: no cards of other players before the showdown
const view = u.view('a');
assert(view.seats.find((s) => s && s.name === 'B').hole === null);
assert.strictEqual(view.seats.find((s) => s && s.name === 'A').hole.length, 5);
// results are saved as Five Card Draw
u.seats.filter(Boolean).forEach((s) => { s.accountId = 1; });
while (u.isPlaying()) { const k = u.toAct; u.act(u.seats[k].id, 'check'); }
assert(u.resultsForRecord().every((r) => r.mode === 'draw'));
console.log(`draw ok — ${hands} bot hands, ${showdowns} showdowns`);
