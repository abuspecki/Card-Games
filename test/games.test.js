const assert = require('assert');
const { Blackjack, handTotal, bestMove } = require('../games/blackjack');
const { Durak } = require('../games/durak');

// ---------- Blackjack ----------
assert.deepStrictEqual(handTotal(['As', 'Kd']), { total: 21, soft: true });
assert.deepStrictEqual(handTotal(['As', 'As', '9d']), { total: 21, soft: true });
assert.deepStrictEqual(handTotal(['Ks', '7d', '9c']), { total: 26, soft: false });
assert.strictEqual(bestMove(['Ts', '6d'], '9h', { canDouble: true }), 'hit');
assert.strictEqual(bestMove(['Ts', '6d'], '5h', { canDouble: true }), 'stand');
assert.strictEqual(bestMove(['6s', '5d'], '6h', { canDouble: true }), 'double');
assert.strictEqual(bestMove(['8s', '8d'], 'Th', { canSplit: true, canDouble: true }), 'split');

// Rigged shoe: cards are drawn from the end of the array.
function rigged(cards) { const t = new Blackjack(); t.draw = () => cards.shift(); return t; }
{ // player 20 vs dealer 19 -> wins 1:1
  const t = rigged(['Ts', 'Kd', '9h', 'Tc']); // player T K, dealer 9 T
  t.sit({ id: 'p', name: 'P' }); t.startHand(); t.act('p', 'bet', 100); t.act('p', 'stand');
  assert.strictEqual(t.seats[0].chips, 1100); assert.strictEqual(t.stage, 'showdown');
}
{ // blackjack pays 3:2
  const t = rigged(['As', 'Kd', '9h', '8c']);
  t.sit({ id: 'p', name: 'P' }); t.startHand(); t.act('p', 'bet', 100);
  assert.strictEqual(t.seats[0].chips, 1150);
}
{ // dealer blackjack beats 20, player loses only the bet
  const t = rigged(['Ts', 'Kd', 'Ah', 'Kc']);
  t.sit({ id: 'p', name: 'P' }); t.startHand(); t.act('p', 'bet', 100);
  assert.strictEqual(t.seats[0].chips, 900); assert.strictEqual(t.stage, 'showdown');
}
{ // double down on 11, get a 10 -> 21 vs dealer 18: wins 2x bet
  const t = rigged(['6s', '5d', '9h', '9c', 'Td']);
  t.sit({ id: 'p', name: 'P' }); t.startHand(); t.act('p', 'bet', 100); t.act('p', 'double');
  assert.strictEqual(t.seats[0].chips, 1200);
}
{ // split 8s: 8+3=11 then stand... hands: [8,T]=18, [8,9]=17 vs dealer 17 (T 7)
  const t = rigged(['8s', '8d', 'Th', '7c', 'Td', '9s']);
  t.sit({ id: 'p', name: 'P' }); t.startHand(); t.act('p', 'bet', 100); t.act('p', 'split');
  t.act('p', 'stand'); t.act('p', 'stand');
  assert.strictEqual(t.seats[0].chips, 1100); // +100 win, push 0
}
{ // push returns the bet; bust loses
  const t = rigged(['Ts', '7d', 'Th', '7c', 'Kd']);
  t.sit({ id: 'p', name: 'P' }); t.startHand(); t.act('p', 'bet', 50); t.act('p', 'hit');
  assert.strictEqual(t.seats[0].chips, 950);
}
// Many random bot hands with several players: chips never negative, hands always finish.
for (let g = 0; g < 300; g++) {
  const t = new Blackjack();
  const n = 1 + (g % 6);
  for (let i = 0; i < n; i++) t.sit({ id: 'b' + i, name: 'B' + i, isBot: true });
  for (let h = 0; h < 20 && t.canStart(); h++) {
    t.startHand();
    let steps = 0;
    while (t.isPlaying()) {
      assert(++steps < 200, 'blackjack stuck');
      const d = t.botAction(t.toAct);
      const r = t.act(t.seats[t.toAct].id, d.action, d.amount);
      assert(!r.error, r.error + ' ' + JSON.stringify(d));
    }
    for (const s of t.seats) if (s) assert(s.chips >= 0);
  }
}
console.log('blackjack ok');

// ---------- Durak ----------
let durakGames = 0, draws = 0;
for (let g = 0; g < 2000; g++) {
  const t = new Durak();
  const n = 2 + (g % 5);
  for (let i = 0; i < n; i++) t.sit({ id: 'b' + i, name: 'B' + i, isBot: true });
  t.startHand();
  let steps = 0;
  while (t.isPlaying()) {
    assert(++steps < 2000, 'durak stuck');
    const i = t.toAct;
    const mv = t.moves(i);
    assert(mv, 'player to act has no moves');
    assert(mv.cards.length || mv.canTake || mv.canPass, 'player to act cannot do anything');
    const d = g % 2 ? t.botAction(i) : (() => { // half the games: random legal moves
      // (a defender who can beat usually does — always taking could pass the same
      // cards back and forth forever, which no real player would do)
      if (mv.canTake && mv.cards.length && Math.random() < 0.85) return { action: 'play', amount: mv.cards[Math.floor(Math.random() * mv.cards.length)] };
      const opts = mv.cards.map((c) => ({ action: 'play', amount: c }));
      if (mv.canTake) opts.push({ action: 'take' });
      if (mv.canPass) opts.push({ action: 'pass' });
      return opts[Math.floor(Math.random() * opts.length)];
    })();
    const r = t.act(t.seats[i].id, d.action, d.amount);
    assert(!r.error, r.error + ' ' + JSON.stringify(d) + ' phase ' + t.phase);
    // All 36 cards are always somewhere: deck, hands, table or discarded.
    const inPlay = t.deck.length + t.seats.reduce((a, s) => a + (s ? s.hand.length : 0), 0)
      + t.table.reduce((a, p) => a + (p.d ? 2 : 1), 0);
    assert(inPlay <= 36);
    const all = [...t.deck, ...t.seats.flatMap((s) => (s ? s.hand : [])), ...t.table.flatMap((p) => (p.d ? [p.a, p.d] : [p.a]))];
    assert.strictEqual(new Set(all).size, all.length, 'duplicate card');
    for (const p of t.table) if (p.d) assert(t.beats(p.d, p.a), 'illegal defense');
  }
  durakGames++;
  if (t.results.durak === -1) draws++;
  else assert(t.seats[t.results.durak].hand.length > 0, 'durak should hold cards');
}
console.log(`durak ok — ${durakGames} games, ${draws} draws`);
