// Error monitoring without an outside service: server errors (everything that
// goes through console.error, uncaught exceptions) and errors reported by
// players' browsers are grouped by message and kept for the owner dashboard.
// Grouped entries survive restarts through the store (if it supports it).
const crypto = require('crypto');

const MAX_GROUPS = 300;

function createErrorLog() {
  const groups = new Map(); // key -> { key, source, message, stack, count, firstAt, lastAt, context }
  let store = null;
  let dirty = new Set();

  const keyOf = (source, message) => crypto.createHash('sha1').update(source + '|' + message).digest('hex').slice(0, 16);
  // Group messages that only differ in numbers, ids or tokens.
  const normalise = (m) => String(m).replace(/[0-9a-f]{16,}/gi, '#').replace(/\d+/g, 'N').slice(0, 300);

  function record(source, message, extra = {}) {
    message = String(message || 'Unknown error').slice(0, 1000);
    const key = keyOf(source, normalise(message));
    const now = Date.now();
    let g = groups.get(key);
    if (!g) {
      if (groups.size >= MAX_GROUPS) {
        const oldest = [...groups.values()].sort((a, b) => a.lastAt - b.lastAt)[0];
        groups.delete(oldest.key);
      }
      g = { key, source, message, stack: '', count: 0, firstAt: now, lastAt: now, context: '' };
      groups.set(key, g);
    }
    g.count++;
    g.lastAt = now;
    g.message = message;
    if (extra.stack) g.stack = String(extra.stack).slice(0, 4000);
    if (extra.context) g.context = String(extra.context).slice(0, 500);
    dirty.add(key);
    return g;
  }

  function list() {
    return [...groups.values()].sort((a, b) => b.lastAt - a.lastAt);
  }

  function clear(key) {
    if (key) groups.delete(key); else groups.clear();
    if (store && store.clearErrors) store.clearErrors(key || null).catch(() => {});
  }

  // Load saved groups and write changes every few seconds.
  async function attach(s) {
    store = s;
    if (!store || !store.loadErrors) return;
    try {
      for (const g of await store.loadErrors()) if (!groups.has(g.key)) groups.set(g.key, g);
    } catch { /* keep going without history */ }
    setInterval(flush, 5000).unref();
  }
  async function flush() {
    if (!store || !store.saveError || !dirty.size) return;
    const keys = [...dirty];
    dirty = new Set();
    for (const k of keys) { const g = groups.get(k); if (g) await store.saveError(g).catch(() => {}); }
  }

  // Everything logged with console.error is recorded too.
  function hookConsole() {
    const orig = console.error.bind(console);
    console.error = (...args) => {
      orig(...args);
      try {
        const err = args.find((a) => a instanceof Error);
        const text = args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(' ');
        record('server', text, { stack: err && err.stack });
      } catch { /* never let logging break the app */ }
    };
  }

  return { record, list, clear, attach, flush, hookConsole };
}

module.exports = { createErrorLog };
