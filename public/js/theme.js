/* =========================================================
   CardGames — light / dark mode
   Loaded in <head> before the page paints, so there is no flash.
   Mode is 'light', 'dark' or 'system' (follow the device).
   Stored on the device; app.js also saves it to the account.
   ========================================================= */
/* Error reports: browser errors go to the owner dashboard (max 10 per page, no repeats). */
(function () {
  const seen = new Set();
  let sent = 0;
  function report(message, stack) {
    try {
      const key = String(message).slice(0, 200);
      if (!message || seen.has(key) || sent >= 10) return;
      // ignore noise from browser extensions and cross-origin scripts
      if (/^Script error\.?$/.test(message) || /extension:\/\//.test(stack || '')) return;
      seen.add(key); sent++;
      const headers = { 'Content-Type': 'application/json' };
      const s = localStorage.getItem('cg.session');
      if (s) headers.Authorization = 'Bearer ' + s;
      fetch('/api/client-error', { method: 'POST', keepalive: true, headers,
        body: JSON.stringify({ message: String(message).slice(0, 500), stack: String(stack || '').slice(0, 3000), where: location.pathname + location.search, ua: navigator.userAgent }) }).catch(() => {});
    } catch { /* never break the page */ }
  }
  window.addEventListener('error', (e) => report(e.message, e.error && e.error.stack ? e.error.stack : `${e.filename}:${e.lineno}:${e.colno}`));
  window.addEventListener('unhandledrejection', (e) => { const r = e.reason; report(r && r.message ? r.message : String(r), r && r.stack); });
  window.reportError = window.reportError || report;
})();

(function () {
  const KEY = 'cg.theme';
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const listeners = [];

  const mode = () => localStorage.getItem(KEY) || 'dark';  // the casino look is dark by default
  const resolve = (m) => (m === 'system' ? (media && media.matches ? 'dark' : 'light') : m);

  function apply() {
    const t = resolve(mode());
    document.documentElement.dataset.theme = t;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#0A1F15' : '#0F3B26');
    listeners.forEach((f) => f(t, mode()));
  }

  function set(m) {
    if (!['light', 'dark', 'system'].includes(m)) return;
    localStorage.setItem(KEY, m);
    apply();
  }

  if (media && media.addEventListener) media.addEventListener('change', () => { if (mode() === 'system') apply(); });
  apply();

  window.Theme = {
    mode, current: () => resolve(mode()), set,
    // Simple toggle between light and dark (leaves "system" behind).
    toggle() { set(resolve(mode()) === 'dark' ? 'light' : 'dark'); },
    onChange(f) { listeners.push(f); },
  };
})();
