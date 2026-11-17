// =========================================================
// Development board — backed by GitHub Issues.
//
// Lessons from the first board: tasks lived in the site's own database behind
// a developer key, which Claude could not reliably reach, and tasks had no
// details. Now every task is a GitHub issue in the (public) repository:
//   * Claude can always read, comment on and close issues;
//   * the owner writes them with a form that asks for the details up front;
//   * the owner dashboard reads the public issue list — no keys, no secrets.
//
// Labels used:  P1–P4 (priority), "in Arbeit" (being worked on),
//               "Frage" (Claude is waiting for an answer from the owner).
// =========================================================
const REPO = process.env.TASK_REPO || 'abuspecki/Card-Games';
const CACHE_MS = 2 * 60 * 1000;   // GitHub allows 60 anonymous requests an hour
let cache = { at: 0, data: null };

const PRIO_LABEL = { P1: 1, P2: 2, P3: 3, P4: 4 };

// Priority from a P1–P4 label, else from the issue form's "Priorität" answer.
function priorityOf(issue) {
  for (const l of issue.labels) if (PRIO_LABEL[l]) return PRIO_LABEL[l];
  const m = /###\s*Priorit[äa]t\s*\n+\s*P?([1-4])/i.exec(issue.body || '');
  return m ? Number(m[1]) : 3;
}

// "### Heading\n\ntext" sections from the issue form, as { heading: text }.
function sections(body) {
  const out = {};
  String(body || '').split(/^###\s+/m).slice(1).forEach((part) => {
    const nl = part.indexOf('\n');
    const head = part.slice(0, nl).trim();
    const text = part.slice(nl + 1).trim();
    if (head && text && text !== '_No response_') out[head] = text;
  });
  return out;
}

function shape(raw) {
  const labels = (raw.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
  const issue = {
    number: raw.number,
    title: raw.title,
    url: raw.html_url,
    state: raw.state,
    labels,
    body: raw.body || '',
    comments: raw.comments || 0,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    closed_at: raw.closed_at,
    author: raw.user && raw.user.login,
  };
  const s = sections(issue.body);
  issue.priority = priorityOf(issue);
  issue.area = s['Bereich'] || null;
  issue.summary = (s['Was soll passieren?'] || s['Beschreibung'] || (Object.keys(s).length ? '' : issue.body)).slice(0, 400);
  issue.doneWhen = s['Woran erkenne ich, dass es fertig ist?'] || null;
  issue.lane = issue.state === 'closed' ? 'done'
    : labels.includes('Frage') ? 'question'
      : labels.includes('in Arbeit') ? 'doing' : 'queue';
  return issue;
}

function group(issues) {
  const byPrio = (a, b) => a.priority - b.priority || a.number - b.number;
  return {
    question: issues.filter((i) => i.lane === 'question').sort(byPrio),
    doing: issues.filter((i) => i.lane === 'doing').sort(byPrio),
    queue: issues.filter((i) => i.lane === 'queue').sort(byPrio),
    done: issues.filter((i) => i.lane === 'done').sort((a, b) => new Date(b.closed_at) - new Date(a.closed_at)).slice(0, 30),
  };
}

async function board(fetchImpl = fetch) {
  if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'cardgames-board' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const r = await fetchImpl(`https://api.github.com/repos/${REPO}/issues?state=all&per_page=100&sort=updated`, { headers });
  if (!r.ok) {
    if (cache.data) return { ...cache.data, stale: true };
    throw new Error(`GitHub answered ${r.status}`);
  }
  const raw = (await r.json()).filter((i) => !i.pull_request);
  const data = { repo: REPO, links: links(), ...group(raw.map(shape)), fetchedAt: new Date().toISOString() };
  cache = { at: Date.now(), data };
  return data;
}

// Links for the dashboard: the new-task form (optionally pre-filled) and the list.
function links(prefill) {
  const base = `https://github.com/${REPO}/issues`;
  const q = new URLSearchParams({ template: 'aufgabe.yml' });
  if (prefill) for (const [k, v] of Object.entries(prefill)) if (v) q.set(k, String(v).slice(0, 1800));
  return { list: base, newTask: `${base}/new?${q}` };
}

module.exports = { board, links, shape, group, sections, priorityOf, REPO, _reset: () => { cache = { at: 0, data: null }; } };
