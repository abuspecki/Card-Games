/* =========================================================
   CardGames — application shell
   Hub, accounts, wallet & shop, friends, profiles, feedback,
   leaderboard, rules, and the live table connection.
   The three table views live in holdem.js / blackjack.js / durak.js
   and register themselves in window.TableUI.
   ========================================================= */
(function () {
  const { fmt } = CardUI;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  window.TableUI = window.TableUI || {};

  const GAME_NAMES = { holdem: "Texas Hold'em", blackjack: 'Blackjack', durak: 'Durak', roulette: 'Roulette', flamingo: 'Flamingo' };
  const ROOM_INFO = {
    holdem: { tag: 'The Club Room', desc: 'No-Limit poker · up to 8 players', cards: [['A', 'spade'], ['K', 'spade']] },
    blackjack: { tag: 'Salon Privé', desc: 'Beat the dealer to 21', cards: [['A', 'heart'], ['K', 'club']] },
    durak: { tag: 'The Winter Palace', desc: 'Attack, defend — don\'t be the fool', cards: [['6', 'heart'], ['Q', 'spade']] },
    roulette: { tag: 'The Wheel Room', desc: 'Red, black or your lucky number' },
    flamingo: { tag: 'The Flamingo Lounge', desc: 'Match colour or number · up to 6' },
  };

  // ---------------- state ----------------
  const App = window.App = {
    session: localStorage.getItem('cg.session') || localStorage.getItem('poker.session'),
    account: null,     // { username, isOwner }
    wallet: null,      // wallet status from the server
    shop: null,        // { items, slots, rules }
    tables: [],        // lobby summaries
    S: null,           // latest table state message
    ws: null,
    tableId: null,
    game: null,
    layout: 'land',
  };
  if (App.session) localStorage.setItem('cg.session', App.session);

  // ---------------- api ----------------
  async function api(path, body, method) {
    const opts = { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json' } };
    if (App.session) opts.headers.Authorization = 'Bearer ' + App.session;
    if (body) opts.body = JSON.stringify(body);
    try {
      const r = await fetch(path, opts);
      const data = await r.json().catch(() => ({}));
      if (r.status === 401 && App.account && path !== '/api/me') signedOut();
      return { ok: r.ok, status: r.status, data };
    } catch {
      return { ok: false, status: 0, data: { error: 'Network problem — please try again' } };
    }
  }
  App.api = api;

  // ---------------- toasts & coin pop ----------------
  function toast(msg, opts = {}) {
    const t = h('div', 'toast' + (opts.kind ? ' ' + opts.kind : ''));
    t.appendChild(h('span', '', esc(msg)));
    if (opts.action) {
      const b = h('button', 'toast-btn', esc(opts.action.label));
      b.onclick = () => { t.remove(); opts.action.fn(); };
      t.appendChild(b);
    }
    const x = h('button', 'toast-x', '✕');
    x.setAttribute('aria-label', 'Dismiss');
    x.onclick = () => t.remove();
    t.appendChild(x);
    $('toasts').appendChild(t);
    setTimeout(() => t.remove(), opts.timeout || 4500);
  }
  App.toast = toast;

  function coinPop(amount, label, kind = 'coin') {
    const el = $('coinPop');
    el.innerHTML = `<b>+${fmt(amount)} <i class="ico-${kind}"></i></b><span>${esc(label)}</span>`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }
  $('coinPop').addEventListener('animationend', () => $('coinPop').classList.remove('show'));

  // ---------------- modal ----------------
  let modalOnClose = null;
  function openModal(build, opts = {}) {
    const card = $('modalCard');
    card.className = 'modal-card' + (opts.wide ? ' wide' : '') + (opts.theme ? ' ' + opts.theme : '');
    card.replaceChildren();
    const close = h('button', 'modal-x', '✕');
    close.setAttribute('aria-label', 'Close');
    close.onclick = closeModal;
    card.appendChild(close);
    build(card);
    $('modal').classList.remove('hidden');
    document.body.classList.add('modal-open');
    modalOnClose = opts.onClose || null;
    const first = card.querySelector('input, textarea, select');
    if (first && window.innerWidth > 700) setTimeout(() => first.focus(), 50);
  }
  function closeModal() {
    $('modal').classList.add('hidden');
    document.body.classList.remove('modal-open');
    if (modalOnClose) { const f = modalOnClose; modalOnClose = null; f(); }
  }
  App.openModal = openModal;
  App.closeModal = closeModal;
  $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('modal').classList.contains('hidden')) closeModal(); });

  function modalHead(card, eyebrow, title) {
    card.appendChild(h('p', 'eyebrow', esc(eyebrow)));
    card.appendChild(h('h2', 'modal-title', title));
    card.appendChild(h('div', 'ornament small', '<span></span><i></i><span></span>'));
  }
  function tabs(container, items, onPick, current) {
    const bar = h('div', 'mtabs');
    items.forEach(([key, label]) => {
      const b = h('button', key === current ? 'on' : '', label);
      b.onclick = () => { bar.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); onPick(key); };
      bar.appendChild(b);
    });
    container.appendChild(bar);
    return bar;
  }

  // ---------------- data-open buttons ----------------
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-open]');
    if (!a) return;
    e.preventDefault();
    closeMobileMenu();
    const what = a.dataset.open;
    if (what === 'signin') authModal('login');
    else if (what === 'register') authModal('register');
    else if (what === 'lounge') openLounge();
    else if (what === 'bank') openBank();
    else if (what === 'shop') openLounge('shop');
    else if (what === 'friends') openLounge('friends');
    else if (what === 'leaderboard') openLeaderboard();
    else if (what === 'feedback') openFeedback();
    else if (what === 'howto') openHowTo(App.game || 'holdem');
  });

  // mobile menu
  function closeMobileMenu() { $('mobileMenu').classList.add('hidden'); $('navBurger').setAttribute('aria-expanded', 'false'); }
  $('navBurger').onclick = () => {
    const open = $('mobileMenu').classList.toggle('hidden');
    $('navBurger').setAttribute('aria-expanded', String(!open));
  };
  $('mobileMenu').addEventListener('click', (e) => { if (e.target.closest('a')) closeMobileMenu(); });

  // ================= APPEARANCE =================
  function saveTheme() {
    if (App.account) api('/api/me/theme', { theme: Theme.mode() });
  }
  function paintTheme() {
    const mode = Theme.mode();
    document.querySelectorAll('[data-set-theme]').forEach((b) => b.classList.toggle('on', b.dataset.setTheme === mode));
  }
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-theme-toggle]');
    if (t) { Theme.toggle(); saveTheme(); return; }
    const s = e.target.closest('[data-set-theme]');
    if (s) { Theme.set(s.dataset.setTheme); saveTheme(); }
  });
  Theme.onChange(paintTheme);
  paintTheme();

  // ================= ACCOUNTS =================
  function authModal(mode, note) {
    openModal((card) => {
      modalHead(card, 'Members', mode === 'login' ? 'Welcome back' : 'Become a <em>member</em>');
      if (note) card.appendChild(h('p', 'modal-note', esc(note)));
      tabs(card, [['login', 'Sign in'], ['register', 'Become a member']], (k) => { mode = k; paint(); }, mode);
      const form = h('form', 'mform');
      form.innerHTML = `
        <label>Username<input name="u" maxlength="16" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required></label>
        <label>Password<input name="p" type="password" maxlength="100" required></label>
        <p class="merror" role="alert"></p>
        <button class="btn btn-navy wide" type="submit"></button>
        <p class="fine"></p>`;
      card.appendChild(form);
      const paint = () => {
        card.querySelector('.modal-title').innerHTML = mode === 'login' ? 'Welcome back' : 'Become a <em>member</em>';
        form.querySelector('button').textContent = mode === 'login' ? 'Sign in' : 'Create my membership';
        form.p.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
        form.querySelector('.fine').textContent = mode === 'login'
          ? 'Forgotten your details? Send us a note via Feedback.'
          : 'Members receive 5,000 chips and 200 coins, keep their winnings and appear on the leaderboard. 3–16 characters (letters incl. ä ö ü, numbers, spaces); password of 6+ characters.';
        form.querySelector('.merror').textContent = '';
      };
      paint();
      form.onsubmit = async (e) => {
        e.preventDefault();
        const r = await api(mode === 'login' ? '/api/login' : '/api/register', { username: form.u.value.trim(), password: form.p.value });
        if (!r.ok) { form.querySelector('.merror').textContent = r.data.error || 'Something went wrong'; return; }
        App.session = r.data.token;
        localStorage.setItem('cg.session', App.session);
        closeModal();
        await loadAccount();
        toast(mode === 'login' ? `Welcome back, ${r.data.username}.` : `Welcome to the club, ${r.data.username}. 5,000 chips are waiting for you.`, { kind: 'good' });
        if (App.pendingJoin) { const id = App.pendingJoin; App.pendingJoin = null; joinTable(id); }
      };
    });
  }

  function guestModal(tableId) {
    openModal((card) => {
      modalHead(card, 'A seat for you', 'How shall we <em>call you?</em>');
      card.appendChild(h('p', 'modal-note', 'Guests play with free table chips. Members keep their winnings, collect coins and appear on the leaderboard.'));
      const form = h('form', 'mform');
      form.innerHTML = `<label>Your name<input name="n" maxlength="16" required value="${esc(localStorage.getItem('cg.guestName') || '')}"></label>
        <button class="btn btn-navy wide" type="submit">Take my seat as a guest</button>
        <button class="btn btn-outline wide" type="button" data-member>Sign in or become a member</button>`;
      card.appendChild(form);
      form.onsubmit = (e) => {
        e.preventDefault();
        const n = form.n.value.trim().replace(/[<>]/g, '');
        if (!n) return;
        localStorage.setItem('cg.guestName', n);
        closeModal();
        connectAndJoin(tableId, n);
      };
      form.querySelector('[data-member]').onclick = () => { App.pendingJoin = tableId; authModal('login'); };
    });
  }

  async function loadAccount() {
    if (!App.session) { renderAccount(); return; }
    const r = await api('/api/me');
    if (r.ok) {
      App.account = { username: r.data.username, isOwner: r.data.isOwner };
      App.seat = r.data.seat || null;   // still seated somewhere (e.g. on another device)?
      // The appearance saved on the account follows you to every device.
      if (r.data.theme && r.data.theme !== Theme.mode()) Theme.set(r.data.theme);
    }
    else if (r.status === 401) { App.session = null; localStorage.removeItem('cg.session'); App.account = null; }
    renderAccount();
    if (App.account) { await loadWallet(); pollPresence(); }
  }

  function signedOut() {
    App.session = null; App.account = null; App.wallet = null;
    localStorage.removeItem('cg.session');
    renderAccount();
    applyCosmetics();
  }

  async function logout() {
    await api('/api/logout', {});
    signedOut();
    closeModal();
    toast('You have signed out. Do come again.');
  }

  function renderAccount() {
    const a = App.account;
    $('navGuest').classList.toggle('hidden', !!a);
    $('navMember').classList.toggle('hidden', !a);
    document.querySelectorAll('.owner-only').forEach((x) => x.classList.toggle('hidden', !(a && a.isOwner)));
    if (document.body.classList.contains('hub') || !App.tableId) document.body.classList.toggle('member', !!a);
    renderMemberBar();
    if (a) {
      $('navAvatar').innerHTML = myAvatar();
      $('navChips').textContent = fmt(App.wallet ? App.wallet.chips : 0);
      $('navCoins').textContent = fmt(App.wallet ? App.wallet.coins : 0);
    }
    renderTopbarWallet();
  }

  const initials = (name) => String(name || '?').slice(0, 2).toUpperCase();
  // Portraits: 'pf:<frame>' draws a frame around the initials; anything else
  // (older emoji portraits) is shown as it is.
  function avatarMarkup(av, name, letters = 2) {
    const ini = String(name || '?').slice(0, letters).toUpperCase();
    if (av && av.startsWith('pf:')) return `<span class="pf pf-${esc(av.slice(3))}"><b>${esc(ini)}</b></span>`;
    return esc(av || ini);
  }
  // Titles: 't:<word>' is written before the name; older emoji badges stay as marks.
  function titleMarkup(b) {
    if (!b) return '';
    return b.startsWith('t:') ? `<span class="title">${esc(b.slice(2))}</span> ` : `<span class="badge">${esc(b)}</span>`;
  }
  App.avatarMarkup = avatarMarkup;
  App.titleMarkup = titleMarkup;
  function equippedPreview(slot) {
    const id = App.wallet && App.wallet.equipped && App.wallet.equipped[slot];
    const item = id && App.shop && App.shop.items.find((i) => i.id === id);
    return item ? item.preview : null;
  }
  function myAvatar() {
    return avatarMarkup(equippedPreview('avatar'), App.account && App.account.username);
  }

  // ================= WALLET =================
  async function loadShop() {
    if (App.shop) return App.shop;
    const r = await api('/api/shop');
    if (r.ok) App.shop = r.data;
    return App.shop;
  }
  async function loadWallet() {
    if (!App.account) return;
    await loadShop();
    const r = await api('/api/wallet');
    if (r.ok) { App.wallet = r.data; renderAccount(); applyCosmetics(); }
  }
  App.loadWallet = loadWallet;

  async function walletAction(path, body) {
    const r = await api(path, body || {});
    if (!r.ok) { toast(r.data.error || 'Something went wrong', { kind: 'bad' }); return null; }
    if (r.data.wallet) { App.wallet = r.data.wallet; renderAccount(); applyCosmetics(); }
    return r.data;
  }

  // Apply bought cosmetics (card back / face / felt / background) to this screen.
  function applyCosmetics() {
    const eq = (App.wallet && App.wallet.equipped) || {};
    const pick = (slot) => { const it = eq[slot] && App.shop && App.shop.items.find((i) => i.id === eq[slot]); return it ? it.preview : ''; };
    CardUI.backOverride = pick('cardback') ? 'cb-' + pick('cardback') : null;
    document.body.dataset.cardface = pick('cardface');
    document.body.dataset.felt = pick('felt');
    document.body.dataset.bg = pick('background');
    CardUI.chipSet = pick('chips') || null;
    document.body.dataset.turn = pick('turn');
    if (App.S) renderTable();
  }

  // ================= HUB: rooms & tables =================
  function buildTrio() {
    const trio = $('trio');
    if (!trio) return;
    [['holdem', -16], ['durak', 16], ['blackjack', 0]].forEach(([theme, deg]) => {
      const b = CardUI.back(theme, { size: 150, noOverride: true });
      b.style.setProperty('--rot', deg + 'deg');
      b.classList.add('trio-' + theme);
      trio.appendChild(b);
    });
  }

  function buildRooms() {
    const grid = $('roomGrid');
    grid.replaceChildren();
    for (const game of ['holdem', 'blackjack', 'durak', 'roulette', 'flamingo']) {
      const info = ROOM_INFO[game];
      const art = h('article', `room room-${game}`);
      const vis = h('div', 'visual');
      if (game === 'blackjack') vis.appendChild(h('div', 'rays'));
      if (game === 'roulette') vis.appendChild(h('div', 'mini-wheel'));
      else if (game === 'flamingo') {
        const fan = h('div', 'fan');
        [['xWa', 'f-left'], ['c7a', 'f-right'], ['vRa', 'f-mid']].forEach(([c, cls]) => { const e = CardUI.flamingo(c, 86); e.style.position = 'absolute'; e.classList.add(cls); fan.appendChild(e); });
        vis.appendChild(fan);
      } else {
        const fan = h('div', 'fan');
        const b = CardUI.back(game, { size: 104, noOverride: true });
        const r = CardUI.card(info.cards[1][0], info.cards[1][1], { size: 104 });
        const m = CardUI.card(info.cards[0][0], info.cards[0][1], { size: 104 });
        b.classList.add('f-left'); r.classList.add('f-right'); m.classList.add('f-mid');
        fan.append(b, r, m);
        vis.appendChild(fan);
      }
      art.appendChild(vis);
      art.appendChild(h('p', 'tag', esc(info.tag)));
      art.appendChild(h('h3', '', game === 'durak' ? 'Durak <span lang="ru">Дурак</span>' : esc(GAME_NAMES[game])));
      art.appendChild(h('p', 'desc', esc(info.desc)));
      art.appendChild(h('hr'));
      const list = h('div', 'room-tables');
      list.dataset.game = game;
      art.appendChild(list);
      const help = h('button', 'room-help', 'How to play');
      help.onclick = () => openHowTo(game);
      art.appendChild(help);
      grid.appendChild(art);
    }
  }

  async function loadTables() {
    if (!$('hub').classList.contains('hidden') || !App.tables.length) {
      const r = await api('/api/tables');
      if (r.ok) { App.tables = r.data.tables; renderTables(); }
    }
  }

  function renderTables() {
    let people = 0;
    for (const list of document.querySelectorAll('.room-tables')) {
      list.replaceChildren();
      for (const t of App.tables.filter((x) => x.game === list.dataset.game)) {
        people += t.humans;
        const seated = t.humans + t.bots;
        const full = seated >= t.capacity && t.bots === 0;
        const row = h('div', 'rt' + (t.highRoller ? ' hr' : ''));
        const lock = t.highRoller && !App.account;
        const short = App.account && App.wallet && (t.minBankroll ? App.wallet.chips < t.minBankroll : t.highRoller && App.wallet.chips < t.minBuyIn);
        row.innerHTML = `
          <div class="rt-head"><b>${esc(t.name.split('·')[1] || t.name)}</b>
            <span class="rt-status ${t.playing ? 'live' : ''}">${t.playing ? '● In play' : seated ? 'Waiting' : 'Empty'}</span></div>
          <div class="rt-seats"></div>
          <div class="rt-meta">${esc(t.stakes)}${t.buyIn ? ` · buy-in ${fmt(t.buyIn)}` : ''}${t.minBankroll ? ` · members with ${fmt(t.minBankroll)}+ chips` : t.highRoller ? ' · members only' : ''}</div>`;
        const seats = row.querySelector('.rt-seats');
        for (let k = 0; k < t.capacity; k++) {
          const p = t.players[k];
          const d = h('span', 'rt-seat' + (p ? (p.bot ? ' bot' : ' human') : ''), p ? (p.bot ? '🤖' : avatarMarkup(p.avatar, p.name, 1)) : '');
          d.title = p ? p.name : 'Open seat';
          seats.appendChild(d);
        }
        const btn = h('button', 'btn room-btn', full ? 'Table full' : lock ? 'Members only' : short ? 'Not enough chips' : 'Take a Seat');
        btn.disabled = full;
        btn.onclick = () => joinTable(t.id);
        row.appendChild(btn);
        if (App.account && App.account.isOwner) {
          const wb = h('button', 'rt-watch', '👁 Watch');
          wb.title = 'Watch this table without taking a seat';
          wb.onclick = () => watchTable(t.id);
          row.appendChild(wb);
        }
        list.appendChild(row);
      }
    }
    $('onlineLine').innerHTML = people ? `<i class="live-dot"></i>${people} playing now` : '<i class="live-dot"></i>Tables open — be the first';
  }
  setInterval(() => { if (!$('hub').classList.contains('hidden') && document.visibilityState === 'visible') loadTables(); }, 4000);

  // ================= HOME LEADERBOARD =================
  // Poker against real people (no bots), Blackjack and Roulette — chips won.
  const HOME_LB = [['overall', 'All'], ['friends', 'Poker'], ['blackjack', 'Blackjack'], ['roulette', 'Roulette']];
  let homeLbMode = 'overall';
  async function loadHomeLb(mode = homeLbMode) {
    homeLbMode = mode;
    const box = $('homeLbList');
    if (!box) return;
    document.querySelectorAll('#homeLbTabs button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    const r = await api('/api/leaderboard?limit=10&mode=' + mode);
    if (!r.ok) { box.innerHTML = '<li class="empty">Could not load the leaderboard.</li>'; return; }
    const rows = r.data.rows;
    box.innerHTML = rows.length ? rows.map((x, i) => `
      <li class="${App.account && x.username.toLowerCase() === App.account.username.toLowerCase() ? 'me' : ''}">
        <span class="pos p${i + 1}">${i + 1}</span>
        <button class="name" data-prof="${esc(x.username)}">${esc(x.username)}</button>
        <span class="net ${x.net >= 0 ? 'pos-net' : 'neg-net'}">${x.net > 0 ? '+' : ''}${fmt(x.net)}</span>
        <span class="hands">${fmt(x.hands)} ${mode === 'roulette' ? 'spins' : 'hands'}</span>
      </li>`).join('') : '<li class="empty">No results yet — the first winner takes the top spot.</li>';
    box.querySelectorAll('[data-prof]').forEach((b) => { b.onclick = () => openProfile(b.dataset.prof); });
  }
  function buildHomeLb() {
    const tabs = $('homeLbTabs');
    if (!tabs) return;
    tabs.replaceChildren(...HOME_LB.map(([m, label]) => { const b = h('button', '', label); b.dataset.mode = m; b.onclick = () => loadHomeLb(m); return b; }));
    loadHomeLb();
    setInterval(() => { if (!$('hub').classList.contains('hidden') && document.visibilityState === 'visible') loadHomeLb(); }, 60000);
  }

  // ================= JOINING A TABLE =================
  function joinTable(id) {
    const t = App.tables.find((x) => x.id === id);
    $('lobbyError').textContent = '';
    if (t && t.highRoller && !App.account) { App.pendingJoin = id; authModal('login', 'The High Roller tables are reserved for members.'); return; }
    if (!App.account) { guestModal(id); return; }
    connectAndJoin(id);
  }
  App.joinTable = joinTable;

  // Owners: watch a table without a seat.
  function watchTable(id) { connectAndJoin(id, null, true); }
  App.watchTable = watchTable;

  function connectAndJoin(id, guestName, watch) {
    Sound.unlock();
    App.watching = !!watch;
    if (App.ws) { App.ws.onclose = null; App.ws.close(); }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}`);
    App.ws = ws;
    App.joining = id;
    ws.onopen = () => ws.send(JSON.stringify(watch ? { t: 'watch', room: id, session: App.session } : {
      t: 'join', room: id, session: App.session, name: guestName || localStorage.getItem('cg.guestName') || 'Guest',
      token: localStorage.getItem('cg.seat.' + id),
    }));
    ws.onmessage = (e) => onMessage(JSON.parse(e.data));
    ws.onclose = () => {
      if (App.tableId && App.ws === ws) { toast('Connection lost — reconnecting…'); setTimeout(() => { if (App.tableId) connectAndJoin(App.tableId, guestName, App.watching); }, 1500); }
    };
  }

  const send = (m) => { if (App.ws && App.ws.readyState === 1) App.ws.send(JSON.stringify(m)); };
  App.send = send;

  function onMessage(m) {
    if (m.t === 'watching') {
      App.tableId = m.room;
      App.watching = true;
      if (new URLSearchParams(location.search).get('table') !== m.room) history.pushState(null, '', '?table=' + m.room);
      return;
    }
    if (m.t === 'joined') {
      App.watching = false;
      localStorage.setItem('cg.seat.' + m.room, m.token);
      App.tableId = m.room;
      if (new URLSearchParams(location.search).get('table') === m.room) history.replaceState(null, '', '?table=' + m.room);
      else history.pushState(null, '', '?table=' + m.room);
      setTimeout(loadWallet, 300); // the buy-in moved chips from your bankroll
      return;
    }
    if (m.t === 'error') {
      if (!App.tableId) { App.joining = null; showError(m.msg); if (App.ws) { App.ws.onclose = null; App.ws.close(); } }
      else toast(m.msg, { kind: 'bad' });
      return;
    }
    if (m.t === 'state') {
      App.S = m;
      if ($('tableScreen').classList.contains('hidden')) showTable();
      renderTable();
      return;
    }
    if (m.t === 'sfx') { Sound.play(m.name); return; }
    if (m.t === 'gesture') {
      bubbles[m.seat] = { text: `${m.name} ${m.text}`, until: Date.now() + 4000, gesture: true };
      Sound.play('chat');
      if (App.S) renderBubbles(App.S.state);
      setTimeout(() => { if (App.S) renderBubbles(App.S.state); }, 4100);
      return;
    }
    if (m.t === 'coins') {
      if (App.wallet) { App.wallet.coins = m.coins; renderAccount(); }
      if (m.amount > 0) { coinPop(m.amount, m.capped ? 'Daily table limit reached' : 'For your win'); Sound.play('chips'); }
      return;
    }
    if (m.t === 'notice') { toast(m.msg, { kind: 'good', timeout: 7000 }); return; }
    if (m.t === 'left') { backToHub(); return; }
    if (m.t === 'kicked') { toast(m.msg, { kind: 'bad', timeout: 10000 }); backToHub(); signedOut(); }
  }

  function showError(msg) {
    if ($('hub').classList.contains('hidden')) { toast(msg, { kind: 'bad' }); return; }
    $('lobbyError').textContent = msg;
    toast(msg, { kind: 'bad' });
    $('rooms').scrollIntoView({ behavior: 'smooth' });
  }

  function leaveTable() {
    const S = App.S;
    const st = S && S.state;
    if (App.watching) { send({ t: 'leave' }); backToHub(); return; }
    const me = st && st.mySeat !== -1 ? st.seats[st.mySeat] : null;
    const playing = st && me && me.inHand && ['preflop', 'flop', 'turn', 'river', 'betting', 'playing', 'spinning'].includes(st.stage);
    if (playing && !confirm(st.game === 'durak' ? 'Leave in the middle of a game? You will be the durak.' : st.game === 'flamingo' ? 'Leave in the middle of a game? You give up this round.' : 'Leave in the middle of a hand? You lose what you have bet.')) return;
    const id = App.tableId;
    send({ t: 'leave' });                                       // over the game connection, if it is up
    apiLeave(id, id && localStorage.getItem('cg.seat.' + id));  // and over HTTP, which works even when it is not
    backToHub();
  }
  App.leaveTable = leaveTable;

  // Free a seat over HTTP (keepalive: still delivered while the page changes).
  function apiLeave(table, token) {
    if (!table && !token && !App.session) return Promise.resolve();
    const headers = { 'Content-Type': 'application/json' };
    if (App.session) headers.Authorization = 'Bearer ' + App.session;
    return fetch('/api/leave', { method: 'POST', keepalive: true, headers, body: JSON.stringify({ table, token }) }).catch(() => {});
  }
  App.apiLeave = apiLeave;

  // The browser's back button at a table means "leave the table".
  window.addEventListener('popstate', () => {
    if (!App.tableId) return;
    if (new URLSearchParams(location.search).get('table')) return;
    const before = App.tableId;
    leaveTable();
    if (App.tableId === before) history.pushState(null, '', '?table=' + before); // they chose to stay
  });

  function backToHub() {
    if (App.tableId) localStorage.removeItem('cg.seat.' + App.tableId);
    App.tableId = null; App.S = null; App.game = null; App.watching = false;
    if (App.ws) { App.ws.onclose = null; App.ws.close(); App.ws = null; }
    $('tableScreen').classList.add('hidden');
    $('hub').classList.remove('hidden');
    document.body.className = 'hub';
    applyCosmetics();
    if (location.search) history.replaceState(null, '', location.pathname);
    lastChatId = null;
    loadTables();
    loadWallet();
  }

  // ================= TABLE SCREEN =================
  function showTable() {
    $('hub').classList.add('hidden');
    $('tableScreen').classList.remove('hidden');
    window.scrollTo(0, 0);
    setDrawer(window.innerWidth >= 1280 && localStorage.getItem('cg.drawer') !== '0');
  }

  function computeLayout() {
    // Decide by the screen itself (not the space left by the controls, which
    // depends on the layout we pick): upright screens get the upright table.
    const drawer = $('drawer');
    const side = drawer && drawer.classList.contains('open') && window.innerWidth >= 1280 ? drawer.offsetWidth : 0;
    const w = window.innerWidth - side;
    const hgt = window.innerHeight;
    return w / hgt < 1.05 ? 'port' : 'land';
  }

  // Shared helpers every table view receives.
  const ctx = {
    stage: $('stage'), controls: $('controls'), topbar: $('tbar'), send, esc, h, fmt, toast,
    leave: () => leaveTable(),
    openDrawer: (tab) => { setDrawer(true); if (tab) pickTab(tab); },
    openRules: () => openHowTo(App.game),
    plates: {},   // seat index -> [x, y] on the stage (for chat bubbles)
    avatarHtml: (s) => avatarMarkup(s.avatar, s.name),
    nameHtml: (s) => `${titleMarkup(s.badge)}${s.isBot ? '<span class="botmark" title="Computer player">🤖</span>' : ''}${esc(s.name)}`,
  };
  App.ctx = ctx;

  function renderTable() {
    const S = App.S;
    if (!S) return;
    const st = S.state;
    const game = st.game || 'holdem';
    const layout = computeLayout();
    const ui = window.TableUI[game];
    if (!ui) return;
    document.body.className = `game ${game} ${layout === 'port' ? 'portrait' : 'landscape'}${$('drawer').classList.contains('open') ? ' drawer-open' : ''}${S.watching ? ' spectating' : ''}`;
    if (App.game !== game || App.layout !== layout) {
      App.game = game;
      App.layout = layout;
      ctx.layout = layout;
      ctx.stage.replaceChildren();
      ctx.controls.replaceChildren();
      ctx.topbar.replaceChildren();
      ui.build(ctx);
      buildTopbar(game);
      $('oddsTab').classList.toggle('hidden', game === 'durak' || game === 'roulette' || game === 'flamingo');
    }
    ctx.S = S;
    ctx.st = st;
    ctx.plates = {};
    fit();
    ui.render(st, S, ctx);
    renderChat(st);
    renderBubbles(st);
    renderLog(st);
    renderTableInfo(S, st);
    renderOdds(st);
    const title = document.querySelector('[data-tb-title]');
    if (title) title.textContent = S.tableName.replace(/^[^·]*·\s*/, '') + (st.game === 'holdem' ? ` · Blinds ${st.settings.smallBlind} / ${st.settings.bigBlind}` : st.game === 'blackjack' || st.game === 'roulette' ? ` · Bets from ${st.minBet}` : st.stage !== 'waiting' ? ` · Game ${st.handNo}` : '');
    renderTopbarWallet();
    myTurnSound(st);
  }
  App.renderTable = renderTable;

  function fit() {
    const ui = window.TableUI[App.game];
    if (!ui) return;
    const [w, hh] = App.layout === 'port' ? ui.size.port : ui.size.land;
    CardUI.fitStage($('stage'), w, hh, $('stageWrap'));
  }
  window.addEventListener('resize', () => {
    if (!App.S) return;
    if (computeLayout() !== App.layout) renderTable(); else fit();
  });

  let wasMyTurn = false;
  // "Your turn": sound (also when you move twice in a row) and a clock in the top bar.
  let lastTurnKey = '';
  let turnClock = null;
  function myTurnSound(st) {
    const turn = App.S && App.S.turn;
    const mine = !!turn && turn.seat === st.mySeat && st.toAct === st.mySeat;
    if (mine && turn.key !== lastTurnKey) { Sound.play('turn'); if (navigator.vibrate) navigator.vibrate(60); }
    lastTurnKey = mine ? turn.key : '';
    wasMyTurn = mine;
    const box = document.querySelector('[data-turn-clock]');
    clearInterval(turnClock);
    if (!box) return;
    if (!mine) { box.classList.add('hidden'); return; }
    const ends = Date.now() + turn.msLeft;
    const paint = () => {
      const s = Math.max(0, Math.ceil((ends - Date.now()) / 1000));
      box.textContent = `⏱ ${s}s`;
      box.classList.toggle('soon', s <= 10);
      box.classList.remove('hidden');
    };
    paint();
    turnClock = setInterval(paint, 500);
  }

  // Top bar shared by every room (styled per room by its CSS).
  const ROOM_TITLES = { holdem: ["Texas Hold'em", 'The Club Room'], blackjack: ['Blackjack', 'Salon Privé'], durak: ['Дурак', 'The Winter Palace'], roulette: ['Roulette', 'The Wheel Room'], flamingo: ['Flamingo', 'The Flamingo Lounge'] };
  function buildTopbar(game) {
    const tb = ctx.topbar;
    const [title, room] = ROOM_TITLES[game];
    tb.innerHTML = `
      <button class="lobby-link" data-act="lobby"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg><span>Lobby</span></button>
      <div class="tb-center"><small>${esc(game === 'durak' ? 'Durak' : title)} · ${esc(room)}</small><strong data-tb-title></strong></div>
      <div class="tb-right"><span class="turn-clock hidden" data-turn-clock aria-live="polite"></span><span data-topbar-wallet></span>
        <button class="tb-btn" data-act="gesture" title="Gestures" aria-label="Gestures"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v11H7z M3 15h18v2.5H3z"/></svg></button>
        <button class="tb-btn" data-act="rules" title="How to play" aria-label="How to play">?</button>
        <button class="tb-btn" data-act="panel" title="Chat & table" aria-label="Open chat and table panel">☰<span class="dot hidden" data-chat-dot></span></button></div>`;
    tb.querySelector('[data-act=lobby]').onclick = leaveTable;
    tb.querySelector('[data-act=rules]').onclick = () => openHowTo(game);
    tb.querySelector('[data-act=gesture]').onclick = (e) => { e.stopPropagation(); toggleGestureMenu(); };
    tb.querySelector('[data-act=panel]').onclick = () => setDrawer(!$('drawer').classList.contains('open'));
  }

  // Gestures: a small menu of the gestures you own.
  function toggleGestureMenu() {
    const old = document.querySelector('.gesture-menu');
    if (old) { old.remove(); return; }
    const menu = h('div', 'gesture-menu');
    const owned = App.account && App.wallet && App.shop ? App.shop.items.filter((i) => i.slot === 'gesture' && App.wallet.owned.includes(i.id)) : [];
    if (!App.account) menu.appendChild(h('p', '', 'Gestures are for members. Sign in to use them.'));
    else if (!owned.length) {
      menu.appendChild(h('p', '', 'You have no gestures yet.'));
      const b = h('button', 'pill gold', 'Visit the Shop');
      b.onclick = () => { menu.remove(); shopSlot = 'gesture'; openLounge('shop'); };
      menu.appendChild(b);
    } else {
      menu.appendChild(h('small', '', 'Gestures'));
      for (const g of owned) {
        const b = h('button', '', `<b>${esc(g.name)}</b><em>${esc(g.preview)}</em>`);
        b.onclick = () => { send({ t: 'gesture', item: g.id }); menu.remove(); };
        menu.appendChild(b);
      }
    }
    document.body.appendChild(menu);
    const btn = ctx.topbar.querySelector('[data-act=gesture]').getBoundingClientRect();
    menu.style.top = (btn.bottom + 8) + 'px';
    menu.style.right = Math.max(8, window.innerWidth - btn.right) + 'px';
    setTimeout(() => document.addEventListener('click', function close(ev) {
      if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', close); }
    }), 0);
  }

  // The table top bar shows your bankroll / coins (members only).
  function renderTopbarWallet() {
    const el = document.querySelector('[data-topbar-wallet]');
    if (!el) return;
    if (!App.account || !App.wallet) { el.innerHTML = '<span class="tb-guest">Guest</span>'; return; }
    el.innerHTML = `<button class="tb-wallet" title="Your lounge"><span><i class="ico-chip"></i>${fmt(App.wallet.chips)}</span><span><i class="ico-coin"></i>${fmt(App.wallet.coins)}</span></button>`;
    el.querySelector('button').onclick = () => openLounge();
  }
  App.renderTopbarWallet = renderTopbarWallet;

  // ----- drawer (chat / log / odds / table) -----
  function setDrawer(open) {
    $('drawer').classList.toggle('open', open);
    document.body.classList.toggle('drawer-open', open);
    if (window.innerWidth >= 1280) localStorage.setItem('cg.drawer', open ? '1' : '0');
    if (open && currentTab === 'chat') $('chatDot').classList.add('hidden');
    document.querySelectorAll('[data-chat-dot]').forEach((d) => d.classList.toggle('hidden', open || !unread));
    if (open) unread = false;
    setTimeout(() => { if (App.S) fit(); }, 260);
  }
  App.setDrawer = setDrawer;
  $('drawerClose').onclick = () => setDrawer(false);
  let currentTab = 'chat';
  function pickTab(tab) {
    currentTab = tab;
    document.querySelectorAll('#drawer [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    document.querySelectorAll('#drawer [data-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== tab));
    if (tab === 'chat') { $('chatDot').classList.add('hidden'); $('chatList').scrollTop = $('chatList').scrollHeight; }
    if (tab === 'log') $('logList').scrollTop = $('logList').scrollHeight;
    if (tab === 'table') renderInvites();
    if (tab === 'odds' && App.S) renderOdds(App.S.state);
  }
  document.querySelectorAll('#drawer [data-tab]').forEach((b) => { b.onclick = () => pickTab(b.dataset.tab); });

  // ----- chat & bubbles -----
  let lastChatId = null;
  let unread = false;
  const bubbles = {};
  function renderChat(st) {
    const msgs = st.chat || [];
    const newest = msgs.length ? msgs[msgs.length - 1].id : 0;
    if (lastChatId !== null) {
      for (const m of msgs) {
        if (m.id <= lastChatId || m.seat < 0) continue;
        bubbles[m.seat] = { text: m.text, until: Date.now() + 5000 };
        setTimeout(() => { if (App.S) renderBubbles(App.S.state); }, 5100);
        const drawerOpen = $('drawer').classList.contains('open');
        if (m.seat !== st.mySeat && (!drawerOpen || currentTab !== 'chat')) {
          unread = true;
          $('chatDot').classList.remove('hidden');
          document.querySelectorAll('[data-chat-dot]').forEach((d) => d.classList.toggle('hidden', drawerOpen));
        }
      }
    }
    lastChatId = newest;
    const list = $('chatList');
    const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 10;
    list.replaceChildren();
    if (!msgs.length) list.appendChild(h('p', 'empty', 'No messages yet. Say good evening.'));
    for (const m of msgs) {
      const d = h('div', 'msg' + (m.seat === st.mySeat ? ' mine' : ''));
      d.innerHTML = `<b></b><span></span><time>${new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>`;
      d.querySelector('b').textContent = m.from;
      d.querySelector('span').textContent = m.text;
      list.appendChild(d);
    }
    if (atBottom) list.scrollTop = list.scrollHeight;
  }

  function renderBubbles(st) {
    document.querySelectorAll('.stage .bubble').forEach((b) => b.remove());
    for (const [seat, b] of Object.entries(bubbles)) {
      const pos = ctx.plates[seat];
      if (!pos || b.until < Date.now()) { if (b.until < Date.now()) delete bubbles[seat]; continue; }
      const el = h('div', 'bubble' + (b.gesture ? ' gesture' : ''));
      el.textContent = b.text.length > 80 ? b.text.slice(0, 77) + '…' : b.text;
      el.style.left = pos[0] + 'px';
      el.style.top = pos[1] + 'px';
      $('stage').appendChild(el);
    }
  }

  $('chatForm').onsubmit = (e) => {
    e.preventDefault();
    const text = $('chatInput').value.trim();
    if (text) send({ t: 'chat', text });
    $('chatInput').value = '';
  };

  function renderLog(st) {
    const list = $('logList');
    const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 10;
    list.replaceChildren();
    for (const line of st.log) if (typeof line === 'string') list.appendChild(h('p', line.startsWith('—') ? 'hand' : '', esc(line)));
    if (atBottom) list.scrollTop = list.scrollHeight;
  }

  function renderTableInfo(S, st) {
    const g = st.game;
    const s = st.settings || {};
    const info = g === 'holdem' ? `Blinds ${s.smallBlind} / ${s.bigBlind}` : g === 'blackjack' || g === 'roulette' ? `Bets from ${st.minBet}` : g === 'flamingo' ? 'Two to six players · 108 pink cards' : 'Two to six players · 36 cards';
    $('tableInfo').innerHTML = `<b>${esc(S.tableName)}</b><span>${esc(info)} · cards are dealt automatically once enough players are seated.</span>
      ${S.usesChips && App.account ? '<span>Your chips come from your bankroll and return to it when you leave.</span>' : S.usesChips ? '<span>As a guest you play with free table chips.</span>' : ''}`;
    const seated = st.seats.filter(Boolean).length;
    const cap = g === 'durak' || g === 'flamingo' ? 6 : g === 'blackjack' ? 7 : 8;
    $('addBotBtn').disabled = seated >= cap;
    $('removeBotBtn').disabled = !st.seats.some((x) => x && x.isBot);
  }
  $('addBotBtn').onclick = () => send({ t: 'addBot' });
  $('removeBotBtn').onclick = () => send({ t: 'removeBot' });
  $('copyLinkBtn').onclick = () => {
    const url = `${location.origin}${location.pathname}?table=${App.tableId}`;
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Table link copied — send it to a friend.'), () => toast(url));
  };

  // ----- sound controls -----
  function paintSound() { $('muteBtn').textContent = Sound.muted ? 'Sound off' : 'Sound on'; }
  $('muteBtn').onclick = () => { Sound.toggleMute(); paintSound(); };
  $('volume').value = Sound.volume;
  $('volume').oninput = (e) => { Sound.setVolume(Number(e.target.value)); Sound.play('chips'); };
  paintSound();

  // ================= ODDS (drawer tab) =================
  let oddsWorker = null, oddsKey = '', oddsResult = null, oddsReq = 0;
  const HAND_NAMES = ['High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];
  function renderOdds(st) {
    const body = $('oddsBody');
    if (currentTab !== 'odds' && !(window.TableUI[st.game] && window.TableUI[st.game].wantsOdds)) return;
    if (st.game === 'blackjack') { body.innerHTML = blackjackTips(st); return; }
    if (st.game !== 'holdem') { body.innerHTML = ''; return; }
    const me = st.mySeat !== -1 ? st.seats[st.mySeat] : null;
    const inHand = me && me.inHand && !me.folded && me.hole && ['preflop', 'flop', 'turn', 'river'].includes(st.stage);
    if (!inHand) { body.innerHTML = '<p class="muted">Your chances appear here while you play a hand.</p>'; return; }
    const opponents = st.seats.filter((s, i) => s && i !== st.mySeat && s.inHand && !s.folded).length;
    const key = [st.handNo, me.hole.join(''), st.board.join(''), opponents].join('|');
    if (key !== oddsKey) {
      oddsKey = key; oddsResult = null;
      if (!oddsWorker) {
        oddsWorker = new Worker('odds-worker.js');
        oddsWorker.onmessage = (e) => { if (e.data.id === oddsReq) { oddsResult = e.data; if (App.S) renderOdds(App.S.state); } };
      }
      oddsWorker.postMessage({ id: ++oddsReq, hole: me.hole, board: st.board, variant: 'holdem', opponents: Math.max(1, opponents) });
    }
    if (!oddsResult) { body.innerHTML = '<p class="muted">Calculating…</p>'; return; }
    const pct = (x) => (x > 0 && x < 0.01 ? '<1' : Math.round(x * 100)) + '%';
    const win = oddsResult.win;
    let html = `<div class="odds-big">${pct(win)}</div><div class="meter"><i style="width:${win * 100}%"></i></div>
      <p class="muted">chance to win against ${opponents} player${opponents === 1 ? '' : 's'}${me.handName ? ` · you hold <b>${esc(me.handName)}</b>` : ''}</p>`;
    const lim = st.limits;
    if (lim && lim.toCall > 0) {
      const need = lim.toCall / (st.pot + lim.toCall);
      html += `<p class="verdict ${win >= need ? 'good' : 'bad'}">Calling ${fmt(lim.toCall)} to win ${fmt(st.pot)} needs ${pct(need)}. ${win >= need ? 'The odds favour a call.' : 'The price is steep.'}</p>`;
    }
    if (st.stage !== 'river') {
      html += '<h4>By the river</h4><div class="made">';
      oddsResult.made.map((p, cat) => ({ p, cat })).filter((r) => r.p >= 0.005).sort((a, b) => b.cat - a.cat).slice(0, 6)
        .forEach((r) => { html += `<span>${HAND_NAMES[r.cat]}</span><i><b style="width:${r.p * 100}%"></b></i><em>${pct(r.p)}</em>`; });
      html += '</div>';
    }
    body.innerHTML = html + '<p class="fine">An estimate against random hands. Nobody\'s cards are peeked.</p>';
  }

  function blackjackTips(st) {
    const me = st.mySeat !== -1 ? st.seats[st.mySeat] : null;
    const lim = st.limits;
    if (!me || !lim || lim.phase !== 'play' || !me.hands[lim.handIdx]) return '<p class="muted">Advice appears on your turn.</p>';
    const hand = me.hands[lim.handIdx];
    const tip = window.TableUI.blackjack.advise(hand.cards, st.dealer.cards[0], lim);
    return `<p class="muted">You hold <b>${hand.soft && hand.total < 21 ? 'soft ' : ''}${hand.total}</b> against the dealer's ${esc(CardUI.nameOf(st.dealer.cards[0]))}.</p>
      <div class="odds-big">${tip.bust}%</div><div class="meter"><i style="width:${tip.bust}%"></i></div>
      <p class="muted">chance to bust if you hit</p>
      <p class="verdict good">The book says: <b>${tip.move}</b>.</p>
      <p class="fine">Based on basic strategy — the mathematically soundest play.</p>`;
  }

  // ================= LOUNGE (wallet · shop · friends · profile) =================
  let loungeTab = 'wallet';
  async function openLounge(tab) {
    if (!App.account) { authModal('login'); return; }
    if (tab) loungeTab = tab;
    await loadWallet();
    openModal((card) => {
      modalHead(card, `The Members' Lounge`, `Good evening, <em>${esc(App.account.username)}</em>`);
      const body = h('div', 'lounge-body');
      tabs(card, [['wallet', 'Wallet'], ['shop', 'The Shop'], ['friends', 'Friends'], ['profile', 'My Profile']], (k) => { loungeTab = k; paintLounge(body); }, loungeTab);
      card.appendChild(body);
      const foot = h('div', 'lounge-foot');
      if (App.account.isOwner) foot.appendChild(h('a', 'btn btn-outline', 'Owner dashboard')).setAttribute('href', '/admin');
      const out = h('button', 'btn btn-outline', 'Sign out');
      out.onclick = logout;
      foot.appendChild(out);
      card.appendChild(foot);
      paintLounge(body);
    }, { wide: true });
  }
  App.openLounge = openLounge;

  function paintLounge(body) {
    body.replaceChildren();
    if (loungeTab === 'wallet') paintWallet(body);
    else if (loungeTab === 'shop') paintShop(body);
    else if (loungeTab === 'friends') paintFriends(body);
    else paintMyProfile(body);
  }

  function untilText(t) {
    const mins = Math.max(1, Math.ceil((t - Date.now()) / 60000));
    const hh = Math.floor(mins / 60), m = mins % 60;
    return hh ? `${hh}h ${m}m` : `${m}m`;
  }

  // The whole economy in three sentences (shown in the wallet and the Bank).
  function principle(w) {
    const r = w.rules || { chipsPerCoin: 100, fee: 0.1, topUpTo: 1000 };
    return `<ol class="principle">
      <li><b>Chips are play money.</b> You bet with them at the tables. Below ${fmt(r.topUpTo)}? Once a day the house tops you up to ${fmt(r.topUpTo)}.</li>
      <li><b>Coins are rewards.</b> You earn 1 coin for every ${fmt(r.chipsPerCoin)} chips you win (up to ${fmt(w.tableCap)} a day) plus the daily bonus — and spend them in the Shop.</li>
      <li><b>The Bank trades both ways</b> at ${fmt(r.chipsPerCoin)} chips = 1 coin and keeps ${Math.round(r.fee * 100)} % of each exchange.</li></ol>`;
  }

  function paintWallet(body) {
    const w = App.wallet;
    if (!w) { body.textContent = 'Loading…'; return; }
    const d = w.daily;
    const c = w.convert;
    body.innerHTML = `
      <div class="balances">
        <div class="bal"><small>Bankroll</small><strong><i class="ico-chip"></i>${fmt(w.chips)}</strong><em>chips to play with</em></div>
        <div class="bal"><small>At the tables</small><strong><i class="ico-chip"></i>${fmt(w.inPlay)}</strong><em>returns when you leave</em></div>
        <div class="bal"><small>Coins</small><strong><i class="ico-coin"></i>${fmt(w.coins)}</strong><em>for the shop</em></div>
      </div>
      ${principle(w)}
      <div class="wcards">
        <section class="wcard">
          <h4>The Daily Bonus</h4>
          <p>Visit every day for a growing gift of coins — up to 250 on the seventh day in a row.</p>
          <div class="streak">${[1, 2, 3, 4, 5, 6, 7].map((k) => `<span class="${k <= d.streak ? 'done' : ''}${d.ready && k === Math.min(d.streak + 1, 7) ? ' next' : ''}">${k}</span>`).join('')}</div>
          <button class="btn btn-navy wide" data-daily ${d.ready ? '' : 'disabled'}>${d.ready ? `Collect ${d.amount} coins` : `Next gift in ${untilText(d.nextAt)} · ${d.amount} coins`}</button>
        </section>
        <section class="wcard">
          <h4>The Bank</h4>
          <p>Chips into coins and back: ${fmt(c.rate)} chips buy 1 coin, 1 coin buys ${fmt(w.buyChips.rate)} chips (the difference is the Bank's 10 % fee).</p>
          <button class="btn btn-navy wide" data-bank>Visit the Bank</button>
        </section>
        <section class="wcard">
          <h4>The Daily Top-up</h4>
          ${w.bankrupt.eligible
    ? `<p>You are below ${fmt(w.bankrupt.below)} chips. Once a day the house brings you back to ${fmt(w.bankrupt.below)}.</p>
             <button class="btn btn-navy wide" data-bankrupt ${w.bankrupt.ready ? '' : 'disabled'}>${w.bankrupt.ready ? `Receive ${fmt(w.bankrupt.amount)} chips` : `Next top-up in ${untilText(w.bankrupt.nextAt)}`}</button>`
    : `<p>Should you ever fall below ${fmt(w.bankrupt.below)} chips, the house tops you up to ${fmt(w.bankrupt.below)} — once a day. It also happens automatically when you sit down with too little.</p>`}
          <h4 class="mt">Coins from the tables</h4>
          <p>1 coin for every 100 chips you win (at least 1 per win); escaping a game of Durak earns 10. Today: ${fmt(w.earnedToday)} / ${fmt(w.tableCap)}.</p>
        </section>
      </div>`;
    body.querySelector('[data-bank]').onclick = () => openBank();
    const daily = body.querySelector('[data-daily]');
    if (daily) daily.onclick = async () => { const r = await walletAction('/api/wallet/daily'); if (r) { coinPop(r.amount, r.streak > 1 ? `Day ${r.streak} in a row` : 'Daily bonus'); Sound.play('win'); paintLounge(body); } };
    const bk = body.querySelector('[data-bankrupt]');
    if (bk) bk.onclick = async () => { const r = await walletAction('/api/wallet/bankrupt'); if (r) { coinPop(r.amount, 'Your daily top-up', 'chip'); Sound.play('chips'); paintLounge(body); } };
  }

  // ================= THE BANK =================
  async function openBank() {
    if (!App.account) { authModal('login', 'The Bank is for members — sign in to exchange chips and coins.'); return; }
    await loadWallet();
    openModal((card) => {
      modalHead(card, 'CardGames & Co.', 'The <em>Bank</em>');
      const body = h('div', 'bank');
      card.appendChild(body);
      paintBank(body);
    }, { wide: true, theme: 'bank-modal' });
  }
  App.openBank = openBank;

  function paintBank(body) {
    const w = App.wallet;
    const c = w.convert;
    const b = w.buyChips;
    body.innerHTML = `
      <div class="bank-balances">
        <div><small>Your chips</small><strong><i class="ico-chip"></i>${fmt(w.chips)}</strong><em>${w.inPlay ? `+ ${fmt(w.inPlay)} at the tables` : 'in your bankroll'}</em></div>
        <div class="bank-rate"><span>${fmt(c.rate)} chips → 1 coin</span><span>1 coin → ${fmt(b.rate)} chips</span></div>
        <div><small>Your coins</small><strong><i class="ico-coin"></i>${fmt(w.coins)}</strong><em>for the shop</em></div>
      </div>
      ${principle(w)}
      <div class="bank-desks">
        <section class="desk">
          <h4>Chips → Coins</h4>
          <p>Turn chips into coins for the shop: ${fmt(c.rate)} chips per coin (100 + the 10 % fee).</p>
          ${c.maxCoins > 0 ? `
            <label class="amount"><span>Coins to receive</span><input type="number" min="1" max="${c.maxCoins}" value="${Math.min(c.maxCoins, 10)}" data-sell></label>
            <input type="range" min="1" max="${c.maxCoins}" value="${Math.min(c.maxCoins, 10)}" data-sell-range aria-label="Coins to receive">
            <p class="quote">You pay <b data-sell-cost></b> chips</p>
            <button class="btn btn-navy wide" data-sell-go>Exchange chips for coins</button>`
    : `<p class="muted">You need at least ${fmt(c.rate)} chips in your bankroll for one coin.</p>`}
          <p class="fine">Up to ${fmt(b.max)} coins per exchange.</p>
        </section>
        <section class="desk">
          <h4>Coins → Chips</h4>
          <p>Short of chips? Trade coins back into chips: ${fmt(b.rate)} chips per coin (100 − the 10 % fee).</p>
          ${w.coins > 0 ? `
            <label class="amount"><span>Coins to trade</span><input type="number" min="1" max="${Math.min(w.coins, b.max)}" value="${Math.min(w.coins, 10)}" data-buy></label>
            <input type="range" min="1" max="${Math.min(w.coins, b.max)}" value="${Math.min(w.coins, 10)}" data-buy-range aria-label="Coins to trade">
            <p class="quote">You receive <b data-buy-get></b> chips</p>
            <button class="btn btn-navy wide" data-buy-go>Exchange coins for chips</button>`
    : '<p class="muted">You have no coins to trade yet — collect the daily bonus or win at the tables.</p>'}
          <p class="fine">Up to ${fmt(b.max)} coins per exchange.</p>
        </section>
      </div>
      <p class="fine center">Play money only — nothing here can be bought with or exchanged for real money.</p>`;
    const wire = (numSel, rangeSel, outSel, rate, max) => {
      const num = body.querySelector(numSel), range = body.querySelector(rangeSel), out = body.querySelector(outSel);
      if (!num) return null;
      const sync = (v) => { v = Math.max(1, Math.min(max, Math.floor(Number(v)) || 1)); num.value = v; range.value = v; out.textContent = fmt(v * rate); };
      num.oninput = () => sync(num.value);
      range.oninput = () => sync(range.value);
      sync(num.value);
      return num;
    };
    const sell = wire('[data-sell]', '[data-sell-range]', '[data-sell-cost]', c.rate, c.maxCoins);
    const buy = wire('[data-buy]', '[data-buy-range]', '[data-buy-get]', b.rate, Math.min(w.coins, b.max));
    if (sell) body.querySelector('[data-sell-go]').onclick = async () => {
      const r = await walletAction('/api/wallet/convert', { coins: Number(sell.value) });
      if (r) { coinPop(r.converted, `For ${fmt(r.spentChips)} chips`); Sound.play('chips'); paintBank(body); }
    };
    if (buy) body.querySelector('[data-buy-go]').onclick = async () => {
      const r = await walletAction('/api/wallet/buychips', { coins: Number(buy.value) });
      if (r) { coinPop(r.gotChips, `For ${fmt(r.traded)} coins`, 'chip'); Sound.play('chips'); paintBank(body); }
    };
  }

  // ================= MEMBER BAR ("Your evening") =================
  function greeting() {
    const hr = new Date().getHours();
    return hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  }
  function quickSeat() {
    const w = App.wallet;
    const ok = (t) => {
      const full = t.humans + t.bots >= t.capacity && t.bots === 0;
      if (full) return false;
      if (t.minBankroll) return w && w.chips >= t.minBankroll;
      if (t.highRoller) return w && w.chips >= t.minBuyIn;
      return true;
    };
    const open = App.tables.filter(ok);
    // the liveliest table with people at it, otherwise Hold'em Table 1
    return open.sort((a, b) => b.humans - a.humans || (b.playing - a.playing))[0] || App.tables[0];
  }
  async function refreshSeat() {
    if (!App.account) return;
    const r = await api('/api/me');
    if (r.ok) { App.seat = r.data.seat || null; renderMemberBar(); }
  }

  function renderMemberBar() {
    const bar = $('memberBar');
    if (!bar) return;
    const a = App.account;
    bar.classList.toggle('hidden', !a);
    if (!a) return;
    const w = App.wallet;
    const p = App.presence || {};
    bar.innerHTML = `
      <div class="mb-hello"><span class="mb-av">${esc(myAvatar())}</span><div><small>${greeting()}</small><b>${esc(a.username)}</b></div></div>
      <button class="mb-stat" data-open="bank" title="The Bank"><small>Chips</small><b><i class="ico-chip"></i>${w ? fmt(w.chips) : '…'}</b></button>
      <button class="mb-stat" data-open="shop" title="The Shop"><small>Coins</small><b><i class="ico-coin"></i>${w ? fmt(w.coins) : '…'}</b></button>
      <button class="mb-stat" data-open="friends" title="Friends"><small>Friends online</small><b>${p.onlineFriends ?? '–'}${p.requests ? ` <em>· ${p.requests} new request${p.requests === 1 ? '' : 's'}</em>` : ''}</b></button>
      ${w && w.daily.ready ? `<button class="mb-bonus" data-mb-bonus>🎁 Collect ${w.daily.amount} coins</button>` : ''}
      ${a.isOwner ? '<a class="mb-owner" href="/admin" title="Owner dashboard">♛ Owner</a>' : ''}
      <button class="btn btn-navy mb-play" data-mb-play>Quick seat</button>`;
    const bonus = bar.querySelector('[data-mb-bonus]');
    if (bonus) bonus.onclick = async () => {
      const r = await walletAction('/api/wallet/daily');
      if (r) { coinPop(r.amount, r.streak > 1 ? `Day ${r.streak} in a row` : 'Daily bonus'); Sound.play('win'); }
    };
    bar.querySelector('[data-mb-play]').onclick = () => { const t = quickSeat(); if (t) joinTable(t.id); };
    // Still holding a seat (another device, or the connection dropped)? Offer to return or free it.
    if (App.seat && !App.tableId) {
      const note = h('div', 'mb-seat', `<span>You still have a seat at <b>${esc(App.seat.tableName)}</b>.</span>`);
      const back = h('button', 'btn btn-navy', 'Return');
      back.onclick = () => joinTable(App.seat.table);
      const free = h('button', 'btn btn-outline', 'Leave the table');
      free.onclick = async () => { free.disabled = true; await apiLeave(App.seat.table, null); App.seat = null; renderMemberBar(); loadTables(); toast('Your seat is free again.', { kind: 'good' }); };
      note.append(back, free);
      bar.appendChild(note);
    }
  }

  // ----- shop -----
  const SLOT_INFO = {
    cardback: ['Card backs', 'The back of every face-down card — on your screen.'],
    cardface: ['Card faces', 'How the faces of the cards are printed — on your screen.'],
    felt: ['Table felt', 'The cloth of every table you sit at — on your screen.'],
    background: ['Backgrounds', 'The wallpaper of the club and the rooms — on your screen.'],
    chips: ['Chip sets', 'The chips on every table — on your screen.'],
    avatar: ['Portraits', 'A frame around your initials on your nameplate — everyone at your table sees it.'],
    badge: ['Titles', 'A title written before your name — everyone at your table and on your profile sees it.'],
    turn: ['Turn markers', 'How the player whose turn it is gets marked — on your screen.'],
    gesture: ['Gestures', 'Little courtesies for the table. Every gesture you own is yours to use — open the hat button at any table.'],
  };
  let shopSlot = 'cardback';
  function shopPreview(item) {
    const box = h('div', 'shop-preview');
    if (item.slot === 'cardback') {
      const b = CardUI.back('holdem', { size: 56, noOverride: true });
      b.className = 'card-back ' + (item.preview === 'classic' ? 'holdem' : 'cb-' + item.preview);
      box.appendChild(b);
    } else if (item.slot === 'cardface') {
      const wrap = h('div', 'face-' + item.preview);
      wrap.append(CardUI.card('Q', 'diamond', { size: 52 }), CardUI.card('7', 'club', { size: 52 }));
      box.appendChild(wrap);
    } else if (item.slot === 'felt') box.appendChild(h('div', 'mini-felt', '')).dataset.felt = item.preview;
    else if (item.slot === 'background') box.appendChild(h('div', 'mini-bg', '')).dataset.bg = item.preview;
    else if (item.slot === 'chips') {
      const wrap = h('div', 'mini-chips');
      wrap.dataset.chips = item.preview;
      [5, 25, 100, 500].forEach((v) => wrap.appendChild(CardUI.chip(v, { size: 34, set: item.preview === 'classic' ? '' : item.preview })));
      box.appendChild(wrap);
    } else if (item.slot === 'turn') {
      const plate = h('div', 'mini-turn', `<span class="mt-av">${avatarMarkup(null, App.account.username)}</span><span>Your turn</span>`);
      plate.dataset.turn = item.preview;
      box.appendChild(plate);
    } else if (item.slot === 'gesture') box.appendChild(h('span', 'mini-gesture', `<b>${esc(App.account.username)}</b> ${esc(item.preview)}`));
    else if (item.slot === 'avatar') box.appendChild(h('span', 'mini-avatar', avatarMarkup(item.preview === 'classic' ? null : item.preview, App.account.username)));
    else box.appendChild(h('span', 'mini-badge', `${item.preview === 'classic' ? '' : titleMarkup(item.preview)}${esc(App.account.username)}`));
    return box;
  }
  function paintShop(body) {
    const w = App.wallet;
    const head = h('div', 'shop-head', `<span>Your coins: <b><i class="ico-coin"></i>${fmt(w.coins)}</b></span>`);
    body.appendChild(head);
    const sub = h('div', 'subtabs');
    for (const slot of App.shop.slots) {
      const b = h('button', slot === shopSlot ? 'on' : '', SLOT_INFO[slot][0]);
      b.onclick = () => { shopSlot = slot; paintLounge(body); };
      sub.appendChild(b);
    }
    body.appendChild(sub);
    body.appendChild(h('p', 'fine', esc(SLOT_INFO[shopSlot][1])));
    const grid = h('div', 'shop-grid');
    const isGesture = shopSlot === 'gesture';
    const equipped = w.equipped[shopSlot];
    if (!isGesture) {
      const def = h('div', 'shop-item' + (!equipped ? ' on' : ''));
      def.appendChild(shopPreview({ slot: shopSlot, preview: 'classic' }));
      def.appendChild(h('b', '', shopSlot === 'badge' ? 'No title' : shopSlot === 'avatar' ? 'Initials' : 'House classic'));
      def.appendChild(h('em', '', 'Free'));
      const db = h('button', 'pill', equipped ? 'Use' : 'In use');
      db.disabled = !equipped;
      db.onclick = async () => { if (await walletAction('/api/shop/equip', { slot: shopSlot, item: null })) paintLounge(body); };
      def.appendChild(db);
      grid.appendChild(def);
    }
    // Retired items are only shown to players who own them.
    for (const item of App.shop.items.filter((i) => i.slot === shopSlot && (!i.retired || w.owned.includes(i.id)))) {
      const owned = w.owned.includes(item.id);
      const on = equipped === item.id;
      const el = h('div', 'shop-item' + (on ? ' on' : '') + (owned ? ' owned' : ''));
      el.appendChild(shopPreview(item));
      el.appendChild(h('b', '', esc(item.name)));
      el.appendChild(h('em', '', owned ? (item.retired ? 'Retired · still yours' : 'In your collection') : `<i class="ico-coin"></i>${fmt(item.price)}`));
      const b = h('button', 'pill');
      if (isGesture && owned) { b.textContent = 'Use at the table'; b.disabled = true; }
      else if (on) { b.textContent = 'In use'; b.disabled = true; }
      else if (owned) { b.textContent = 'Use'; b.onclick = async () => { if (await walletAction('/api/shop/equip', { slot: item.slot, item: item.id })) paintLounge(body); }; }
      else {
        const short = item.price - w.coins;
        b.textContent = short > 0 ? `${fmt(short)} more coins` : 'Purchase';
        b.className = 'pill gold';
        b.disabled = short > 0;
        b.onclick = async () => {
          if (!confirm(`Purchase "${item.name}" for ${fmt(item.price)} coins?`)) return;
          if (await walletAction('/api/shop/buy', { item: item.id })) {
            Sound.play('win');
            if (!isGesture) await walletAction('/api/shop/equip', { slot: item.slot, item: item.id });
            toast(`"${item.name}" is yours.`, { kind: 'good' });
            paintLounge(body);
          }
        };
      }
      el.appendChild(b);
      grid.appendChild(el);
    }
    body.appendChild(grid);
  }

  // ----- friends -----
  async function paintFriends(body) {
    body.innerHTML = '<p class="muted">Loading…</p>';
    const r = await api('/api/friends');
    if (!r.ok) { body.textContent = r.data.error; return; }
    const list = r.data.friends;
    body.replaceChildren();
    const form = h('form', 'add-friend');
    form.innerHTML = '<input name="u" maxlength="16" placeholder="Add a friend by username" aria-label="Friend\'s username" autocapitalize="none" autocorrect="off" spellcheck="false"><button class="btn btn-navy" type="submit">Send request</button>';
    form.onsubmit = async (e) => {
      e.preventDefault();
      const u = form.u.value.trim();
      if (!u) return;
      const x = await api('/api/friends/request', { username: u });
      if (!x.ok) toast(x.data.error, { kind: 'bad' });
      else toast(x.data.status === 'friend' ? `You and ${u} are now friends.` : `Request sent to ${u}.`, { kind: 'good' });
      paintFriends(body);
    };
    body.appendChild(form);
    const received = list.filter((f) => f.status === 'received');
    const sent = list.filter((f) => f.status === 'sent');
    const friends = list.filter((f) => f.status === 'friend').sort((a, b) => b.online - a.online);
    const section = (title, items, row) => {
      if (!items.length) return;
      body.appendChild(h('h4', 'mt', esc(title)));
      const ul = h('div', 'flist');
      items.forEach((f) => ul.appendChild(row(f)));
      body.appendChild(ul);
    };
    const who = (f) => {
      const d = h('button', 'fwho');
      d.innerHTML = `<span class="mini-avatar">${avatarMarkup(f.avatar, f.username)}</span><span><b>${esc(f.username)}</b><em>${f.status !== 'friend' ? '' : f.online ? (f.where ? `At ${esc(f.where.tableName)}` : 'Online') : 'Offline'}</em></span>${f.status === 'friend' ? `<i class="presence ${f.online ? 'on' : ''}"></i>` : ''}`;
      d.onclick = () => openProfile(f.username);
      return d;
    };
    const btn = (label, cls, fn) => { const b = h('button', 'pill ' + (cls || ''), label); b.onclick = fn; return b; };
    const act = async (path, username, msg) => { const x = await api(path, { username }); if (!x.ok) toast(x.data.error, { kind: 'bad' }); else if (msg) toast(msg); paintFriends(body); pollPresence(); };
    const respond = async (username, accept) => {
      const x = await api('/api/friends/respond', { username, accept });
      if (!x.ok) toast(x.data.error, { kind: 'bad' });
      else if (accept) toast(`You and ${username} are now friends.`, { kind: 'good' });
      paintFriends(body);
      pollPresence();
    };
    section('Requests for you', received, (f) => {
      const row = h('div', 'frow');
      row.append(who(f), btn('Accept', 'gold', () => respond(f.username, true)), btn('Decline', 'quiet', () => respond(f.username, false)));
      return row;
    });
    section('Your friends', friends, (f) => {
      const row = h('div', 'frow');
      row.appendChild(who(f));
      if (f.where) row.appendChild(btn('Join', 'gold', () => { closeModal(); joinTable(f.where.table); }));
      if (App.tableId && f.online) row.appendChild(btn('Invite', '', () => inviteFriend(f.username)));
      row.appendChild(btn('Remove', 'quiet', () => { if (confirm(`Remove ${f.username} from your friends?`)) act('/api/friends/remove', f.username); }));
      return row;
    });
    section('Waiting for an answer', sent, (f) => {
      const row = h('div', 'frow');
      row.append(who(f), btn('Cancel', 'quiet', () => act('/api/friends/remove', f.username)));
      return row;
    });
    if (!list.length) body.appendChild(h('p', 'muted mt', 'No friends yet. Add someone by their username — once they accept, you can see when they are online and invite them to your table.'));
  }

  async function inviteFriend(username) {
    if (!App.tableId) return;
    const r = await api('/api/friends/invite', { username, table: App.tableId });
    toast(r.ok ? `Invitation sent to ${username}.` : r.data.error, { kind: r.ok ? 'good' : 'bad' });
  }

  async function renderInvites() {
    const box = $('inviteList');
    if (!App.account) { box.innerHTML = '<p class="muted">Members can invite friends to the table.</p>'; return; }
    const r = await api('/api/friends');
    const online = r.ok ? r.data.friends.filter((f) => f.status === 'friend' && f.online && !(f.where && f.where.table === App.tableId)) : [];
    box.replaceChildren();
    if (!online.length) box.appendChild(h('p', 'muted', 'None of your friends are online right now.'));
    online.forEach((f) => {
      const row = h('div', 'frow');
      row.innerHTML = `<span class="mini-avatar">${avatarMarkup(f.avatar, f.username)}</span><b>${esc(f.username)}</b>`;
      const b = h('button', 'pill gold', 'Invite');
      b.onclick = () => inviteFriend(f.username);
      row.appendChild(b);
      box.appendChild(row);
    });
  }

  // ----- presence: heartbeat, invites, friend requests -----
  const seenInvites = new Set();
  async function pollPresence() {
    if (!App.account || document.visibilityState !== 'visible') return;
    const r = await api('/api/presence');
    if (!r.ok) return;
    $('navDot').classList.toggle('hidden', !r.data.requests);
    App.presence = r.data;
    renderMemberBar();
    for (const inv of r.data.invites) {
      if (seenInvites.has(inv.id)) continue;
      seenInvites.add(inv.id);
      if (App.tableId === inv.table) continue;
      Sound.play('turn');
      toast(`${inv.from} invites you to ${inv.tableName}.`, {
        timeout: 20000,
        action: { label: 'Join', fn: () => { api('/api/friends/dismiss', { id: inv.id, username: inv.from }); if (App.tableId) { send({ t: 'leave' }); setTimeout(() => joinTable(inv.table), 800); } else joinTable(inv.table); } },
      });
    }
  }
  setInterval(pollPresence, 20000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pollPresence(); });

  // ----- profiles -----
  const MODE_NAMES = { friends: "Hold'em with friends", bots: "Hold'em with bots", blackjack: 'Blackjack', durak: 'Durak', roulette: 'Roulette' };
  function statsTable(stats) {
    if (!stats.length) return '<p class="muted">No hands played yet.</p>';
    return `<table class="stats"><thead><tr><th>Game</th><th>Hands</th><th>Won</th><th>${'Result'}</th></tr></thead><tbody>
      ${stats.map((s) => `<tr><td>${MODE_NAMES[s.mode] || esc(s.mode)}</td><td>${fmt(s.hands)}</td><td>${s.hands ? Math.round((s.wins / s.hands) * 100) : 0}%</td><td class="${s.net >= 0 ? 'pos' : 'neg'}">${s.mode === 'durak' || s.mode === 'flamingo' ? `${s.net >= 0 ? '+' : ''}${s.net} pts` : `${s.net >= 0 ? '+' : ''}${fmt(s.net)}`}</td></tr>`).join('')}</tbody></table>`;
  }
  async function paintMyProfile(body) {
    body.innerHTML = '<p class="muted">Loading…</p>';
    const r = await api(`/api/players/${encodeURIComponent(App.account.username)}`);
    if (!r.ok) { body.textContent = r.data.error; return; }
    body.innerHTML = profileHtml(r.data);
  }
  function profileHtml(p) {
    return `<div class="profile-head"><span class="big-avatar">${avatarMarkup(p.avatar, p.username)}</span>
      <div><h3>${titleMarkup(p.badge)}${esc(p.username)}</h3>
      <p class="muted"><i class="presence ${p.online ? 'on' : ''}"></i>${p.online ? (p.where ? `Playing at ${esc(p.where.tableName)}` : 'Online') : 'Offline'} · Member since ${new Date(p.memberSince).toLocaleDateString([], { month: 'long', year: 'numeric' })} · ${p.friends} friend${p.friends === 1 ? '' : 's'}</p></div></div>
      ${statsTable(p.stats)}`;
  }
  async function openProfile(username) {
    const r = await api(`/api/players/${encodeURIComponent(username)}`);
    if (!r.ok) { toast(r.data.error || 'Player not found', { kind: 'bad' }); return; }
    const p = r.data;
    openModal((card) => {
      modalHead(card, 'Member profile', esc(p.username));
      const body = h('div', 'profile', profileHtml(p));
      card.appendChild(body);
      const row = h('div', 'row gap mt');
      const btn = (label, cls, fn) => { const b = h('button', 'btn ' + cls, label); b.onclick = fn; row.appendChild(b); return b; };
      if (App.account && !p.isMe) {
        if (p.friendship === 'none') btn('Add as friend', 'btn-navy', async () => { const x = await api('/api/friends/request', { username: p.username }); toast(x.ok ? 'Friend request sent.' : x.data.error, { kind: x.ok ? 'good' : 'bad' }); closeModal(); });
        if (p.friendship === 'received') btn('Accept friend request', 'btn-navy', async () => { await api('/api/friends/respond', { username: p.username, accept: true }); toast(`You and ${p.username} are now friends.`, { kind: 'good' }); closeModal(); });
        if (p.friendship === 'sent') row.appendChild(h('span', 'muted', 'Friend request sent.'));
        if (p.friendship === 'friends' && App.tableId && p.online) btn('Invite to my table', 'btn-navy', () => { inviteFriend(p.username); closeModal(); });
        if (p.where && p.friendship === 'friends' && p.where.table !== App.tableId) btn(`Join at ${p.where.tableName}`, 'btn-outline', () => { closeModal(); joinTable(p.where.table); });
      }
      card.appendChild(row);
    });
  }
  App.openProfile = openProfile;

  // ================= LEADERBOARD =================
  async function openLeaderboard(mode = 'friends') {
    openModal((card) => {
      modalHead(card, 'The Club Ledger', 'Leaderboard');
      const note = h('p', 'fine', '');
      const body = h('div', 'lb-body');
      const NOTES = {
        friends: 'Hold\'em hands with at least two people. Ranked by total chips won — losses count.',
        bots: 'Hold\'em hands played against the house\'s bots.',
        blackjack: 'Blackjack hands against the dealer. Ranked by chips won.',
        durak: 'Durak: +1 point for escaping, −1 for being the durak.',
        roulette: 'Roulette spins. Ranked by chips won.',
        flamingo: 'Flamingo: +1 point for every game you win.',
      };
      const load = async (m) => {
        note.textContent = NOTES[m];
        body.innerHTML = '<p class="muted">Loading…</p>';
        const r = await api('/api/leaderboard?mode=' + m);
        if (!r.ok) { body.textContent = 'Could not load the leaderboard.'; return; }
        const rows = r.data.rows;
        if (!rows.length) { body.innerHTML = '<p class="muted">No results yet. The first member to play takes the top spot.</p>'; return; }
        body.innerHTML = `<table class="stats lb"><thead><tr><th>#</th><th>Member</th><th>${m === 'durak' || m === 'flamingo' ? 'Points' : 'Chips won'}</th><th>${m === 'durak' || m === 'flamingo' ? 'Games' : 'Hands'}</th><th>Won</th></tr></thead><tbody>
          ${rows.map((x, i) => `<tr class="${App.account && x.username.toLowerCase() === App.account.username.toLowerCase() ? 'me' : ''}"><td>${['I', 'II', 'III'][i] || i + 1}</td><td><button class="link" data-prof="${esc(x.username)}">${esc(x.username)}</button></td>
            <td class="${x.net >= 0 ? 'pos' : 'neg'}">${x.net > 0 ? '+' : ''}${fmt(x.net)}</td><td>${fmt(x.hands)}</td><td>${Math.round((x.wins / x.hands) * 100)}%</td></tr>`).join('')}</tbody></table>`;
        body.querySelectorAll('[data-prof]').forEach((b) => { b.onclick = () => openProfile(b.dataset.prof); });
        if (!r.data.persistent) body.appendChild(h('p', 'fine warn', 'Test mode: no database is connected, so results are temporary.'));
      };
      tabs(card, [['friends', 'Hold\'em'], ['bots', 'vs Bots'], ['blackjack', 'Blackjack'], ['durak', 'Durak'], ['roulette', 'Roulette'], ['flamingo', 'Flamingo']], load, mode);
      card.append(note, body);
      load(mode);
    }, { wide: true });
  }

  // ================= FEEDBACK =================
  function openFeedback() {
    openModal((card) => {
      modalHead(card, 'Correspondence', 'Your <em>feedback</em>');
      card.appendChild(h('p', 'modal-note', 'Found a bug, have an idea or simply a remark? Every note is read by the house.'));
      const form = h('form', 'mform');
      form.innerHTML = `
        <label>Category<select name="c">
          <option value="bug">Bug report</option><option value="suggestion">Suggestion</option>
          <option value="feature">Feature request</option><option value="general" selected>General feedback</option></select></label>
        <label>Your message<textarea name="m" rows="6" maxlength="2000" required placeholder="Tell us what happened, or what you would like to see…"></textarea></label>
        <p class="fine count">0 / 2000</p>
        <p class="merror" role="alert"></p>
        <button class="btn btn-navy wide" type="submit">Send to the house</button>`;
      card.appendChild(form);
      form.m.oninput = () => { form.querySelector('.count').textContent = `${form.m.value.length} / 2000`; };
      form.onsubmit = async (e) => {
        e.preventDefault();
        const context = `${App.tableId ? 'table ' + App.tableId : 'hub'} · ${window.innerWidth}×${window.innerHeight} · ${navigator.userAgent.slice(0, 120)}`;
        const r = await api('/api/feedback', { category: form.c.value, message: form.m.value, context });
        if (!r.ok) { form.querySelector('.merror').textContent = r.data.error; return; }
        [...card.children].forEach((c) => { if (!c.classList.contains('modal-x')) c.remove(); });
        modalHead(card, 'Correspondence', 'Thank you');
        card.appendChild(h('p', 'modal-note', 'Your note has been delivered to the house. We read every one.'));
        const ok = h('button', 'btn btn-navy wide', 'Close');
        ok.onclick = closeModal;
        card.appendChild(ok);
      };
    });
  }

  // ================= HOW TO PLAY =================
  const RULES = {
    holdem: `<ol class="rules-list">
      <li>Everyone receives <b>two private cards</b>. Five shared cards are dealt to the middle: three (the flop), one (the turn), one (the river).</li>
      <li>Make the best five-card hand from your two cards and the five on the board, in any combination.</li>
      <li>In each betting round you may <b>fold</b>, <b>check</b> (if nobody has bet), <b>call</b> a bet, or <b>raise</b>. No-Limit: you may bet everything you have.</li>
      <li>The best hand at the showdown — or the last player who has not folded — wins the pot.</li></ol><h4>The hands, from best to worst</h4><div id="rankings"></div>`,
    blackjack: `<ol class="rules-list">
      <li><b>Goal:</b> finish closer to 21 than the dealer without going over. You only play against the dealer.</li>
      <li>2–10 count their number, J/Q/K count 10, an Ace counts 11 or 1.</li>
      <li>Place your bet, then you and the dealer receive two cards (one of the dealer's is hidden).</li>
      <li><b>Hit</b> takes a card, <b>Stand</b> stops. Over 21 is a <b>bust</b>. <b>Double</b> doubles your bet for exactly one card. <b>Split</b> turns a pair into two hands.</li>
      <li>The dealer draws to 16 and stands on all 17s. A win pays 1:1, a <b>Blackjack</b> (Ace + ten-card) pays <b>3:2</b>, a tie returns your bet.</li></ol>`,
    durak: `<ol class="rules-list">
      <li><b>Goal:</b> be rid of your cards. The last player holding cards is the <b>durak</b> — the fool.</li>
      <li>36 cards, six to Ace. Everyone holds six; the card beneath the deck sets the <b>trump</b> suit.</li>
      <li>The <b>attacker</b> plays a card at the <b>defender</b> (the next player), who beats it with a higher card of the same suit, or any trump.</li>
      <li>Others may <b>add</b> cards whose rank is already on the table — at most six per round.</li>
      <li>All beaten and nobody adds more: the cards are discarded (<i>бито</i>) and the defender attacks next. Cannot or will not beat: the defender <b>takes</b> everything and loses their turn to attack.</li>
      <li>Everyone draws back to six after each round. Once the deck is empty, players who run out of cards are safe.</li></ol>`,
  };
  RULES.roulette = `<ol class="rules-list">
      <li><b>Goal:</b> guess where the ball lands. The wheel has the numbers <b>0 to 36</b>; zero is green, the others red or black.</li>
      <li>Pick a chip below the table, then tap the layout to bet — as many times and places as you like. <b>Undo</b>, <b>Clear</b>, <b>Repeat</b> and <b>×2</b> help.</li>
      <li>Everyone bets at the same time until the clock runs out (or everybody pressed <b>Spin</b>). Then: <i>rien ne va plus</i> — the wheel spins.</li>
      <li><b>Payouts:</b> a single number pays <b>35 to 1</b>; a dozen or a column pays <b>2 to 1</b>; red/black, even/odd, 1–18/19–36 pay <b>1 to 1</b>.</li>
      <li>When the ball lands on <b>zero</b>, all bets except a bet on 0 are lost — that is the house's edge.</li></ol>`;
  RULES.flamingo = `<ol class="rules-list">
      <li><b>Goal:</b> be the first to play all your cards. Everyone starts with <b>7 pink cards</b>.</li>
      <li>Four colours — <b>Cherry, Violet, Sun, Teal</b> — with numbers 0–9. On your turn, play a card that matches the <b>colour</b> or the <b>number</b> of the top card.</li>
      <li>Nothing fits? <b>Draw</b> a card — if it fits you may play it at once, otherwise <b>pass</b>.</li>
      <li><b>⊘ Skip</b>: the next player misses a turn. <b>⇄ Reverse</b>: play changes direction. <b>+2</b>: the next player draws two and misses a turn.</li>
      <li><b>Wild</b>: play on anything and choose the next colour. <b>Wild +4</b>: the same, and the next player draws four and misses a turn.</li>
      <li>Down to one card? Everyone sees “Last card!”. The first player with an empty hand wins 10 coins.</li></ol>`;
  const RANKINGS = [
    ['Royal Flush', 'As Ks Qs Js Ts', 'A, K, Q, J, 10 of one suit.'], ['Straight Flush', '9h 8h 7h 6h 5h', 'Five in a row, one suit.'],
    ['Four of a Kind', 'Qc Qd Qh Qs 4d', 'Four of one rank.'], ['Full House', 'Kh Kd Ks 7c 7h', 'Three of a kind and a pair.'],
    ['Flush', 'Ad Jd 8d 6d 2d', 'Five of one suit.'], ['Straight', 'Tc 9d 8h 7s 6c', 'Five in a row.'],
    ['Three of a Kind', '8s 8h 8d Kc 3s', 'Three of one rank.'], ['Two Pair', 'Jh Jc 4s 4d Ac', 'Two different pairs.'],
    ['Pair', 'Ts Th Kd 6c 2h', 'Two of one rank.'], ['High Card', 'Ad Qs 9c 6h 3d', 'Nothing else — your highest card plays.'],
  ];
  function openHowTo(game = 'holdem') {
    openModal((card) => {
      modalHead(card, 'The House Rules', 'How to play');
      const body = h('div', 'howto');
      const paint = (g) => {
        body.innerHTML = RULES[g];
        const r = body.querySelector('#rankings');
        if (r) {
          RANKINGS.forEach(([name, cards, desc], i) => {
            const row = h('div', 'rank-row', `<span class="n">${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][i]}</span><span class="cards"></span><span><b>${name}</b><em>${desc}</em></span>`);
            cards.split(' ').forEach((c) => row.querySelector('.cards').appendChild(CardUI.fromCode(c, { size: 30 })));
            r.appendChild(row);
          });
        }
      };
      tabs(card, [['holdem', "Hold'em"], ['blackjack', 'Blackjack'], ['durak', 'Durak'], ['roulette', 'Roulette'], ['flamingo', 'Flamingo']], paint, game);
      card.appendChild(body);
      paint(game);
    }, { wide: true });
  }
  App.openHowTo = openHowTo;

  // Shadow under the sticky navigation once you scroll.
  window.addEventListener('scroll', () => document.body.classList.toggle('scrolled', window.scrollY > 10), { passive: true });

  // ================= START =================
  buildTrio();
  buildRooms();
  buildHomeLb();
  applyCosmetics();
  loadTables();
  loadAccount().then(() => {
    renderTables();
    // Returning from a refresh or following an invite link: ?table=ID
    const params = new URLSearchParams(location.search);
    const id = (params.get('table') || '').toUpperCase();
    if (!id) {
      // Back in the lobby: seats this device still holds are stale — free them.
      Object.keys(localStorage).filter((k) => k.startsWith('cg.seat.')).forEach((k) => {
        apiLeave(k.slice(8), localStorage.getItem(k)).then(() => { refreshSeat(); });
        localStorage.removeItem(k);
      });
    }
    if (id) {
      const seated = localStorage.getItem('cg.seat.' + id);
      if (seated && (App.account || localStorage.getItem('cg.guestName'))) connectAndJoin(id);
      else { history.replaceState(null, '', location.pathname); setTimeout(() => { $('rooms').scrollIntoView(); joinTable(id); }, 300); }
    }
  });
})();
