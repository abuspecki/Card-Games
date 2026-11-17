// Development board (GitHub Issues): parsing the issue form, lanes, priorities.
const assert = require('assert');
const tb = require('../taskboard');

const formBody = '### Priorität\n\nP1 · Höchste – sofort\n\n### Bereich\n\nDesign & Layout\n\n### Was soll passieren?\n\nAlles grün und gold.\n\n### Woran erkenne ich, dass es fertig ist?\n\n_No response_';
const raw = [
  { number: 1, title: 'Grün & Gold', body: formBody, state: 'open', labels: [], comments: 0, html_url: 'u1', updated_at: '2026-11-17T01:00:00Z' },
  { number: 2, title: 'Roulette', body: 'freier Text', state: 'open', labels: [{ name: 'P2' }, { name: 'in Arbeit' }], comments: 2, html_url: 'u2' },
  { number: 3, title: 'Münzen', body: '', state: 'open', labels: [{ name: 'P4' }, { name: 'Frage' }], html_url: 'u3' },
  { number: 4, title: 'Alt', body: '', state: 'closed', labels: [{ name: 'P1' }], html_url: 'u4', closed_at: '2026-11-16T00:00:00Z' },
  { number: 5, title: 'Später', body: '', state: 'open', labels: [], html_url: 'u5' },
  { number: 6, title: 'PR', body: '', state: 'open', labels: [], pull_request: {}, html_url: 'u6' },
];

const one = tb.shape(raw[0]);
assert.strictEqual(one.priority, 1, 'priority from the form');
assert.strictEqual(one.area, 'Design & Layout');
assert.strictEqual(one.summary, 'Alles grün und gold.');
assert.strictEqual(one.doneWhen, null, '"_No response_" is empty');
assert.strictEqual(tb.shape(raw[1]).priority, 2, 'label wins');
assert.strictEqual(tb.shape(raw[4]).priority, 3, 'default medium');

(async () => {
  tb._reset();
  let calls = 0;
  const fake = async () => { calls++; return { ok: true, json: async () => raw }; };
  const b = await tb.board(fake);
  assert.deepStrictEqual(b.queue.map((i) => i.number), [1, 5], 'queue sorted by priority, PRs ignored');
  assert.deepStrictEqual(b.doing.map((i) => i.number), [2]);
  assert.deepStrictEqual(b.question.map((i) => i.number), [3]);
  assert.deepStrictEqual(b.done.map((i) => i.number), [4]);
  await tb.board(fake);
  assert.strictEqual(calls, 1, 'cached');
  const l = tb.links({ title: 'X', beschreibung: 'Y' });
  assert(/issues\/new\?template=aufgabe\.yml&title=X&beschreibung=Y/.test(l.newTask));
  tb._reset();
  await assert.rejects(tb.board(async () => ({ ok: false, status: 403 })));
  console.log('taskboard ok');
})().catch((e) => { console.error(e); process.exit(1); });
