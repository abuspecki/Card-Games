// Roulette engine: payouts, betting window, chips, bots and the lobby clock.
const assert = require('assert');
const { Roulette, WHEEL, SPOTS, payout, colorOf } = require('../games/roulette');

// Wheel and layout
assert.strictEqual(WHEEL.length, 37);
assert.deepStrictEqual([...WHEEL].sort((a, b) => a - b), Array.from({ length: 37 }, (_, i) => i));
assert.strictEqual(colorOf(0), 'green'); assert.strictEqual(colorOf(1), 'red'); assert.strictEqual(colorOf(2), 'black');
assert.strictEqual(SPOTS.red.nums.length, 18); assert.strictEqual(SPOTS.dozen2.nums[0], 13); assert.deepStrictEqual(SPOTS.col1.nums.slice(0, 3), [1, 4, 7]);
assert.strictEqual(payout('n17', 10, 17), 360, 'straight pays 35:1 plus stake');
assert.strictEqual(payout('red', 10, 1), 20);
assert.strictEqual(payout('red', 10, 0), 0, 'zero loses outside bets');
assert.strictEqual(payout('dozen3', 10, 30), 30);
assert.strictEqual(payout('col2', 10, 0), 0);

// A round with a fixed wheel
function table(seq) {
  let k = 0;
  return new Roulette({ bigBlind: 5, startingStack: 1000, rng: () => seq[k++ % seq.length] });
}
const pick = (n) => WHEEL.indexOf(n) / 37 + 0.001; // rng value that lands on n
const t = table([pick(17)]);
t.sit({ id: 'a', name: 'Ann' });
t.sit({ id: 'b', name: 'Ben' });
assert(t.startHand(0));
assert.strictEqual(t.stage, 'betting');
assert(t.act('a', 'bet', { spot: 'n17', amount: 10 }).ok);
assert(t.act('a', 'bet', { spot: 'black', amount: 20 }).ok);
assert(t.act('a', 'bet', { spot: 'red', amount: 4 }).error, 'below minimum');
assert(t.act('a', 'bet', { spot: 'nope', amount: 10 }).error, 'unknown spot');
assert(t.act('b', 'bet', { spot: 'odd', amount: 2000 }).error, 'more than the stack');
assert(t.act('b', 'bet', { spot: 'even', amount: 50 }).ok);
assert(t.act('b', 'undo').ok);
assert.strictEqual(t.view('b').seats[1].bets.length, 0, 'undo removes the last bet');
assert(t.act('b', 'bet', { spot: 'even', amount: 50 }).ok);
assert.strictEqual(t.seats[0].chips, 1000, 'chips are only taken when the wheel starts');
assert.strictEqual(t.view('a').limits.available, 970);
assert.strictEqual(t.tick(19999), false, 'still betting');
assert(t.tick(20000));
assert.strictEqual(t.stage, 'spinning');
assert.strictEqual(t.number, 17);
assert(t.act('a', 'bet', { spot: 'n1', amount: 10 }).error, 'no bets while spinning');
assert.strictEqual(t.seats[0].chips, 970);
assert(t.tick(26000));
assert.strictEqual(t.stage, 'showdown');
assert.strictEqual(t.seats[0].chips, 970 + 360 + 40, '17 is black and odd: straight + black win');
assert.strictEqual(t.seats[1].chips, 950, 'even loses');
assert.deepStrictEqual(t.results.winners.map((w) => w.seat), [0]);
assert.strictEqual(t.history[0], 17);
const rec = t.resultsForRecord();
assert.strictEqual(rec.length, 0, 'guests are not recorded');

// Repeat, double, ready -> early spin
const t2 = table([pick(0)]);
t2.sit({ id: 'a', name: 'Ann', accountId: 7 });
t2.startHand(0);
t2.act('a', 'bet', { spot: 'red', amount: 25 });
t2.act('a', 'ready');
assert(t2.deadline <= Date.now(), 'everyone ready: spin now');
t2.tick(Date.now()); t2.tick(Date.now() + 10000);
assert.strictEqual(t2.seats[0].chips, 975, 'zero: red loses');
assert.deepStrictEqual(t2.resultsForRecord()[0], { accountId: 7, mode: 'roulette', net: -25, won: false, pot: 0 });
t2.startHand(0);
assert(t2.act('a', 'repeat').ok);
assert(t2.act('a', 'double').ok);
assert.strictEqual(t2.view('a').seats[0].bet, 50);
assert(t2.act('a', 'clear').ok);
assert.strictEqual(t2.view('a').seats[0].bet, 0);
assert(t2.act('a', 'ready').error, 'ready needs a bet');

// Nobody bets: the betting window simply reopens; bots bet by themselves
const t3 = table([0.5, 0.2, 0.7, 0.1, 0.9, 0.3]);
t3.sit({ id: 'h', name: 'Human' });
t3.sit({ id: 'bot', name: 'Bot', isBot: true });
t3.startHand(0);
assert(t3.seats[1].bets.length > 0, 'bot placed bets');
assert(t3.tick(20000));
assert.strictEqual(t3.stage, 'betting', 'no human bet: keep betting');
assert.strictEqual(t3.deadline, 40000);

// Leaving while betting keeps your chips; the round goes on for others
const t4 = table([pick(5)]);
t4.sit({ id: 'a', name: 'Ann' }); t4.sit({ id: 'b', name: 'Ben' });
t4.startHand(0);
t4.act('a', 'bet', { spot: 'n5', amount: 10 });
t4.act('b', 'bet', { spot: 'n5', amount: 10 });
t4.leave('a');
t4.tick(20000); t4.tick(30000);
assert.strictEqual(t4.seats[1].chips, 1350);

// The lobby drives the clock
const { createLobby } = require('../tables');
const lobby = createLobby({ store: () => ({}), coins: () => ({}) });
assert(lobby.rooms.get('ROULETTE-1') && lobby.rooms.get('ROULETTE-2').highRoller);
assert.strictEqual(lobby.tableSummary(lobby.rooms.get('ROULETTE-1')).stakes, 'Bets from 5');
console.log('roulette ok');
process.exit(0);
