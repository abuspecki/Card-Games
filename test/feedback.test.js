// Feedback centre: topics, duplicate merging and importance ranking.
const assert = require('assert');
const { analyze, topicOf, levelOf } = require('../feedback');

const now = Date.now();
const at = (daysAgo) => new Date(now - daysAgo * 86400000).toISOString();
let id = 1;
const f = (category, message, username, daysAgo = 10, status = 'new') => ({ id: id++, category, message, username, created_at: at(daysAgo), status, task_id: null });

assert.strictEqual(topicOf('The blackjack dealer is too slow').key, 'games');
assert.strictEqual(topicOf('I want more coins from the daily bonus').key, 'economy');
assert.strictEqual(topicOf('My iPhone shows the buttons too small').key, 'mobile');
assert.strictEqual(levelOf(6.5), 'critical');
assert.strictEqual(levelOf(1), 'low');

const list = [
  f('bug', 'The game crashes when I fold on my phone and I lose my chips', 'ann', 1),
  f('bug', 'Game crashes after I fold on the phone, chips lost', 'bob', 2),
  f('bug', 'Crash when folding on phone — my chips are gone', 'cid', 5),
  f('suggestion', 'Please add a dark theme for the lobby', 'ann'),
  f('feature', 'Could you add Omaha poker again?', 'dan'),
  f('general', 'Nice site, love the colours', 'eve'),
  f('bug', 'The pot label overlaps the cards on my tablet', 'fay', 20, 'resolved'),
];
const r = analyze(list, now);

// The three crash reports from three people merge into one critical item at the top.
const top = r.clusters[0];
assert.strictEqual(top.count, 3, 'duplicates merged');
assert.strictEqual(top.reporters, 3);
assert.strictEqual(top.level, 'critical');
assert(top.score > r.clusters[1].score);
// Cosmetic praise ranks low; resolved items sink below open ones.
const praise = r.clusters.find((c) => /Nice site/.test(c.message));
assert.strictEqual(praise.level, 'low');
assert.strictEqual(r.clusters[r.clusters.length - 1].open, 0, 'resolved last');
assert.strictEqual(r.summary.total, 7);
assert.strictEqual(r.summary.open, 6);
assert.strictEqual(r.summary.byLevel.critical, 1);
// Unrelated messages do not merge.
assert.strictEqual(r.clusters.length, 5); // 3 duplicates merged + 4 distinct topics
console.log('feedback ok');
