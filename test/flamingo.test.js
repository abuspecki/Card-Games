// Flamingo: deck, matching rules, action cards, wilds, drawing, bots, leaving.
const assert = require('assert');
const { Flamingo, buildDeck } = require('../games/flamingo');

const deck = buildDeck();
assert.strictEqual(deck.length, 108);
assert.strictEqual(new Set(deck).size, 108, 'unique card codes');

function table(n) {
  const t = new Flamingo({});
  for (let i = 0; i < n; i++) t.sit({ id: 'p' + i, name: 'P' + i });
  return t;
}
const setup = (t, top, hands, color) => {
  t.discard = [top]; t.color = color || top[0];
  hands.forEach((h, i) => { t.seats[i].hand = h.slice(); });
  t.toAct = 0; t.dir = 1;
};

// start
let t = table(3);
assert(t.startHand());
assert(t.seats.filter(Boolean).every((s) => s.hand.length === 7));
assert(/^[cvst][0-9]/.test(t.top()), 'starts on a number card');
assert.strictEqual(t.deck.length + 21 + 1, 108);

// matching colour / number, wrong card refused
t = table(3); t.startHand();
setup(t, 'c5a', [['c9a', 'v5a', 'v7a', 's2a'], ['t1a', 't2a'], ['s3a', 's4a']]);
assert.deepStrictEqual(t.moves(0).cards.sort(), ['c9a', 'v5a']);
assert(t.act('p0', 'play', { card: 'v7a' }).error, 'no match');
assert(t.act('p1', 'play', { card: 't1a' }).error, 'not your turn');
assert(t.act('p0', 'play', { card: 'v5a' }).ok);
assert.strictEqual(t.color, 'v');
assert.strictEqual(t.toAct, 1);

// skip
setup(t, 'c5a', [['cSa', 'c1a'], ['t1a', 't2a'], ['s3a', 's4a']]);
t.act('p0', 'play', { card: 'cSa' });
assert.strictEqual(t.toAct, 2, 'skip jumps over seat 1');
// reverse
setup(t, 'c5a', [['cRa', 'c1a'], ['t1a', 't2a'], ['s3a', 's4a']]);
t.act('p0', 'play', { card: 'cRa' });
assert.strictEqual(t.dir, -1);
assert.strictEqual(t.toAct, 2, 'reverse: play goes the other way');
// draw two
setup(t, 'c5a', [['cDa', 'c1a'], ['t1a', 't2a'], ['s3a', 's4a']]);
t.act('p0', 'play', { card: 'cDa' });
assert.strictEqual(t.seats[1].hand.length, 4, 'next player draws 2');
assert.strictEqual(t.toAct, 2, 'and is skipped');
// wild draw four needs a colour
setup(t, 'c5a', [['xFa', 'c1a'], ['t1a', 't2a'], ['s3a', 's4a']]);
assert(t.act('p0', 'play', { card: 'xFa' }).error, 'colour required');
assert(t.act('p0', 'play', { card: 'xFa', color: 't' }).ok);
assert.strictEqual(t.color, 't');
assert.strictEqual(t.seats[1].hand.length, 6);
assert.strictEqual(t.toAct, 2);
assert.deepStrictEqual(t.moves(2).cards, [], 's3a/s4a do not match teal');
// draw: play the drawn card or pass
setup(t, 'c5a', [['v1a'], ['t1a', 't2a'], ['s3a', 's4a']]);
t.deck.push('c7b');
assert(t.act('p0', 'pass').error, 'must draw first');
t.act('p0', 'draw');
assert.deepStrictEqual(t.moves(0), { cards: ['c7b'], canDraw: false, canPass: true, drew: 'c7b' });
assert(t.act('p0', 'play', { card: 'v1a' }).error, 'only the drawn card');
assert(t.act('p0', 'play', { card: 'c7b' }).ok);
setup(t, 'c5a', [['v1a'], ['t1a', 't2a'], ['s3a', 's4a']]);
t.deck.push('t9b');
t.act('p0', 'draw');
assert.strictEqual(t.toAct, 1, 'unplayable draw passes automatically');
// two players: reverse acts like skip
const t2 = table(2); t2.startHand();
setup(t2, 'c5a', [['cRa', 'c1a'], ['t1a']]);
t2.act('p0', 'play', { card: 'cRa' });
assert.strictEqual(t2.toAct, 0);
// winning
setup(t, 'c5a', [['c1a'], ['t1a', 't2a'], ['s3a', 's4a']]);
t.seats[0].accountId = 9;
t.act('p0', 'play', { card: 'c1a' });
assert.strictEqual(t.stage, 'showdown');
assert.strictEqual(t.results.winner, 0);
assert.deepStrictEqual(t.resultsForRecord(), [{ accountId: 9, mode: 'flamingo', net: 1, won: true, pot: 0 }]);
// leaving: last one standing wins
const t3 = table(2); t3.startHand();
t3.leave('p0');
assert.strictEqual(t3.stage, 'showdown');
assert.strictEqual(t3.results.winner, 1);

// many bot games: always legal, cards conserved, always end
let games = 0;
for (let g = 0; g < 500; g++) {
  const b = new Flamingo({});
  const n = 2 + (g % 5);
  for (let i = 0; i < n; i++) b.sit({ id: 'b' + i, name: 'B' + i, isBot: true });
  b.startHand();
  let steps = 0;
  while (b.isPlaying()) {
    assert(++steps < 5000, 'flamingo stuck');
    const i = b.toAct;
    const d = b.botAction(i);
    const r = b.act(b.seats[i].id, d.action, d.amount);
    assert(!r.error, r.error + ' ' + JSON.stringify(d));
    const all = [...b.deck, ...b.discard, ...b.seats.flatMap((s) => (s ? s.hand : []))];
    assert.strictEqual(all.length, 108, 'all cards accounted for');
  }
  games++;
}
console.log(`flamingo ok — ${games} bot games`);
