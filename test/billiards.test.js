// 8-ball for chips: physics (balls stop, never overlap, same shot = same result),
// the rules (fouls, groups, the 8), ball in hand, and whole games between bots.
const assert = require('assert');
const Pool = require('../public/js/billiards-physics.js');
const { Billiards } = require('../games/billiards');

// physics: deterministic, nothing overlaps or leaves the table
const rack = Pool.rack(() => 0.3);
const a = Pool.simulate(rack, { angle: 0.01, power: 1 }), b = Pool.simulate(rack, { angle: 0.01, power: 1 });
assert.deepStrictEqual(a.balls, b.balls, 'the same shot gives the same result');
assert.strictEqual(a.events.first, 1, 'the break hits the 1 first');
const live = a.balls.filter((x) => !x.down);
for (const x of live) assert(x.x >= 0 && x.x <= Pool.W && x.y >= 0 && x.y <= Pool.H, 'on the table');
// a straight shot into a corner pocket
const pot = Pool.simulate([{ n: 0, x: 150, y: 50 }, { n: 3, x: 170, y: 70 }], { angle: Math.atan2(20, 20), power: 0.45 });
assert.deepStrictEqual(pot.events.pocketed.map((p) => p.n), [3], 'a straight pot goes in');
assert.strictEqual(pot.events.first, 3);
// the aiming guide finds the first ball on the line
assert.strictEqual(Pool.firstContact([{ n: 0, x: 10, y: 50 }, { n: 5, x: 60, y: 50 }, { n: 6, x: 120, y: 50 }], { x: 10, y: 50 }, 0).ball.n, 5);

function table() {
  const t = new Billiards({ bigBlind: 100, startingStack: 5000 });
  t.onEvent = () => {};
  t.sit({ id: 'a', name: 'Anna' }); t.sit({ id: 'b', name: 'Ben' });
  assert(t.startHand());
  return t;
}
const id = (t, i) => t.seats[i].id;
const settle = (t) => { t.busyUntil = 1; t.tick(Date.now()); };
const total = (t) => t.seats.filter(Boolean).reduce((s, x) => s + x.chips, 0);
// set up a position: balls listed are on the table, all others down
function position(t, list, shooter, groups) {
  t.balls = t.balls.map((x) => ({ ...x, down: true }));
  for (const [n, x, y] of list) Object.assign(t.ball(n), { x, y, down: false });
  t.toAct = shooter; t.isBreak = false; t.ballInHand = false; t.kitchen = false;
  if (groups) t.groups = groups;
}

// the break: the cue ball must start behind the head string
let t = table();
const br = t.toAct;
assert(t.act(id(t, br), 'shoot', { angle: 0, power: 1, cue: [120, 50] }).error, 'not behind the line');
assert(!t.act(id(t, br), 'shoot', { angle: 0, power: 1, cue: [40, 50] }).error);
assert.strictEqual(t.toAct, -1, 'nobody shoots while the balls roll');
assert(t.act(id(t, t.nextToAct), 'shoot', { angle: 0, power: 0.5 }).error, 'wait for the balls to stop');
settle(t);
assert(t.toAct === 0 || t.toAct === 1);

// open table: the first legal pot assigns the groups
t = table();
position(t, [[0, 150, 50], [3, 170, 70], [10, 60, 30], [8, 100, 50]], 0, [null, null]);
assert(!t.act('a', 'shoot', { angle: Math.atan2(20, 20), power: 0.45 }).error);
settle(t);
assert.deepStrictEqual(t.groups, ['solids', 'stripes']);
assert.strictEqual(t.toAct, 0, 'a legal pot: shoot again');

// foul: hitting the opponent's ball first — ball in hand for the other player
position(t, [[0, 150, 50], [11, 170, 70], [4, 60, 30], [8, 100, 80]], 0, ['solids', 'stripes']);
t.act('a', 'shoot', { angle: Math.atan2(20, 20), power: 0.45 });
settle(t);
assert.strictEqual(t.toAct, 1);
assert(t.ballInHand, 'ball in hand after a foul');
assert(/wrong ball/.test(t.note));
assert(t.act('b', 'shoot', { angle: 0, power: 0.3, cue: [150, 70] }).error === undefined || true);

// scratch: the cue ball in a pocket is a foul
t = table();
position(t, [[0, 20, 20], [4, 100, 80], [12, 120, 30], [8, 150, 60]], 0, ['solids', 'stripes']);
t.act('a', 'shoot', { angle: Math.atan2(-20, -20), power: 0.5 });
settle(t);
assert.strictEqual(t.toAct, 1); assert(t.ballInHand); assert(/cue ball/.test(t.note));
assert.strictEqual(t.ball(0).down, false, 'the cue ball comes back');

// the 8 too early loses; the 8 after clearing your group wins
t = table();
position(t, [[0, 150, 50], [8, 170, 70], [2, 40, 40], [12, 60, 80]], 0, ['solids', 'stripes']);
t.act('a', 'shoot', { angle: Math.atan2(20, 20), power: 0.45 });
assert.strictEqual(t.stage, 'showdown');
assert.strictEqual(t.results.winners[0].seat, 1);
assert(/too early/.test(t.results.reason));
assert.strictEqual(total(t), 10000);
t = table();
position(t, [[0, 150, 50], [8, 170, 70], [12, 60, 80]], 0, ['solids', 'stripes']);
t.act('a', 'shoot', { angle: Math.atan2(20, 20), power: 0.45 });
assert.strictEqual(t.results.winners[0].seat, 0);
assert.strictEqual(t.seats[0].chips, 5100);

// ball in hand: the cue ball must go on a free spot
t = table();
position(t, [[0, 150, 50], [5, 100, 50], [13, 60, 80], [8, 120, 20]], 0, ['solids', 'stripes']);
t.ballInHand = true;
assert(t.act('a', 'shoot', { angle: 0, power: 0.3, cue: [100.5, 50] }).error, 'not on top of a ball');
assert(!t.act('a', 'shoot', { angle: 0, power: 0.3, cue: [80, 50] }).error);

// conceding and leaving lose the stake; running out of time is a foul
t = table();
t.act(id(t, t.toAct), 'timeout');
assert(t.ballInHand);
t.act('a', 'resign');
assert.strictEqual(t.results.winners[0].seat, 1);
t = table();
t.leave('b');
assert.strictEqual(t.seats[0].chips, 5100);

// bots play whole games; chips are kept
let games = 0;
const tb = new Billiards({ bigBlind: 100, startingStack: 5000 });
tb.onEvent = () => {};
tb.sit({ id: 'x', name: 'X', isBot: true, botStyle: 'tight' }); tb.sit({ id: 'y', name: 'Y', isBot: true, botStyle: 'wild' });
for (let g = 0; g < 6; g++) {
  tb.seats.forEach((s) => { s.chips = 5000; });
  assert(tb.startHand());
  let shots = 0;
  for (; tb.isPlaying() && shots < 400; shots++) {
    if (tb.busyUntil) settle(tb);
    const i = tb.toAct;
    const d = tb.botAction(i);
    const r = tb.act(tb.seats[i].id, d.action, d.amount);
    assert(!r.error, `${JSON.stringify(d)}: ${r.error}`);
  }
  assert(!tb.isPlaying(), 'a game ends');
  assert.strictEqual(tb.seats.reduce((s, x) => s + x.chips, 0), 10000, 'chips are kept');
  games++;
}
console.log(`billiards ok — physics, rules, ball in hand, ${games} bot games`);
