// Feedback centre: sorts raw feedback into topics, merges near-duplicates and
// ranks the result by importance, so the owner sees what matters first.
// Pure functions — easy to test and to reuse in the dashboard API.

const TOPICS = [ // most specific first: the first match wins
  ['mobile', 'Phones & tablets', /\b(phone|mobile|tablet|ipad|iphone|android|touch|portrait|landscape|handy|smartphone)\b/i],
  ['performance', 'Speed & connection', /\b(slow|lag|laggy|loading|load|freeze|freezes|frozen|disconnect|connection|timeout|langsam|hängt|haengt)\b/i],
  ['accounts', 'Accounts & friends', /\b(login|log in|sign in|password|account|register|friend|friends|profile|invite|ban|username|passwort|freund)\b/i],
  ['economy', 'Chips, coins & shop', /\b(chip|chips|coin|coins|shop|bank|exchange|bonus|daily|buy|price|refill|bankrupt|münze|muenze|kaufen)\b/i],
  ['games', 'Games & tables', /\b(hold'?em|poker|blackjack|durak|dealer|bot|bots|card|cards|table|tables|hand|pot|bet|raise|fold|trump|deck|round|game|spiel|karte|tisch)\b/i],
  ['design', 'Design & layout', /\b(design|colou?r|layout|font|look|ugly|dark|light|theme|style|button|menu|overlap|overlaps|small|big|align|hässlich|farbe)\b/i],
];
const SEVERE = /\b(crash|crashes|crashed|broken|can'?t|cannot|can ?not|doesn'?t work|does not work|not working|won'?t|error|bug|stuck|lost|lose my|disappear|disappeared|missing|freeze|frozen|kaputt|geht nicht|funktioniert nicht|fehler|absturz|verloren)\b/i;
const NOTABLE = /\b(overlap|overlaps|wrong|confusing|annoying|hard to|unclear|weird|strange|slow|small|too big|cut off|nervig|falsch)\b/i;
const STOP = new Set('the a an and or but is are was were be to of in on at for with it this that i my me you your we our it\'s its please would like could should can just also very so not no do does did have has had when then than there their they them from as by if all any some more most much many'.split(' '));

const BASE = { bug: 3, feature: 2, suggestion: 1.5, general: 1 };
const LEVELS = [['critical', 6], ['high', 4], ['medium', 2.5], ['low', 0]];

// Very small stemmer so "crashes"/"crashing"/"crashed" all count as "crash".
const stem = (w) => w.replace(/(ing|ed|es|s)$/, (m) => (w.length - m.length >= 3 ? '' : m));
const words = (text) => new Set(String(text).toLowerCase().replace(/[^a-z0-9äöüß' ]+/g, ' ').split(/\s+/)
  .filter((w) => w.length > 2 && !STOP.has(w)).map(stem));
// Overlap measured against the shorter message: short reports share fewer words.
function similarity(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / Math.min(a.size, b.size);
}

// The topic with the most keyword hits wins (device words count double,
// ties go to the more specific topic listed first).
const WEIGHT = { mobile: 2 };
function topicOf(text) {
  let best = null;
  for (const [key, label, re] of TOPICS) {
    const hits = (String(text).match(new RegExp(re.source, 'gi')) || []).length * (WEIGHT[key] || 1);
    if (hits && (!best || hits > best.hits)) best = { key, label, hits };
  }
  return best ? { key: best.key, label: best.label } : { key: 'other', label: 'Other' };
}

// Importance of a single message (before merging).
function scoreOne(f, now = Date.now()) {
  let s = BASE[f.category] ?? 1;
  if (SEVERE.test(f.message)) s += 3;
  else if (NOTABLE.test(f.message)) s += 1;
  const ageDays = (now - new Date(f.created_at).getTime()) / 86400000;
  if (ageDays < 3) s += 0.5;           // fresh reports get a small nudge
  return s;
}

const levelOf = (score) => LEVELS.find(([, min]) => score >= min)[0];

// Group feedback into clusters of near-duplicates and rank them.
function analyze(list, now = Date.now()) {
  const items = list.map((f) => ({ ...f, _w: words(f.message), _score: scoreOne(f, now), _topic: topicOf(f.message) }));
  const clusters = [];
  for (const it of items) {
    let home = null;
    for (const c of clusters) {
      if (c.topic.key !== it._topic.key) continue;
      if (it._w.size >= 3 && similarity(c.words, it._w) >= 0.6) { home = c; break; }
    }
    if (!home) { home = { topic: it._topic, words: new Set(it._w), items: [] }; clusters.push(home); }
    home.items.push(it);
    for (const w of it._w) home.words.add(w);
  }
  const out = clusters.map((c) => {
    const top = Math.max(...c.items.map((i) => i._score));
    const reporters = new Set(c.items.map((i) => i.username || `guest#${i.id}`)).size;
    const score = Math.round((top + Math.log2(reporters) * 1.5) * 10) / 10; // several people reporting it raises importance
    const open = c.items.filter((i) => i.status !== 'resolved');
    const lead = c.items.slice().sort((a, b) => b._score - a._score || b.id - a.id)[0];
    return {
      topic: c.topic.key, topicLabel: c.topic.label,
      score, level: levelOf(score),
      count: c.items.length, reporters, open: open.length,
      category: lead.category,
      title: summarize(lead.message),
      message: lead.message,
      ids: c.items.map((i) => i.id),
      taskId: (c.items.find((i) => i.task_id) || {}).task_id || null,
      latest: c.items.reduce((m, i) => (new Date(i.created_at) > new Date(m) ? i.created_at : m), c.items[0].created_at),
      items: c.items.map((i) => ({ id: i.id, username: i.username, category: i.category, message: i.message, status: i.status, created_at: i.created_at })),
    };
  });
  out.sort((a, b) => (b.open > 0) - (a.open > 0) || b.score - a.score || new Date(b.latest) - new Date(a.latest));
  const summary = { total: list.length, open: list.filter((f) => f.status !== 'resolved').length, clusters: out.length, byLevel: {}, byTopic: {} };
  for (const c of out) {
    if (!c.open) continue;
    summary.byLevel[c.level] = (summary.byLevel[c.level] || 0) + 1;
    summary.byTopic[c.topicLabel] = (summary.byTopic[c.topicLabel] || 0) + 1;
  }
  return { summary, clusters: out };
}

// A short title for a task made from feedback.
function summarize(text) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  const first = t.split(/(?<=[.!?])\s/)[0];
  return (first.length > 90 ? first.slice(0, 87) + '…' : first) || 'Feedback';
}

// Feedback importance -> task priority (1 = highest).
const priorityFor = (level) => ({ critical: 1, high: 2, medium: 3, low: 4 }[level] || 3);

module.exports = { analyze, scoreOne, topicOf, similarity, words, levelOf, priorityFor, TOPICS };
