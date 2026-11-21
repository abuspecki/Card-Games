// Chess for chips: rules (perft), the doubling cube, draws, resigning, the clock,
// leaving, and whole games between bots — chips are never created or lost.
const assert = require('assert');
require('./chess-perft');
const { Chess } = require('../games/chess');

const total = (t) => t.seats.filter(Boolean).reduce((a, s) => a + s.chips, 0);
function table(stake = 100, minutes = 5) {
  const t = new Chess({ bigBlind: stake, minutes, startingStack: 5000 });
  t.onEvent = () => {};
  t.sit({ id: 'a', name: 'Anna' }); t.sit({ id: 'b', name: 'Ben' });
  assert(t.startHand());
  return t;
}
const idOf = (t, color) => t.seats[t.seatOfColor(color)].id;
const mv = (t, color, m) => { const r = t.act(idOf(t, color), 'move', m); assert(!r.error, `${m}: ${r.error}`); };

// fool's mate: black wins the stake
let t = table();
const blackSeat = t.seatOfColor('b');
mv(t, 'w', 'f2f3'); mv(t, 'b', 'e7e5'); mv(t, 'w', 'g2g4');
assert(t.act(idOf(t, 'w'), 'move', 'a2a3').error, 'not your turn');
assert(t.act(idOf(t, 'b'), 'move', 'd8d1').error, 'illegal move refused');
mv(t, 'b', 'd8h4');
assert.strictEqual(t.stage, 'showdown');
assert.strictEqual(t.results.winners[0].seat, blackSeat);
assert(/checkmate/.test(t.results.reason));
assert.strictEqual(t.seats[blackSeat].chips, 5100);
assert.strictEqual(total(t), 10000);

// the cube: double, take (×2), the cube now belongs to the taker; redouble, drop
t = table();
const w = idOf(t, 'w'), b = idOf(t, 'b');
assert(t.view(w).canDouble);
assert(!t.act(w, 'double').error);
assert(t.act(b, 'move', 'e7e5').error, 'answer the double first');
assert(!t.act(b, 'take').error);
assert.strictEqual(t.cube, 2);
assert.strictEqual(t.toAct, t.seatOfColor('w'), 'the doubler moves after the take');
assert(t.act(w, 'double').error, 'only the cube owner may double');
mv(t, 'w', 'e2e4');
assert(!t.act(b, 'double').error, 'the owner redoubles');
assert(!t.act(w, 'drop').error);
assert.strictEqual(t.results.winners[0].seat, t.seatOfColor('b'));
assert.strictEqual(t.results.winners[0].amount, 200, 'a dropped double pays the current stake (100 × 2)');
assert.strictEqual(total(t), 10000);

// no double beyond what both players can pay
t = table(100);
t.seats[0].chips = 150;
assert(!t.canDouble(t.white), 'not enough chips for a double');

// draw offer declined, then accepted: no chips move
t = table();
assert(!t.act(idOf(t, 'w'), 'draw').error);
assert(!t.act(idOf(t, 'b'), 'decline').error);
assert.strictEqual(t.toAct, t.seatOfColor('w'));
assert(t.act(idOf(t, 'w'), 'draw').error, 'one draw offer per move');
mv(t, 'w', 'd2d4');
assert(!t.act(idOf(t, 'b'), 'draw').error);
assert(!t.act(idOf(t, 'w'), 'accept').error);
assert(t.results.draw);
assert.deepStrictEqual(t.seats.map((s) => s.chips), [5000, 5000]);

// resigning (also when it is not your turn)
t = table();
assert(!t.act(idOf(t, 'b'), 'resign').error);
assert.strictEqual(t.results.winners[0].seat, t.seatOfColor('w'));

// the clock: out of time loses
t = table(100, 3);
t.turnStart = Date.now() - 3 * 60000 - 10;
assert(t.tick());
assert.strictEqual(t.results.winners[0].seat, t.seatOfColor('b'));
assert(/time/.test(t.results.reason));

// leaving mid-game loses the game
t = table();
t.leave(idOf(t, 'w'));
assert.strictEqual(t.stage, 'showdown');
assert.strictEqual(total(t), 5100, 'the one who stayed wins the stake');

// colours alternate between games
t = table();
const firstWhite = t.white;
t.act(idOf(t, 'w'), 'resign');
t.startHand();
assert.notStrictEqual(t.white, firstWhite);

// promotion (to a knight when asked, to a queen by default)
t = table();
t.pos.b = new Array(64).fill(''); t.pos.b[R_sq('e1')] = 'K'; t.pos.b[R_sq('e8')] = 'k'; t.pos.b[R_sq('a7')] = 'P'; t.pos.castle = '';
function R_sq(n) { return require('../games/chess-rules').sq(n); }
mv(t, 'w', 'a7a8n');
assert.strictEqual(t.pos.b[R_sq('a8')], 'N');

(async () => {
// bots play whole games (the weakest level, to keep the test quick)
let games = 0, decided = 0;
const tb = new Chess({ bigBlind: 100, minutes: 60, startingStack: 5000 });
tb.onEvent = () => {};
tb.sit({ id: 'x', name: 'X', isBot: true, botStyle: 'wild' }); tb.sit({ id: 'y', name: 'Y', isBot: true, botStyle: 'wild' });
for (let g = 0; g < 4; g++) {
  tb.seats.forEach((s) => { s.chips = 5000; });
  assert(tb.startHand());
  for (let n = 0; tb.isPlaying() && n < 600; n++) {
    const i = tb.toAct;
    const d = await tb.botAction(i);
    const r = tb.act(tb.seats[i].id, d.action, d.amount);
    assert(!r.error, `${d.action} ${d.amount}: ${r.error}`);
  }
  if (tb.isPlaying()) tb.act('x', 'resign');
  games++;
  if (!tb.results.draw) decided++;
  assert.strictEqual(total(tb), 10000, 'chips are kept');
}
// the bot answers a double and a draw offer at once
  const tq = table();
  tq.seats[tq.seatOfColor('b')].isBot = true;
  tq.act(idOf(tq, 'w'), 'double');
  assert.strictEqual((await tq.botAction(tq.seatOfColor('b'))).action, 'take', 'an even position: take');
  console.log(`chess ok — rules, cube, draws, clock, leaving, ${games} bot games (${decided} decided)`);
})().catch((e) => { console.error(e); process.exit(1); });
