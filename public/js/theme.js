/* =========================================================
   CardGames — light / dark mode
   Loaded in <head> before the page paints, so there is no flash.
   Mode is 'light', 'dark' or 'system' (follow the device).
   Stored on the device; app.js also saves it to the account.
   ========================================================= */
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
