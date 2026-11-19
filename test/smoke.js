// Browser smoke test: run before every update (npm run smoke).
// Starts the real server on a fresh test file, then clicks through the site
// like a player on a phone and on a computer: lobby, lounge tabs, every shop
// tab and the boxes, private table, leaderboard, every table with bots, and
// watching as a guest. Fails on browser errors, raw markup on screen
// (e.g. '<span class=…' shown as text) and broken values (NaN, undefined).
// Needs Playwright with a Chromium browser.
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { chromium, devices } = require('playwright');

const PORT = 5900 + Math.floor(Math.random() * 90);
const B = `http://localhost:${PORT}`;
const tag = Date.now().toString(36).slice(-5);
const OWNER = `smoke_${tag}`;
const env = { ...process.env, PORT: String(PORT), OWNER_USERNAMES: OWNER, DATABASE_URL: '', DATA_FILE: path.join(os.tmpdir(), `smoke-${tag}.json`), DRAIN_MS: '500' };

const problems = [];
const fail = (where, what) => problems.push(`${where}: ${what}`);
const post = (p, b, t) => fetch(B + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: JSON.stringify(b) }).then((r) => r.json());

// Text that should never be visible to a player.
async function checkScreen(page, where) {
  const bad = await page.evaluate(() => {
    const text = document.body.innerText;
    const out = [];
    for (const [re, name] of [[/<\/?(span|div|b|i|em|button|svg)[\s>]/i, 'raw markup'], [/class="/, 'raw markup'], [/\bNaN\b/, 'NaN'], [/\bundefined\b/, 'undefined'], [/\[object /, '[object …]']]) {
      const m = text.match(re);
      if (m) out.push(`${name}: “…${text.slice(Math.max(0, m.index - 30), m.index + 40).replace(/\s+/g, ' ')}…”`);
    }
    return out;
  });
  for (const b of bad) fail(where, b);
}

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 15000);
    server.stdout.on('data', (d) => { if (/running on/.test(String(d))) { clearTimeout(t); resolve(); } });
  });
  const owner = (await post('/api/register', { username: OWNER, password: 'smoke123' })).token;
  const me = (await post('/api/register', { username: `player_${tag}`, password: 'smoke123' })).token;
  const id = (await (await fetch(`${B}/api/admin/players?search=player_${tag}`, { headers: { Authorization: 'Bearer ' + owner } })).json()).players[0].id;
  await post(`/api/admin/players/${id}/adjust`, { coins: 20000, chips: 600000 }, owner);
  // wear a few skins, so their markup is drawn everywhere
  for (const [item, slot] of [['pf-halo', 'avatar'], ['title-legend', 'badge'], ['back-kitsune', 'cardback'], ['chips-holo', 'chips'], ['fx-confetti', 'victory']]) {
    await post('/api/shop/buy', { item }, me); await post('/api/shop/equip', { slot, item }, me);
  }

  const browser = await chromium.launch();
  for (const [dev, opts] of [['phone', devices['iPhone 13']], ['computer', { viewport: { width: 1300, height: 850 } }]]) {
    for (const lang of ['de', 'en']) {
      const page = await browser.newPage(opts);
      const where = (w) => `${dev}/${lang} ${w}`;
      page.on('pageerror', (e) => fail(where('page'), e.message));
      page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) fail(where('console'), m.text()); });
      page.on('dialog', (d) => d.accept());
      await page.goto(B);
      await page.evaluate(([t, l]) => { localStorage.setItem('cg.session', t); localStorage.setItem('cg.lang', l); }, [me, lang]);
      await page.reload(); await page.waitForTimeout(1200);
      await checkScreen(page, where('lobby'));

      // lounge: every tab, every shop tab, the boxes
      for (const tab of ['wallet', 'quests', 'shop', 'friends', 'profile']) {
        await page.evaluate((t) => App.openLounge(t), tab); await page.waitForTimeout(500);
        await checkScreen(page, where('lounge ' + tab));
      }
      await page.evaluate(() => App.openLounge('shop')); await page.waitForTimeout(400);
      const subtabs = await page.$$('.subtabs button');
      for (let i = 0; i < subtabs.length; i++) {
        await (await page.$$('.subtabs button'))[i].click(); await page.waitForTimeout(250);
        await checkScreen(page, where('shop tab ' + i));
      }
      await page.evaluate(() => App.closeModal());
      // private table dialog and leaderboard
      await page.evaluate(() => App.openPrivate()); await page.waitForTimeout(300);
      await page.click('[data-g=holdem]'); await page.waitForTimeout(300);
      await checkScreen(page, where('private table'));
      await page.evaluate(() => App.closeModal());
      await page.evaluate(() => document.querySelector('[data-open=leaderboard]').click()); await page.waitForTimeout(700);
      await checkScreen(page, where('leaderboard'));
      await page.evaluate(() => App.closeModal());

      // every table, with bots
      if (lang === 'de') {
        for (const t of ['HOLDEM-1', 'BLACKJACK-1', 'ROULETTE-1', 'DURAK-1', 'FLAMINGO-1']) {
          await page.evaluate((x) => App.joinTable(x), t);
          try { await page.waitForFunction(() => App.tableId && App.S, null, { timeout: 8000 }); } catch { fail(where(t), 'could not sit down'); continue; }
          for (let i = 0; i < 2; i++) { await page.evaluate(() => { const b = document.getElementById('addBotBtn'); if (b) b.click(); }); await page.waitForTimeout(200); }
          await page.waitForTimeout(3500);
          const drawn = await page.evaluate(() => document.querySelectorAll('#stage *').length);
          if (drawn < 20) fail(where(t), `the table looks empty (${drawn} elements)`);
          await checkScreen(page, where(t));
          await page.evaluate(() => App.leaveTable()); await page.waitForTimeout(800);
        }
      }
      await page.close();
    }
  }

  // watching as a guest
  const guest = await browser.newPage({ viewport: { width: 1300, height: 850 } });
  guest.on('pageerror', (e) => fail('guest watch', e.message));
  await guest.goto(B); await guest.waitForTimeout(900);
  await guest.evaluate(() => App.watchTable('HOLDEM-1'));
  try { await guest.waitForFunction(() => App.watching && App.S, null, { timeout: 8000 }); } catch { fail('guest watch', 'could not watch'); }
  await checkScreen(guest, 'guest watch');
  await browser.close();
  server.kill('SIGKILL');

  if (problems.length) {
    console.error(`smoke FAILED — ${problems.length} problem(s):\n  ` + problems.join('\n  '));
    process.exit(1);
  }
  console.log('smoke ok — phone and computer, German and English, lobby, lounge, shop, boxes, all tables, watching');
  process.exit(0);
})().catch((e) => { console.error('smoke crashed:', e); process.exit(1); });
