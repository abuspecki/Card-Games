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

  const GAME_NAMES = { holdem: "Texas Hold'em", draw: 'Five Card Draw', chess: 'Chess', blackjack: 'Blackjack', durak: 'Durak', roulette: 'Roulette', flamingo: 'Flamingo' };
  const ROOM_INFO = {
    holdem: { tag: 'The Club Room', desc: 'No-Limit poker · up to 8 players', cards: [['A', 'spade'], ['K', 'spade']] },
    draw: { tag: 'The Card Room', desc: 'Five cards, one draw · up to 6 players', cards: [['Q', 'heart'], ['Q', 'diamond']] },
    chess: { tag: 'The Chess Club', desc: 'Play for chips · double the stake' },
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
    else if (what === 'goldrush') openGoldRush();
    else if (what === 'install') installApp();
    else if (what === 'private') openPrivate();
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
          ? 'Forgotten your password? Send the owner a note via Feedback with your name — you will get a temporary password.'
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

  // Change the password. "forced" after the owner set a temporary one.
  function passwordModal(forced, back) {
    openModal((card) => {
      modalHead(card, 'Your account', forced ? 'Choose a new password' : 'Change your password');
      if (forced) card.appendChild(h('p', 'modal-note', 'You signed in with a temporary password. Please choose your own now — only you will know it.'));
      const form = h('form', 'mform');
      form.innerHTML = `
        ${forced ? '' : '<label>Current password<input name="c" type="password" maxlength="100" autocomplete="current-password" required></label>'}
        <label>New password<input name="p" type="password" minlength="6" maxlength="100" autocomplete="new-password" required></label>
        <label>Repeat the new password<input name="p2" type="password" minlength="6" maxlength="100" autocomplete="new-password" required></label>
        <p class="merror" role="alert"></p>
        <button class="btn btn-navy wide" type="submit">Save my new password</button>
        <p class="fine">At least 6 characters. Other devices will be signed out.</p>
        <input name="u" autocomplete="username" value="${esc(App.account ? App.account.username : '')}" hidden>`;
      card.appendChild(form);
      form.onsubmit = async (e) => {
        e.preventDefault();
        const err = form.querySelector('.merror');
        if (form.p.value !== form.p2.value) { err.textContent = 'The two new passwords are not the same'; return; }
        const r = await api('/api/me/password', { current: form.c ? form.c.value : '', password: form.p.value });
        if (!r.ok) { err.textContent = r.data.error || 'Something went wrong'; return; }
        if (App.account) App.account.mustChange = false;
        closeModal();
        toast('Your new password is saved.', { kind: 'good' });
      };
    }, forced ? {
      // a temporary password must be replaced: re-open if closed early
      onClose: () => { if (App.account && App.account.mustChange) setTimeout(() => passwordModal(true), 300); },
    } : { onClose: () => { if (back && App.account) setTimeout(back, 50); } });
  }
  App.passwordModal = passwordModal;

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
      App.account = { username: r.data.username, isOwner: r.data.isOwner, mustChange: !!r.data.mustChange };
      App.seat = r.data.seat || null;   // still seated somewhere (e.g. on another device)?
      // The appearance saved on the account follows you to every device.
      if (r.data.theme && r.data.theme !== Theme.mode()) Theme.set(r.data.theme);
    }
    else if (r.status === 401) { App.session = null; localStorage.removeItem('cg.session'); App.account = null; }
    renderAccount();
    if (App.account) { await loadWallet(); pollPresence(); loadQuestSummary(); setTimeout(maybeDailyPopup, 900); }
    if (App.account && App.account.mustChange) passwordModal(true);
  }

  function signedOut() {
    App.session = null; App.account = null; App.wallet = null;
    localStorage.removeItem('cg.session');
    renderAccount();
    applyCosmetics();
  }

  async function logout() {
    // Seated at a table? Leave it first, so the seat and the chips are settled.
    if (App.tableId && !App.watching) {
      const st = App.S && App.S.state;
      const me = st && st.mySeat !== -1 ? st.seats[st.mySeat] : null;
      const playing = st && me && me.inHand && ['preflop', 'flop', 'turn', 'river', 'betting', 'playing', 'spinning'].includes(st.stage);
      if (playing && !confirm('Signing out leaves the table — a hand is running, what you have bet is lost. Sign out anyway?')) return;
      const id = App.tableId;
      send({ t: 'leave' });
      await apiLeave(id, localStorage.getItem('cg.seat.' + id));
      backToHub();
    } else if (App.tableId) { send({ t: 'leave' }); backToHub(); }
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
    if (b.startsWith('ta:')) return `<span class="title anim">${esc(b.slice(3))}</span> `;   // animated title
    return b.startsWith('t:') ? `<span class="title">${esc(b.slice(2))}</span> ` : `<span class="badge">${esc(b)}</span>`;
  }
  // Player tags: a small label next to the name ('🦈 Shark').
  function tagMarkup(t) {
    if (!t) return '';
    const item = App.shop && App.shop.items.find((i) => i.slot === 'tag' && i.preview === t);
    const text = window.I18n ? I18n.t(t) : t;   // inside player names, so translated here
    return ` <span class="ptag${item && item.animated ? ' anim' : ''}" data-no-i18n>${esc(text)}</span>`;
  }
  App.avatarMarkup = avatarMarkup;
  App.titleMarkup = titleMarkup;
  App.tagMarkup = tagMarkup;
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
    for (const game of ['holdem', 'blackjack', 'durak', 'roulette', 'flamingo', 'chess']) {   // Five Card Draw ('draw') is built but not offered yet
      const info = ROOM_INFO[game];
      const art = h('article', `room room-${game}`);
      const vis = h('div', 'visual');
      if (game === 'blackjack') vis.appendChild(h('div', 'rays'));
      if (game === 'roulette') vis.appendChild(h('div', 'mini-wheel'));
      else if (game === 'chess') vis.appendChild(h('div', 'chess-art', '<span class="ca-k">♚\uFE0E</span><span class="ca-q">♛\uFE0E</span><span class="ca-n">♞\uFE0E</span><span class="ca-cube">×2</span>'));
      else if (game === 'flamingo') {
        const fan = h('div', 'fan');
        [['xWa', 'f-left'], ['c7a', 'f-right'], ['vRa', 'f-mid']].forEach(([c, cls]) => { const e = CardUI.flamingo(c, 86); e.style.position = 'absolute'; e.classList.add(cls); fan.appendChild(e); });
        vis.appendChild(fan);
      } else {
        const fan = h('div', 'fan');
        const b = CardUI.back(game === 'draw' ? 'holdem' : game, { size: 104, noOverride: true });
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
    // Gold Rush: a solo game, no tables
    const gr = h('article', 'room room-goldrush');
    gr.innerHTML = `<div class="visual"><div class="gr-art"><span class="gr-pick">⛏</span><i></i><i></i><i></i></div></div>
      <h3>Gold Rush</h3><p class="desc">Dig deeper — cash out before it caves in</p>
      <div class="gr-tables"><div class="rt gr-row"><div class="rt-head"><b>The Mine</b><span class="rt-status">Solo</span></div><div class="rt-meta">Stakes 10 – 5,000 · members</div></div></div>`;
    const play = h('button', 'btn room-btn', 'Play');
    play.onclick = () => openGoldRush();
    gr.querySelector('.gr-row').appendChild(play);
    const help = h('button', 'room-help', 'How to play');
    help.onclick = () => openHowTo('goldrush');
    gr.appendChild(help);
    grid.appendChild(gr);
  }

  async function loadTables() {
    if (!$('hub').classList.contains('hidden') || !App.tables.length) {
      const r = await api('/api/tables');
      if (r.ok) { App.tables = r.data.tables; renderTables(); showMaintenance(r.data.maintenance); showAnnouncement(r.data.announcement); renderPiggy(r.data.piggy); }
    }
  }

  // The piggy bank on the home page: every dealer tip goes in; when it is full, every member gets coins.
  const PIGGY_SVG = `<svg viewBox="0 0 120 100" aria-hidden="true"><defs><clipPath id="pigClip"><path d="M18 52 Q16 22 52 18 Q66 8 80 14 L84 6 Q92 10 90 22 Q104 30 106 46 L114 48 L114 62 L104 64 Q98 80 84 84 L84 94 L72 94 L70 88 L44 88 L42 94 L30 94 L30 84 Q14 76 18 52 Z"/></clipPath></defs>
    <path d="M18 52 Q16 22 52 18 Q66 8 80 14 L84 6 Q92 10 90 22 Q104 30 106 46 L114 48 L114 62 L104 64 Q98 80 84 84 L84 94 L72 94 L70 88 L44 88 L42 94 L30 94 L30 84 Q14 76 18 52 Z" fill="#F7B6C9" stroke="#C9648A" stroke-width="3"/>
    <g clip-path="url(#pigClip)"><rect class="pig-fill" x="0" y="100" width="120" height="100" fill="#F2C14E"/></g>
    <path d="M18 52 Q16 22 52 18 Q66 8 80 14 L84 6 Q92 10 90 22 Q104 30 106 46 L114 48 L114 62 L104 64 Q98 80 84 84 L84 94 L72 94 L70 88 L44 88 L42 94 L30 94 L30 84 Q14 76 18 52 Z" fill="none" stroke="#C9648A" stroke-width="3"/>
    <rect x="48" y="22" width="22" height="5" rx="2.5" fill="#7A2E4A"/><circle cx="90" cy="40" r="3.5" fill="#3A1022"/>
    <ellipse cx="110" cy="55" rx="3" ry="5" fill="#C9648A"/><path d="M14 50 q-8 -2 -6 -10" stroke="#C9648A" stroke-width="3" fill="none" stroke-linecap="round"/></svg>`;
  function renderPiggy(p) {
    const box = $('piggy');
    if (!box || !p) return;
    const pct = Math.max(0, Math.min(1, p.total / p.goal));
    box.classList.remove('hidden');
    if (!box.dataset.built) {
      box.dataset.built = '1';
      box.innerHTML = `<div class="pig-art">${PIGGY_SVG}</div>
        <div class="pig-text"><b>🐷 The piggy bank</b><span class="pig-line"></span>
          <div class="pig-bar"><i></i></div>
          <small>Every tip for a dealer goes in. When it holds ${fmt(p.goal)} chips, every member gets ${p.reward} coins.</small></div>`;
    }
    box.querySelector('.pig-line').innerHTML = `<b>${fmt(p.total)}</b> / ${fmt(p.goal)} chips`;
    box.querySelector('.pig-bar i').style.width = (pct * 100).toFixed(1) + '%';
    box.querySelector('.pig-fill').setAttribute('y', String(100 - pct * 88));
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
        // anyone can watch a table without taking a seat
        const wb = h('button', 'rt-watch', '👁 Watch');
        wb.title = 'Watch this table without taking a seat';
        wb.onclick = () => watchTable(t.id);
        row.appendChild(wb);
        list.appendChild(row);
      }
    }
    $('onlineLine').innerHTML = people ? `<i class="live-dot"></i>${people} playing now` : '<i class="live-dot"></i>Tables open — be the first';
  }
  setInterval(() => { if (!$('hub').classList.contains('hidden') && document.visibilityState === 'visible') loadTables(); }, 4000);

  // ================= DAILY QUESTS & ACHIEVEMENTS =================
  App.questSummary = null;
  async function loadQuestSummary() {
    if (!App.account) return;
    const r = await api('/api/quests');
    if (r.ok) { App.questSummary = r.data; renderMemberBar(); }
  }
  async function paintQuests(body) {
    body.innerHTML = '<p class="muted">Loading…</p>';
    const r = await api('/api/quests');
    if (!r.ok) { body.textContent = r.data.error || 'Could not load'; return; }
    App.questSummary = r.data;
    const { daily, achievements, resetsIn } = r.data;
    collSets = r.data.sets || [];
    const TIER = { bronze: '🥉', silver: '🥈', gold: '🥇' };
    const tagName = (id) => { const it = id && App.shop && App.shop.items.find((i) => i.id === id); return it ? it.preview : ''; };
    const hrs = Math.floor(resetsIn / 3600000), mins = Math.floor((resetsIn % 3600000) / 60000);
    const done = achievements.filter((a) => a.done).length;
    body.innerHTML = `
      <section class="q-sec"><header><h4>Today's quests</h4><small>New quests in ${hrs} h ${mins} min</small></header>
        <ul class="q-list">${daily.map((q) => `<li class="${q.done ? 'done' : ''}">
          <span class="q-ico">${q.done ? '✅' : '🎯'}</span>
          <div class="q-main"><b></b><div class="q-bar"><i style="width:${Math.round((q.progress / q.goal) * 100)}%"></i></div></div>
          <span class="q-val">${fmt(q.progress)} / ${fmt(q.goal)}<em><i class="ico-coin"></i>${q.reward}</em></span></li>`).join('')}</ul></section>
      <section class="q-sec"><header><h4>Achievements</h4><small>${done} of ${achievements.length} unlocked</small></header>
        <div class="a-grid">${achievements.map((a) => `<div class="ach tier-${a.tier || 'bronze'} ${a.done ? 'done' : ''}"><span class="a-ico">${a.done ? TIER[a.tier] || '🏆' : '🔒'}</span><b></b><small></small><em><i class="ico-coin"></i>${a.reward}${a.tag ? `<span class="a-tag">+ Tag ${tagMarkup(tagName(a.tag))}</span>` : ''}</em></div>`).join('')}</div></section>`;
    body.querySelectorAll('.q-list li').forEach((li, i) => { li.querySelector('b').textContent = daily[i].text; });
    body.querySelectorAll('.ach').forEach((el, i) => { el.querySelector('b').textContent = achievements[i].text; el.querySelector('small').textContent = achievements[i].desc; });
  }
  App.openQuests = () => { loungeTab = 'quests'; openLounge('quests'); };

  // ================= PRIVATE TABLES =================
  const PRIV_GAMES = [['holdem', "Hold'em", '♠'], ['chess', 'Chess', '♞'], ['blackjack', 'Blackjack', '🂡'], ['roulette', 'Roulette', '◉'], ['durak', 'Durak', '♦'], ['flamingo', 'Flamingo', '🦩']];
  function openPrivate() {
    openModal((card) => {
      modalHead(card, 'Friends only', 'Private table');
      const body = h('div', 'priv');
      body.innerHTML = `
        <section><h4>Join with a code</h4>
          <form class="priv-join"><input name="code" placeholder="P-ABC12" maxlength="8" autocapitalize="characters" autocomplete="off" spellcheck="false" aria-label="Table code"><button class="btn btn-navy">Join</button></form>
          <p class="merror" role="alert"></p></section>
        <section><h4>Open your own</h4>
          ${App.account ? `<p class="fine">Pick a game — you get a code to send to your friends. Only people with the code can sit down.</p>
            <div class="priv-games">${PRIV_GAMES.map(([g, label, ico]) => `<button data-g="${g}"><i>${ico}</i>${label}</button>`).join('')}</div>`
    : '<p class="fine">Members can open a private table. <button class="link" data-open="register">Join free</button></p>'}</section>`;
      card.appendChild(body);
      const err = body.querySelector('.merror');
      body.querySelector('.priv-join').onsubmit = async (e) => {
        e.preventDefault();
        let code = e.target.code.value.trim().toUpperCase().replace(/\s+/g, '');
        if (!code) return;
        const r = await api('/api/private/' + encodeURIComponent(code));
        if (!r.ok) { err.textContent = r.data.error; return; }
        closeModal();
        joinTable(r.data.id);
      };
      const create = async (payload, btn) => {
        btn.disabled = true;
        const r = await api('/api/private', payload);
        btn.disabled = false;
        if (!r.ok) { const e = card.querySelector('.priv .merror'); if (e) e.textContent = r.data.error; return; }
        closeModal();
        joinTable(r.data.id);
        setTimeout(() => toast(`Your private table is open — code ${r.data.id}. Share it with your friends!`, { kind: 'good', timeout: 9000 }), 800);
      };
      body.querySelectorAll('[data-g]').forEach((b) => { b.onclick = () => {
        const g = b.dataset.g;
        if (PRIV_STAKES[g]) privateSettings(card, g, create);
        else create({ game: g }, b);
      }; });
    });
  }
  // Chip games: the owner picks the blinds (or minimum bet) and the buy-in.
  const PRIV_STAKES = {
    holdem: { stakes: [10, 20, 50, 100, 200, 500, 1000, 2000, 5000], buyIns: [20, 50, 100, 200], def: [10, 100], minBuyIn: 10, label: "Hold'em" },
    draw: { stakes: [10, 20, 50, 100, 200, 500, 1000, 2000, 5000], buyIns: [20, 50, 100, 200], def: [10, 100], minBuyIn: 10, label: 'Five Card Draw' },
    blackjack: { stakes: [5, 10, 25, 50, 100, 250, 500, 1000], buyIns: [20, 50, 100, 200, 500, 1000], def: [10, 100], minBuyIn: 5, label: 'Blackjack' },
    roulette: { stakes: [5, 10, 25, 50, 100, 250, 500], buyIns: [20, 50, 100, 200], def: [5, 200], minBuyIn: 5, label: 'Roulette' },
    chess: { stakes: [50, 100, 250, 500, 1000, 2500, 5000, 10000], buyIns: [4, 8, 16, 32, 64], def: [100, 16], minBuyIn: 1, label: 'Chess', minutes: [3, 5, 10] },
  };
  function privateSettings(card, game, create) {
    const P = PRIV_STAKES[game];
    const holdem = game === 'holdem' || game === 'draw';
    const body = card.querySelector('.priv');
    body.innerHTML = `
      <section class="priv-set"><h4>${P.label} · your table</h4>
        ${P.minutes ? `<label>Time per player<select name="minutes">${P.minutes.map((m) => `<option value="${m}"${m === 5 ? ' selected' : ''}>${m} min</option>`).join('')}</select></label>` : ''}
        <label>${holdem ? 'Blinds' : game === 'chess' ? 'Stake per game' : 'Minimum bet'}<select name="stake">${P.stakes.map((v) => `<option value="${v}"${v === P.def[0] ? ' selected' : ''}>${holdem ? `${fmt(v / 2)} / ${fmt(v)}` : fmt(v)}</option>`).join('')}</select></label>
        <label>Buy-in<select name="buyIn"></select></label>
        <p class="priv-note"></p>
        <p class="merror" role="alert"></p>
        <div class="row gap"><button class="btn btn-outline" data-back>Back</button><button class="btn btn-navy" data-go>Open the table</button></div>
      </section>`;
    const stakeSel = body.querySelector('[name=stake]'), buySel = body.querySelector('[name=buyIn]'), note = body.querySelector('.priv-note');
    const paintBuyIns = (keep) => {
      const stake = Number(stakeSel.value);
      buySel.innerHTML = P.buyIns.map((x) => `<option value="${stake * x}"${x === keep ? ' selected' : ''}>${fmt(stake * x)} ${holdem ? `(${x} big blinds)` : game === 'chess' ? `(${x}× the stake)` : `(${x}× the minimum)`}</option>`).join('');
      paintNote();
    };
    const paintNote = () => {
      const stake = Number(stakeSel.value), buyIn = Number(buySel.value), min = stake * P.minBuyIn;
      const have = App.wallet ? App.wallet.chips : 0;
      note.innerHTML = `Everyone brings up to <b>${fmt(buyIn)}</b> chips and needs at least <b>${fmt(min)}</b> to sit down. You have <b>${fmt(have)}</b>.`
        + (have < min ? ' <span class="warn">That is not enough for you yet.</span>' : '');
    };
    // changing the blinds keeps the buy-in in big blinds (e.g. 100 big blinds)
    let lastStake = Number(stakeSel.value);
    stakeSel.onchange = () => { const times = Number(buySel.value) / lastStake; lastStake = Number(stakeSel.value); paintBuyIns(times); };
    buySel.onchange = paintNote;
    paintBuyIns(P.def[1]);
    body.querySelector('[data-back]').onclick = () => openPrivate();
    const go = body.querySelector('[data-go]');
    go.onclick = () => {
      body.querySelector('.merror').textContent = '';
      const mins = body.querySelector('[name=minutes]');
      create({ game, stake: Number(stakeSel.value), buyIn: Number(buySel.value), ...(mins ? { minutes: Number(mins.value) } : {}) }, go);
    };
  }
  App.openPrivate = openPrivate;
  async function shareCode(code) {
    const url = `${location.origin}${location.pathname}?table=${code}`;
    const text = `Join my table on CardGames — code ${code}`;
    try {
      if (navigator.share) { await navigator.share({ title: 'CardGames', text, url }); return; }
      await navigator.clipboard.writeText(`${text}: ${url}`);
      toast('Code and link copied — send them to your friends.', { kind: 'good' });
    } catch { /* cancelled */ }
  }

  // ================= INSTALL AS AN APP (PWA) =================
  let installEvent = null;
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; });
  window.addEventListener('appinstalled', () => { installEvent = null; document.body.classList.add('is-app'); toast('CardGames is now on your home screen.', { kind: 'good' }); });
  if (standalone()) document.body.classList.add('is-app');
  async function installApp() {
    if (standalone()) { toast('You are already using the app.'); return; }
    if (installEvent) { installEvent.prompt(); await installEvent.userChoice.catch(() => {}); installEvent = null; return; }
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    openModal((card) => {
      modalHead(card, 'App', 'Install CardGames');
      card.appendChild(h('ol', 'install-steps', ios
        ? '<li>Tap the <b>Share</b> button <span class="ib">⬆︎</span> in Safari (top right on iPad, bottom on iPhone).</li><li>Choose <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b> — CardGames opens full-screen like an app.</li>'
        : '<li>Open the browser menu <span class="ib">⋮</span>.</li><li>Choose <b>Install app</b> or <b>Add to Home screen</b>.</li><li>CardGames opens full-screen like an app.</li>'));
      const ok = h('button', 'btn btn-navy wide', 'Got it');
      ok.onclick = closeModal;
      card.appendChild(ok);
    });
  }
  App.installApp = installApp;

  // ================= LANGUAGE =================
  function paintLang() {
    const l = window.I18n ? I18n.lang() : 'en';
    document.querySelectorAll('[data-lang-toggle]').forEach((b) => { b.textContent = l === 'de' ? 'EN' : 'DE'; });
    document.querySelectorAll('[data-set-lang]').forEach((b) => b.classList.toggle('on', b.dataset.setLang === l));
  }
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-lang-toggle]');
    if (t && window.I18n) { I18n.set(I18n.lang() === 'de' ? 'en' : 'de'); return; }
    const s = e.target.closest('[data-set-lang]');
    if (s && window.I18n) I18n.set(s.dataset.setLang);
  });
  paintLang();

  // ================= OWNER ANNOUNCEMENT (lobby) =================
  function showAnnouncement(a) {
    let el = $('announceBar');
    const seen = localStorage.getItem('cg.announce.seen');
    if (!a || String(a.at) === seen) { if (el) el.remove(); return; }
    if (!el) {
      el = h('div', 'announce-bar'); el.id = 'announceBar';
      const main = document.querySelector('.app-main');
      if (main) main.prepend(el); else return;
    }
    el.innerHTML = '<span></span><button aria-label="Dismiss">✕</button>';
    el.querySelector('span').textContent = '📣 ' + a.text;
    el.querySelector('button').onclick = () => { localStorage.setItem('cg.announce.seen', String(a.at)); el.remove(); };
  }

  // ================= UPDATE NOTICE (maintenance) =================
  let maintEnds = 0, maintTimer = null, maintInfo = null;
  function showMaintenance(info) {
    let bar = $('maintBar');
    if (!info) { if (bar) bar.remove(); clearInterval(maintTimer); maintInfo = null; document.body.classList.remove('has-maint'); return; }
    if (!bar) { bar = h('div', 'maint-bar'); bar.id = 'maintBar'; bar.setAttribute('role', 'status'); document.body.appendChild(bar); }
    maintInfo = info;
    maintEnds = Date.now() + (info.msLeft || 0);
    document.body.classList.add('has-maint');
    const paint = () => {
      const left = Math.max(0, Math.ceil((maintEnds - Date.now()) / 1000));
      const mm = Math.floor(left / 60), ss = String(left % 60).padStart(2, '0');
      bar.textContent = maintInfo.draining ? '🔧 Updating — back in a moment, chips are safe'
        : left > 0 ? `🔧 Update in ${mm}:${ss} · current hands finish`
          : '🔧 Short update break · chips are safe';
    };
    paint();
    clearInterval(maintTimer);
    maintTimer = setInterval(paint, 1000);
  }

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
      showMaintenance(m.maintenance);
      if ($('tableScreen').classList.contains('hidden')) showTable();
      renderTable();
      return;
    }
    if (m.t === 'sfx') { Sound.play(m.name); if (window.Dealer) Dealer.onSfx(m.name); return; }
    if (m.t === 'tip') {
      if (window.Dealer) Dealer.onTip(m, ctx);
      Sound.play('chips');
      return;
    }
    if (m.t === 'gesture') {
      bubbles[m.seat] = { text: `${m.name} ${m.text}`, until: Date.now() + 4000, gesture: true };
      Sound.play('chat');
      if (App.S) renderBubbles(App.S.state);
      setTimeout(() => { if (App.S) renderBubbles(App.S.state); }, 4100);
      return;
    }
    if (m.t === 'coins') {
      if (App.wallet) { App.wallet.coins = m.coins; if (m.today != null) App.wallet.earnedToday = m.today; renderAccount(); }
      if (m.amount > 0) {
        coinPop(m.amount, m.capped ? 'Daily table limit reached' : (m.cap ? `Today ${fmt(m.today)} / ${fmt(m.cap)}` : 'For your win'));
        Sound.play('chips');
      }
      // Limit reached: say so once a day, so nobody thinks the coins got lost.
      if (m.capped) {
        const day = new Date().toISOString().slice(0, 10);
        if (localStorage.getItem('cg.capNote') !== day) {
          localStorage.setItem('cg.capNote', day);
          toast(`You have won the most table coins for today (${fmt(m.cap || 500)}). Wins still count for your chips — more coins tomorrow.`, { timeout: 9000 });
        }
      }
      return;
    }
    if (m.t === 'notice') { toast(m.msg, { kind: 'good', timeout: 7000 }); return; }
    if (m.t === 'announcement') { toast('📣 ' + m.text, { kind: 'good', timeout: 12000 }); loadWallet(); return; }
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
    if ($('tourneyBar')) $('tourneyBar').remove();
    if ($('sitOut')) $('sitOut').remove();
    if ($('spectate')) $('spectate').remove();
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
    // The side panel starts closed so the table gets the room; it stays open if you open it.
    setDrawer(window.innerWidth >= 1280 && localStorage.getItem('cg.panel') === '1');
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
    nameHtml: (s) => `${titleMarkup(s.badge)}${s.isBot ? '<span class="botmark" title="Computer player">🤖</span>' : ''}${esc(s.name)}${tagMarkup(s.tag)}`,
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
    document.body.className = `game ${game}${game === 'draw' ? ' holdem' : ''} ${layout === 'port' ? 'portrait' : 'landscape'}${$('drawer').classList.contains('open') ? ' drawer-open' : ''}${S.watching ? ' spectating' : ''}`;
    if (App.game !== game || App.layout !== layout) {
      App.game = game;
      App.layout = layout;
      ctx.layout = layout;
      ctx.stage.replaceChildren();
      ctx.controls.replaceChildren();
      ctx.topbar.replaceChildren();
      ui.build(ctx);
      if (window.Dealer) Dealer.build(ctx, ui.dealer && ui.dealer[layout]);
      buildTopbar(game);
      $('oddsTab').classList.toggle('hidden', game !== 'holdem' && game !== 'blackjack');
    }
    ctx.S = S;
    ctx.st = st;
    ctx.plates = {};
    fit();
    ui.render(st, S, ctx);
    if (window.Dealer) Dealer.update(ctx, st, S);
    markTurn(st);
    playVictory(st);
    renderChat(st);
    renderBubbles(st);
    renderLog(st);
    renderTableInfo(S, st);
    renderPrivateCode(S);
    renderTourney(S);
    renderSitOut(S, st);
    renderSpectate(S);
    renderOdds(st);
    // Title: long on a computer; on a phone two short lines ("Hold'em · 5/10" over "Table 1").
    const title = document.querySelector('[data-tb-title]');
    const sub = document.querySelector('[data-tb-sub]');
    if (title) {
      const name = S.tableName.replace(/^[^·]*·\s*/, '');
      const game = st.game;
      if (layout === 'port') {
        const SHORT = { holdem: "Hold'em", draw: 'Draw', chess: 'Chess', blackjack: 'Blackjack', roulette: 'Roulette', durak: 'Durak', flamingo: 'Flamingo' };
        const stake = game === 'chess' ? `${st.stake} · ${st.minutes} min` : game === 'holdem' || game === 'draw' ? `${st.settings.smallBlind}/${st.settings.bigBlind}` : game === 'blackjack' || game === 'roulette' ? `from ${st.minBet}` : st.stage !== 'waiting' ? `Game ${st.handNo}` : '';
        title.textContent = name;
        if (sub) sub.textContent = SHORT[game] + (stake ? ` · ${stake}` : '');
      } else {
        title.textContent = name + (game === 'chess' ? ` · Stake ${st.stake} · ${st.minutes} min` : game === 'holdem' || game === 'draw' ? ` · Blinds ${st.settings.smallBlind} / ${st.settings.bigBlind}` : game === 'blackjack' || game === 'roulette' ? ` · Bets from ${st.minBet}` : st.stage !== 'waiting' ? ` · Game ${st.handNo}` : '');
        if (sub) sub.textContent = sub.dataset.full;
      }
    }
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
    if (st.game === 'chess') { box.classList.add('hidden'); return; }   // chess shows its own clocks
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
  const ROOM_TITLES = { holdem: ["Texas Hold'em", 'The Club Room'], draw: ['Five Card Draw', 'The Card Room'], chess: ['Chess', 'The Chess Club'], blackjack: ['Blackjack', 'Salon Privé'], durak: ['Дурак', 'The Winter Palace'], roulette: ['Roulette', 'The Wheel Room'], flamingo: ['Flamingo', 'The Flamingo Lounge'] };
  function buildTopbar(game) {
    const tb = ctx.topbar;
    const [title, room] = ROOM_TITLES[game];
    tb.innerHTML = `
      <button class="lobby-link" data-act="lobby"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg><span>Lobby</span></button>
      <div class="tb-center"><small data-tb-sub data-full="${esc(game === 'durak' ? 'Durak' : title)} · ${esc(room)}">${esc(game === 'durak' ? 'Durak' : title)} · ${esc(room)}</small><strong data-tb-title></strong></div>
      <div class="tb-right"><span class="turn-clock hidden" data-turn-clock aria-live="polite"></span><span data-topbar-wallet></span>
        <button class="tb-btn tb-react" data-act="gesture" title="Quick chat & gestures" aria-label="Quick chat and gestures">💬</button>
        <button class="tb-btn" data-act="rules" title="How to play" aria-label="How to play">?</button>
        <button class="tb-btn" data-act="panel" title="Chat & table" aria-label="Open chat and table panel">☰<span class="dot hidden" data-chat-dot></span></button></div>`;
    tb.querySelector('[data-act=lobby]').onclick = leaveTable;
    tb.querySelector('[data-act=rules]').onclick = () => openHowTo(game);
    tb.querySelector('[data-act=gesture]').onclick = (e) => { e.stopPropagation(); toggleGestureMenu(); };
    tb.querySelector('[data-act=panel]').onclick = () => setDrawer(!$('drawer').classList.contains('open'));
  }

  // Quick chat: emojis and ready-made phrases (no typing on phones), plus your gestures.
  const QUICK_EMOJI = ['👍', '😂', '😮', '😎', '🔥', '🎉', '😅', '🙏', '😡', '🍀'];
  const QUICK_TEXT = ['Good luck all!', 'Nice hand!', 'Well played', 'Unlucky…', 'Your turn 🙂', 'One more round?', 'GG', 'Thanks!'];
  let lastQuick = 0;
  function quickSend(text) {
    if (Date.now() - lastQuick < 1200) return;      // a small pause between messages
    lastQuick = Date.now();
    send({ t: 'chat', text });
  }
  function toggleGestureMenu() {
    const old = document.querySelector('.gesture-menu');
    if (old) { old.remove(); return; }
    const menu = h('div', 'gesture-menu quick-menu');
    const emo = h('div', 'quick-emoji');
    QUICK_EMOJI.forEach((e) => { const b = h('button', '', e); b.setAttribute('aria-label', 'Send ' + e); b.onclick = () => { quickSend(e); menu.remove(); }; emo.appendChild(b); });
    menu.appendChild(emo);
    const txt = h('div', 'quick-text');
    QUICK_TEXT.forEach((t) => { const b = h('button', '', esc(t)); b.onclick = () => { quickSend(t); menu.remove(); }; txt.appendChild(b); });
    menu.appendChild(txt);
    const owned = App.account && App.wallet && App.shop ? App.shop.items.filter((i) => i.slot === 'gesture' && App.wallet.owned.includes(i.id)) : [];
    menu.appendChild(h('small', '', 'Gestures'));
    if (!App.account) menu.appendChild(h('p', '', 'Gestures are for members.'));
    else if (!owned.length) {
      const b = h('button', 'pill gold', 'Get gestures in the Shop');
      b.onclick = () => { menu.remove(); boxFocus = 'gesture'; openLounge('shop'); };
      menu.appendChild(b);
    } else {
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

  // A round is won: the winners' victory effects play over their seats (everyone sees them).
  let lastVictoryKey = '';
  function playVictory(st) {
    if (st.stage !== 'showdown' || !st.results || !st.results.winners) return;
    const key = `${App.tableId}:${st.handNo}`;
    if (key === lastVictoryKey) return;
    lastVictoryKey = key;
    const scale = App.layout === 'port' ? 0.55 : 1;
    st.results.winners.slice(0, 3).forEach((w, n) => {
      const s = st.seats[w.seat];
      const fx = s && s.skin && s.skin.victory;
      const at = ctx.plates[w.seat];
      if (fx && at && window.Effects) setTimeout(() => window.Effects.play(fx, ctx.stage, at[0], at[1], { scale }), 250 + n * 400);
    });
  }

  // The player whose turn it is shows *their* turn marker (everyone sees it).
  function markTurn(st) {
    const s = st.toAct >= 0 ? st.seats[st.toAct] : null;
    const turn = s && s.skin && s.skin.turn;
    document.querySelectorAll('#stage :is(.seat, .plate, .spot-label, .r-plate).active').forEach((e) => {
      if (turn) e.dataset.turn = turn; else delete e.dataset.turn;
    });
  }

  // Watching: a clear note and a way to sit down.
  function renderSpectate(S) {
    let box = $('spectate');
    if (!S.watching) { if (box) box.remove(); return; }
    if (box) return;
    box = h('div', 'spectate', '<span>👁 You are watching</span>');
    box.id = 'spectate';
    const sit = h('button', 'btn btn-navy', 'Take a seat');
    sit.onclick = () => { const id = App.tableId; App.watching = false; joinTable(id); };
    box.appendChild(sit);
    $('stageWrap').appendChild(box);
  }

  // Sit out: keep the seat, skip the next hands until you come back.
  function renderSitOut(S, st) {
    let box = $('sitOut');
    const me = st.mySeat !== -1 ? st.seats[st.mySeat] : null;
    const show = me && !S.watching && !S.tourney && st.game !== 'roulette' && st.game !== 'chess';
    if (!show) { if (box) box.remove(); return; }
    if (!box) { box = h('div', 'sitout'); box.id = 'sitOut'; $('stageWrap').appendChild(box); }
    const out = !!me.sitOut;
    const key = out ? 'out' : me.inHand && st.stage !== 'waiting' && st.stage !== 'showdown' ? 'after' : 'next';
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.classList.toggle('on', out);
    box.innerHTML = out
      ? '<span>☕ You are sitting out</span><button class="btn btn-navy" data-back>I\'m back</button>'
      : `<button class="sitout-pill" data-out title="${key === 'after' ? 'Sit out after this hand' : 'Sit out the next hand'}"><span class="long">☕ ${key === 'after' ? 'Sit out after this hand' : 'Sit out the next hand'}</span><span class="short">☕ Sit out</span></button>`;
    const b = box.querySelector('button');
    b.onclick = () => { send({ t: 'sitout', on: !out }); box.dataset.key = ''; };
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
    if (window.innerWidth >= 1280 && App.tableId) localStorage.setItem('cg.panel', open ? '1' : '0');
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

  // Sit & Go: status bar above the controls
  function renderTourney(S) {
    let bar = $('tourneyBar');
    const T = S.tourney;
    if (!T) { if (bar) bar.remove(); return; }
    if (!bar) { bar = h('div', 'tourney-bar'); bar.id = 'tourneyBar'; $('controls').before(bar); }
    const prizes = T.prizes.length > 1 ? `1st ${fmt(T.prizes[0])} · 2nd ${fmt(T.prizes[1])}` : `Winner takes ${fmt(T.prizes[0])}`;
    const seated = S.state.mySeat !== -1;
    if (T.state === 'open') {
      bar.innerHTML = `<div><b>🏆 Sit & Go</b><span>Entry ${fmt(T.entry)} · ${T.players} player${T.players === 1 ? '' : 's'} · ${prizes}</span>
        <small>Everyone starts with ${fmt(T.stack)} chips, blinds rise every few hands, last one standing wins. Bots may fill seats but win nothing.</small></div>
        ${seated ? `<button class="btn btn-gold t-start" ${T.players < 2 ? 'disabled' : ''}>${T.players < 2 ? 'Waiting for players…' : 'Start tournament'}</button>` : ''}`;
      const b = bar.querySelector('.t-start');
      if (b) b.onclick = () => send({ t: 'tstart' });
    } else if (T.state === 'running') {
      bar.innerHTML = `<div><b>🏆 Level ${T.level} · Blinds ${T.blinds.join(' / ')}</b><span>Next: ${T.nextBlinds.join(' / ')} in ${T.handsToNext} hand${T.handsToNext === 1 ? '' : 's'} · ${prizes}</span>
        ${T.out.length ? `<small>Out: ${T.out.map(esc).join(', ')}</small>` : ''}</div>`;
    } else {
      bar.innerHTML = `<div><b>🏆 Results</b><span>${(T.result ? T.result.order : []).map((o) => `${o.place}. ${esc(o.name)}${o.prize ? ` +${fmt(o.prize)}` : ''}`).join(' · ')}</span>
        <small>A new tournament opens in a moment.</small></div>`;
    }
  }

  function renderPrivateCode(S) {
    const box = document.querySelector('.tb-center');
    if (!box) return;
    let chip = box.querySelector('.priv-code');
    if (!String(S.room || '').startsWith('P-')) { if (chip) chip.remove(); return; }
    if (!chip) {
      chip = h('button', 'priv-code');
      chip.title = 'Share the code with your friends';
      chip.onclick = () => shareCode(S.room);
      box.appendChild(chip);
    }
    chip.textContent = `🔒 ${S.room} · Share`;
  }

  function renderTableInfo(S, st) {
    const g = st.game;
    const s = st.settings || {};
    const info = g === 'chess' ? `Stake ${st.stake} per game · ${st.minutes} min each · doubling cube` : g === 'holdem' || g === 'draw' ? `Blinds ${s.smallBlind} / ${s.bigBlind}` : g === 'blackjack' || g === 'roulette' ? `Bets from ${st.minBet}` : g === 'flamingo' ? 'Two to six players · 108 pink cards' : 'Two to six players · 36 cards';
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
      tabs(card, [['wallet', 'Wallet'], ['quests', 'Quests'], ['shop', 'The Shop'], ['collection', 'Collection'], ['friends', 'Friends'], ['profile', 'Profile']], (k) => { loungeTab = k; paintLounge(body); }, loungeTab);
      card.appendChild(body);
      const foot = h('div', 'lounge-foot');
      if (App.account.isOwner) foot.appendChild(h('a', 'btn btn-outline', 'Owner dashboard')).setAttribute('href', '/admin');
      const pw = h('button', 'btn btn-outline', 'Change password');
      pw.onclick = () => passwordModal(false, () => openLounge());
      foot.appendChild(pw);
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
    else if (loungeTab === 'quests') paintQuests(body);
    else if (loungeTab === 'shop') paintShop(body);
    else if (loungeTab === 'collection') paintCollection(body);
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

  // ----- the daily bonus: a week of 7 days, a skin on day 7 -----
  const DAILY_COINS = [100, 125, 150, 175, 200, 225, 250];
  function streakDays(d) {
    return `<div class="streak week">${DAILY_COINS.map((c, i) => {
      const k = i + 1;
      const cls = (k <= d.week ? 'done' : '') + (d.ready && k === d.nextDay ? ' next' : '') + (k === 7 ? ' box' : '');
      return `<span class="${cls}"><small>Day ${k}</small>${k === 7 ? '🎁' : '<i class="ico-coin"></i>'}<b>${c}</b>${k === 7 ? '<em>+ skin</em>' : ''}</span>`;
    }).join('')}</div>`;
  }
  async function claimDaily() {
    const r = await walletAction('/api/wallet/daily');
    if (!r) return null;
    coinPop(r.amount, r.streak > 1 ? `Day ${r.streak} in a row` : 'Daily bonus');
    Sound.play('win');
    if (r.item) {
      const it = App.shop && App.shop.items.find((i) => i.id === r.item);
      if (it) toast(`🎁 Day 7: ${it.name} from the Mystery Box is yours — find it in your collection.`, { kind: 'good', timeout: 9000 });
    }
    renderMemberBar();
    return r;
  }
  // Shown once a day after signing in, while the bonus is waiting.
  function dailyModal() {
    const d = App.wallet && App.wallet.daily;
    if (!d) return;
    openModal((card) => {
      modalHead(card, 'Welcome back', 'Your daily bonus');
      const body = h('div', 'daily-pop');
      body.innerHTML = `${streakDays(d)}
        <p class="fine center"><b>${d.ready ? `Day ${d.nextDay} of 7` : `Come back in ${untilText(d.nextAt)} for day ${d.nextDay}.`}</b><br><span>Collect every day — a missed day starts the week again.</span><br><span>Milestones: 30 days in a row → 1,000 coins + tag, 100 days → 5,000 coins + tag.</span></p>
        <button class="btn btn-gold wide" data-claim ${d.ready ? '' : 'disabled'}>${d.ready ? `Collect day ${d.nextDay}` : 'Collected today'}</button>`;
      card.appendChild(body);
      const b = body.querySelector('[data-claim]');
      b.onclick = async () => { b.disabled = true; const r = await claimDaily(); if (r) { body.querySelector('.streak').outerHTML = streakDays(App.wallet.daily); b.textContent = r.item ? '🎁 A skin is waiting in your collection' : 'See you tomorrow!'; } else b.disabled = false; };
    });
  }
  App.dailyModal = dailyModal;
  function maybeDailyPopup() {
    const d = App.wallet && App.wallet.daily;
    const key = 'cg.dailyPop';
    const today = new Date().toISOString().slice(0, 10);
    if (!d || !d.ready || App.tableId || localStorage.getItem(key) === today || App.account.mustChange) return;
    if (!$('modal').classList.contains('hidden')) return;
    localStorage.setItem(key, today);
    dailyModal();
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
          <p>Visit every day for a growing gift of coins — and a free skin from the Mystery Box on day 7. 30 and 100 days in a row unlock big rewards.</p>
          ${streakDays(d)}
          <button class="btn btn-navy wide" data-daily ${d.ready ? '' : 'disabled'}>${d.ready ? `Collect day ${d.nextDay}` : `Next gift in ${untilText(d.nextAt)} · day ${d.nextDay}`}</button>
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
      </div>
      <section class="wstatement">
        <h4>Your statement</h4>
        <p class="fine">Every coin and chip booking with its reason — the newest first. Chips you take to a table and back are not listed.</p>
        <div data-statement><p class="muted">Loading…</p></div>
      </section>`;
    paintStatement(body.querySelector('[data-statement]'));
    body.querySelector('[data-bank]').onclick = () => openBank();
    const daily = body.querySelector('[data-daily]');
    if (daily) daily.onclick = async () => { if (await claimDaily()) paintLounge(body); };
    const bk = body.querySelector('[data-bankrupt]');
    if (bk) bk.onclick = async () => { const r = await walletAction('/api/wallet/bankrupt'); if (r) { coinPop(r.amount, 'Your daily top-up', 'chip'); Sound.play('chips'); paintLounge(body); } };
  }

  // ----- the statement: where coins and chips came from and went -----
  const GAME_NAME = { friends: "Hold'em", bots: "Hold'em", draw: 'Five Card Draw', chess: 'Chess', blackjack: 'Blackjack', roulette: 'Roulette', durak: 'Durak', flamingo: 'Flamingo', goldrush: 'Gold Rush', tourney: 'Sit & Go' };
  function bookingLabel(e) {
    const [kind, ...rest] = String(e.reason || '').split(':');
    const detail = rest.join(':');
    const two = (a, b) => `<span>${esc(a)}</span> <b>${esc(b)}</b>`;
    if (kind === 'win') return two('Win at', GAME_NAME[detail] || detail);
    if (kind === 'daily') return `<span>Daily bonus</span> · <b>Day ${esc(detail)}</b>`;
    if (kind === 'topup') return '<span>Daily top-up</span>';
    if (kind === 'bank') return e.coins > 0 ? '<span>Bank: chips → coins</span>' : '<span>Bank: coins → chips</span>';
    if (kind === 'shop') { const it = App.shop && App.shop.items.find((i) => i.id === detail); return two('Shop:', it ? it.name : detail); }
    if (kind === 'quest') return two('Quest:', detail);
    if (kind === 'achievement') return two('Achievement:', detail);
    if (kind === 'tourney') return '<span>Sit & Go prize</span>';
    if (kind === 'gift-out') return two('Chips sent to', detail);
    if (kind === 'gift-in') return two('Chips from', detail);
    if (kind === 'gift-back') return two('Gift returned:', detail);
    if (kind === 'box') return two('Skin box:', (BOX_LOOK[detail] || ['', detail])[1]);
    if (kind === 'piggy') return '<span>Piggy bank full — a gift for everyone</span>';
    if (kind === 'weekly') return `<span>Weekly ranking</span> · <b>Place ${esc(detail)}</b>`;
    if (kind === 'gift') return '<span>Gift from the house</span>';
    if (kind === 'bonus') return '<span>Thank-you bonus for an update</span>';
    if (kind === 'owner') return '<span>Correction by the owner</span>';
    return `<span>${esc(e.reason)}</span>`;
  }
  function bookingWhen(at) {
    const d = new Date(at);
    const loc = document.documentElement.lang === 'de' ? 'de-DE' : undefined;
    return d.toDateString() === new Date().toDateString()
      ? d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString(loc, { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  }
  const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
  async function paintStatement(box) {
    if (!box) return;
    const r = await api('/api/wallet/history');
    if (!r.ok) { box.innerHTML = '<p class="muted">The statement could not be loaded.</p>'; return; }
    const list = r.data.entries || [];
    if (!list.length) { box.innerHTML = '<p class="muted">No bookings yet — collect the daily bonus or win a hand.</p>'; return; }
    box.innerHTML = `<ul class="statement">${list.map((e) => `<li>
      <span class="st-when">${bookingWhen(e.at)}</span>
      <span class="st-what">${bookingLabel(e)}</span>
      <span class="st-amt">${e.coins ? `<em class="${e.coins > 0 ? 'pos' : 'neg'}"><i class="ico-coin"></i>${signed(e.coins)}</em>` : ''}${e.chips ? `<em class="${e.chips > 0 ? 'pos' : 'neg'}"><i class="ico-chip"></i>${signed(e.chips)}</em>` : ''}</span>
    </li>`).join('')}</ul>`;
  }

  // ================= GOLD RUSH =================
  let gr = { cfg: null, round: null, level: localStorage.getItem('cg.gr.level') || 'medium', stake: Number(localStorage.getItem('cg.gr.stake')) || 50, busy: false, flash: null };
  async function openGoldRush() {
    if (!App.account) { authModal('register', 'Gold Rush is played with your own chips — create a free account (5,000 chips).'); return; }
    const r = await api('/api/goldrush');
    if (!r.ok) { toast(r.data.error || 'Gold Rush is not available', { kind: 'bad' }); return; }
    gr.cfg = r.data.config; gr.round = r.data.round; gr.flash = null;
    if (gr.round) gr.level = gr.round.level;
    openModal((card) => {
      modalHead(card, 'Solo game', 'Gold <em>Rush</em>');
      const body = h('div', 'gr');
      card.appendChild(body);
      paintGoldRush(body);
    }, { wide: true, theme: 'gr-modal' });
  }
  App.openGoldRush = openGoldRush;

  function paintGoldRush(body) {
    const cfg = gr.cfg, R = gr.round;
    const level = R ? R.level : gr.level;
    const L = cfg.levels[level];
    const step = R ? R.step : (gr.flash ? gr.flash.step : 0);
    const chips = App.wallet ? App.wallet.chips : 0;
    const rows = L.ladder.map((m, i) => {
      const k = i + 1;
      const cls = gr.flash && gr.flash.collapsed && k === gr.flash.step ? 'cave' : k < step || (k === step && (R || (gr.flash && !gr.flash.collapsed))) ? 'done' : k === step + 1 && R ? 'next' : '';
      return `<li class="${cls}" data-k="${k}"><span class="depth">${k * 10} m</span><span class="mult">${m.toFixed(2)}×</span>${cls === 'done' && k === step ? '<span class="miner">⛏</span>' : ''}${cls === 'cave' ? '<span class="rocks">💥</span>' : ''}</li>`;
    }).join('');
    const flash = gr.flash ? (gr.flash.collapsed ? `<p class="gr-flash bad">Cave-in at ${gr.flash.step * 10} m — the stake of ${fmt(gr.flash.lost)} is lost.</p>`
      : `<p class="gr-flash good">${gr.flash.bottom ? 'You reached the bottom! ' : ''}Cashed out ${fmt(gr.flash.payout)} chips at ${gr.flash.multiplier.toFixed(2)}× (+${fmt(gr.flash.payout - gr.flash.stake)})</p>`) : '';
    body.innerHTML = `
      <div class="gr-top"><span>Chips <b>${fmt(chips)}</b></span><span>Risk per tunnel <b>${L.risk} %</b></span></div>
      <ol class="gr-shaft"><li class="surface"><span class="depth">Surface</span><span class="mult">1.00×</span>${!step && !gr.flash ? '<span class="miner">⛏</span>' : ''}</li>${rows}</ol>
      ${flash}
      ${R ? `
        <div class="gr-live">
          <div><small>Stake</small><b>${fmt(R.stake)}</b></div>
          <div><small>Now</small><b>${R.multiplier.toFixed(2)}×</b></div>
          <div><small>Cash-out</small><b class="gold">${fmt(R.cashout)}</b></div>
        </div>
        <div class="gr-actions">
          <button class="btn btn-gold" data-gr-dig ${R.next ? '' : 'disabled'}>Dig deeper → ${R.next ? R.next.toFixed(2) + '×' : ''}</button>
          <button class="btn btn-outline" data-gr-cash>${R.step ? `Cash out ${fmt(R.cashout)}` : 'Take my stake back'}</button>
        </div>` : `
        <div class="gr-levels">${Object.entries(cfg.levels).map(([k, l]) => `<button data-gr-level="${k}" class="${k === level ? 'on' : ''}"><b>${l.name}</b><small>${l.risk} % · up to ${l.ladder[l.ladder.length - 1].toFixed(0)}×</small></button>`).join('')}</div>
        <div class="gr-stake">
          <label>Stake<input type="number" inputmode="numeric" min="${cfg.minStake}" max="${cfg.maxStake}" value="${gr.stake}" data-gr-stake></label>
          <div class="gr-quick"><button data-q="half">½</button><button data-q="double">×2</button><button data-q="10">10</button><button data-q="100">100</button><button data-q="500">500</button><button data-q="max">Max</button></div>
        </div>
        <button class="btn btn-gold wide" data-gr-start>Start digging</button>
        <p class="fine">Each tunnel raises the multiplier — and may cave in. Cash out whenever you like. Play money only.</p>`}`;
    const sh = body.querySelector('.gr-shaft');
    const cur = sh.querySelector('.miner, .rocks');
    if (cur) cur.closest('li').scrollIntoView({ block: 'center' });
    const stakeIn = body.querySelector('[data-gr-stake]');
    const setStake = (v) => { gr.stake = Math.max(cfg.minStake, Math.min(cfg.maxStake, Math.floor(v) || cfg.minStake)); if (stakeIn) stakeIn.value = gr.stake; localStorage.setItem('cg.gr.stake', gr.stake); };
    if (stakeIn) stakeIn.oninput = () => { gr.stake = Number(stakeIn.value) || 0; };
    body.querySelectorAll('[data-q]').forEach((b) => { b.onclick = () => {
      const q = b.dataset.q;
      setStake(q === 'half' ? gr.stake / 2 : q === 'double' ? gr.stake * 2 : q === 'max' ? Math.min(cfg.maxStake, chips) : Number(q));
    }; });
    body.querySelectorAll('[data-gr-level]').forEach((b) => { b.onclick = () => { gr.level = b.dataset.grLevel; localStorage.setItem('cg.gr.level', gr.level); gr.flash = null; paintGoldRush(body); }; });
    const act = async (path, payload) => {
      if (gr.busy) return null;
      gr.busy = true;
      const r = await api(path, payload || {});
      gr.busy = false;
      if (!r.ok) { toast(r.data.error, { kind: 'bad' }); return null; }
      if (r.data.wallet) { App.wallet = { ...App.wallet, ...r.data.wallet }; renderAccount(); }
      return r.data;
    };
    const start = body.querySelector('[data-gr-start]');
    if (start) start.onclick = async () => {
      setStake(Number(stakeIn.value));
      const d = await act('/api/goldrush/start', { stake: gr.stake, level: gr.level });
      if (d) { gr.round = d.round; gr.flash = null; Sound.play('chips'); paintGoldRush(body); }
    };
    const dig = body.querySelector('[data-gr-dig]');
    if (dig) dig.onclick = async () => {
      dig.classList.add('digging');
      const d = await act('/api/goldrush/dig');
      if (!d) { dig.classList.remove('digging'); return; }
      const stake = gr.round ? gr.round.stake : 0;
      if (d.collapsed) { gr.flash = { collapsed: true, step: d.step, lost: d.lost }; gr.round = null; Sound.play('fold'); body.classList.add('shake'); setTimeout(() => body.classList.remove('shake'), 500); }
      else if (d.bottom) { gr.flash = { bottom: true, step: d.step, payout: d.payout, multiplier: d.multiplier, stake }; gr.round = null; Sound.play('win'); coinPop(d.payout, 'Gold Rush', 'chip'); }
      else { gr.round = d.round; Sound.play('deal'); }
      paintGoldRush(body);
    };
    const cash = body.querySelector('[data-gr-cash]');
    if (cash) cash.onclick = async () => {
      const d = await act('/api/goldrush/cashout');
      if (!d) return;
      gr.flash = d.step ? { step: d.step, payout: d.payout, multiplier: d.multiplier, stake: gr.round ? gr.round.stake : 0 } : null;
      gr.round = null;
      if (d.step) { Sound.play('win'); coinPop(d.payout, `${d.multiplier.toFixed(2)}× at ${d.step * 10} m`, 'chip'); }
      paintGoldRush(body);
    };
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

  async function paintGiftFriends(box) {
    const r = await api('/api/friends');
    const friends = r.ok ? r.data.friends.filter((f) => f.status === 'friend') : [];
    box.replaceChildren();
    if (!friends.length) { box.appendChild(h('p', 'muted', 'Add friends first — then you can send them chips from here.')); return; }
    for (const f of friends) {
      const b = h('button', 'pill', `<span class="mini-avatar">${avatarMarkup(f.avatar, f.username)}</span>${esc(f.username)}`);
      b.onclick = () => sendChipsModal(f.username);
      box.appendChild(b);
    }
  }

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
    : w.inPlay > 0
      ? `<p class="muted">Your ${fmt(w.inPlay)} chips are at a table right now. Leave the table and they come back to your bankroll — then you can exchange them.</p>`
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
      <section class="desk gift-desk">
        <h4>💸 Chips for friends</h4>
        <p>Send chips from your bankroll to a friend — up to 50,000 a day (after 20 rounds played).</p>
        <div class="gift-friends" data-gift-friends><p class="muted">Loading…</p></div>
      </section>
      <p class="fine center">Play money only — nothing here can be bought with or exchanged for real money.</p>`;
    paintGiftFriends(body.querySelector('[data-gift-friends]'));
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
      <div class="mb-hello"><span class="mb-av">${myAvatar()}</span><div><small>${greeting()}</small><b>${esc(a.username)}</b></div></div>
      <button class="mb-stat" data-open="bank" title="The Bank"><small>Chips</small><b><i class="ico-chip"></i>${w ? fmt(w.chips) : '…'}</b></button>
      <button class="mb-stat" data-open="shop" title="The Shop"><small>Coins</small><b><i class="ico-coin"></i>${w ? fmt(w.coins) : '…'}</b></button>
      <button class="mb-stat" data-open="friends" title="Friends"><small>Friends online</small><b>${p.onlineFriends ?? '–'}${p.requests ? ` <em>· ${p.requests} new request${p.requests === 1 ? '' : 's'}</em>` : ''}</b></button>
      ${w && w.daily.ready ? `<button class="mb-bonus" data-mb-bonus>🎁 Daily bonus · day ${w.daily.nextDay}</button>` : ''}
      ${App.questSummary ? `<button class="mb-quests" data-mb-quests>🎯 Quests ${App.questSummary.daily.filter((q) => q.done).length}/3</button>` : ''}
      ${a.isOwner ? '<a class="mb-owner" href="/admin" title="Owner dashboard">♛ Owner</a>' : ''}
      <button class="btn btn-navy mb-play" data-mb-play>Quick seat</button>`;
    const bonus = bar.querySelector('[data-mb-bonus]');
    if (bonus) bonus.onclick = () => dailyModal();
    bar.querySelector('[data-mb-play]').onclick = () => { const t = quickSeat(); if (t) joinTable(t.id); };
    const qb = bar.querySelector('[data-mb-quests]');
    if (qb) qb.onclick = () => App.openQuests();
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
    boxes: ['🎁 Boxes', 'Skins now come only from boxes: one for every category, and a Mystery Box with everything. You always get a skin you don\'t own yet. Look inside before you open one.'],
    cardback: ['Card backs', 'The back of your face-down cards — everyone at your table sees it.'],
    cardface: ['Card faces', 'How the faces of the cards are printed — on your screen.'],
    felt: ['Table felt', 'The cloth of every table you sit at — on your screen.'],
    background: ['Backgrounds', 'The wallpaper of the club and the rooms — on your screen.'],
    chips: ['Chip sets', 'Your chips when you bet — everyone at your table sees them.'],
    avatar: ['Portraits', 'A frame around your initials on your nameplate — everyone at your table sees it.'],
    badge: ['Titles', 'A title written before your name — everyone at your table and on your profile sees it.'],
    tag: ['Tags', 'A small label next to your name — everyone at your table and on your profile sees it. Rare tags come from the Tag box, the others you earn with achievements.'],
    victory: ['Victory effects', 'A big moment over your seat when you win a round — everyone at your table sees it. Tap a preview to play it.'],
    turn: ['Turn markers', 'Your emblem when it is your turn — everyone at your table sees it.'],
    gesture: ['Gestures', 'Little courtesies for the table. Every gesture you own is yours to use — open the hat button at any table.'],
  };

  // ----- skin boxes -----
  const RARITY = { common: ['Common', '#B8C4BE'], rare: ['Rare', '#4FA3FF'], epic: ['Epic', '#B36BFF'], legendary: ['Legendary', '#F2C14E'] };
  let boxFocus = null;   // a box whose preview to open right away
  const BOX_LOOK = { mystery: ['🎲', 'Mystery Box'], cardback: ['🂠', 'Card back box'], cardface: ['🃏', 'Card face box'], felt: ['🟩', 'Table felt box'], chips: ['🪙', 'Chip set box'],
    background: ['🖼️', 'Background box'], avatar: ['👤', 'Portrait box'], badge: ['🎩', 'Title box'], tag: ['🏷️', 'Tag box'], turn: ['⏳', 'Turn marker box'], victory: ['🎆', 'Victory effect box'], gesture: ['👋', 'Gesture box'] };
  function paintBoxes(body) {
    const w = App.wallet;
    const grid = h('div', 'box-grid');
    for (const b of Object.values(App.shop.boxes)) {
      const [icon, name] = BOX_LOOK[b.id] || ['🎁', b.id];
      const inside = App.shop.items.filter((i) => !i.retired && !i.earned && (b.id === 'mystery' || i.slot === b.id));
      const have = inside.filter((i) => w.owned.includes(i.id)).length;
      const card = h('div', 'box-card box-' + b.id + (have === inside.length ? ' complete' : ''));
      card.innerHTML = `
        <div class="chest"><div class="chest-lid"></div><div class="chest-body"></div><div class="chest-glow"></div><span class="chest-icon">${icon}</span></div>
        <b>${esc(name)}</b>
        <small class="box-count">${have} / ${inside.length} collected</small>`;
      const row = h('div', 'box-pay');
      for (const kind of ['coins', 'chips']) {
        const btn = h('button', 'pill ' + (kind === 'coins' ? 'gold' : ''), `<i class="${kind === 'coins' ? 'ico-coin' : 'ico-chip'}"></i>${fmt(b[kind])}`);
        btn.disabled = w[kind] < b[kind] || have === inside.length;
        btn.onclick = () => openBox(body, b.id, kind, btn);
        row.appendChild(btn);
      }
      card.appendChild(row);
      const pv = h('button', 'link box-preview-btn', have === inside.length ? '✓ All collected' : '👁 What is inside?');
      pv.onclick = () => boxPreview(body, b.id);
      card.appendChild(pv);
      grid.appendChild(card);
    }
    body.appendChild(grid);
    body.appendChild(h('p', 'fine', 'Play money only: coins and chips cannot be bought with real money or paid out. Dearer skins are rarer. You never get a skin twice.'));
    if (boxFocus) { const f = boxFocus; boxFocus = null; boxPreview(body, f); }
  }
  // The preview: every skin in the box with your chance to draw it.
  async function boxPreview(body, boxId) {
    const r = await api('/api/shop/box/' + boxId);
    if (!r.ok) { toast(r.data.error || 'Could not load the box', { kind: 'bad' }); return; }
    const [icon, name] = BOX_LOOK[boxId] || ['🎁', boxId];
    const ov = h('div', 'box-preview');
    const list = r.data.items.slice().sort((a, b) => b.chance - a.chance);
    ov.innerHTML = `<div class="bp-card"><button class="bp-x" aria-label="Close">✕</button><h3>${icon} <span>${esc(name)}</span></h3>
      <p class="fine">Your chance for each skin. Skins you already have can't come out again.</p><div class="bp-grid"></div></div>`;
    const grid = ov.querySelector('.bp-grid');
    for (const x of list) {
      const item = App.shop.items.find((i) => i.id === x.id);
      if (!item) continue;
      const [rName, rColor] = RARITY[x.rarity];
      const cell = h('div', 'bp-item' + (x.owned ? ' owned' : ''));
      cell.style.setProperty('--rc', rColor);
      cell.appendChild(shopPreview(item));
      cell.appendChild(h('b', '', esc(item.name)));
      cell.appendChild(h('em', '', x.owned ? '✓ Yours' : `<span style="color:${rColor}">${rName}</span> · ${x.chance < 0.01 ? (x.chance * 100).toFixed(1) : Math.round(x.chance * 100)} %`));
      grid.appendChild(cell);
    }
    ov.querySelector('.bp-x').onclick = () => ov.remove();
    ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
    document.body.appendChild(ov);
  }
  async function openBox(body, boxId, pay, btn) {
    btn.disabled = true;
    const r = await walletAction('/api/shop/box', { box: boxId, pay });
    btn.disabled = false;
    if (!r) return;
    const item = App.shop.items.find((i) => i.id === r.item);
    const [rName, rColor] = RARITY[r.rarity];
    const ov = h('div', 'box-reveal box-' + boxId);
    ov.style.setProperty('--rc', rColor);
    ov.innerHTML = `<div class="chest big shaking"><div class="chest-lid"></div><div class="chest-body"></div><div class="chest-glow"></div></div><div class="reveal hidden"></div>`;
    document.body.appendChild(ov);
    Sound.play('chips');
    setTimeout(() => {
      ov.querySelector('.chest').classList.replace('shaking', 'opening');
      if (window.Effects && (r.rarity === 'legendary' || r.rarity === 'epic')) window.Effects.play(r.rarity === 'legendary' ? 'fireworks' : 'confetti', ov, window.innerWidth / 2, window.innerHeight / 2, { scale: 1 });
    }, 1100);
    setTimeout(() => {
      const rev = ov.querySelector('.reveal');
      rev.classList.remove('hidden');
      rev.innerHTML = `<small style="color:${rColor}">${rName}</small><h3>${esc(item ? item.name : r.item)}</h3>`;
      if (item) rev.insertBefore(shopPreview(item), rev.querySelector('h3'));
      const row = h('div', 'row gap');
      if (item && item.slot !== 'gesture') {
        const eq = h('button', 'btn btn-navy', 'Use it now');
        eq.onclick = async () => { await walletAction('/api/shop/equip', { slot: item.slot, item: item.id }); ov.remove(); paintLounge(body); };
        row.appendChild(eq);
      }
      const ok = h('button', 'btn btn-outline', 'Great!');
      ok.onclick = () => { ov.remove(); paintLounge(body); };
      row.appendChild(ok);
      rev.appendChild(row);
      Sound.play('win');
    }, 1700);
  }
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
    } else if (item.slot === 'victory') {
      const fx = h('div', 'mini-fx', `<span class="mini-fx-play">${item.preview === 'classic' ? 'No effect' : '▶ Play'}</span>`);
      if (item.preview !== 'classic') fx.onclick = (e) => { e.stopPropagation(); window.Effects.play(item.preview, fx, 60, 70, { scale: 0.32 }); };
      box.appendChild(fx);
    } else if (item.slot === 'gesture') box.appendChild(h('span', 'mini-gesture', `<b>${esc(App.account.username)}</b> ${esc(item.preview)}`));
    else if (item.slot === 'avatar') box.appendChild(h('span', 'mini-avatar', avatarMarkup(item.preview === 'classic' ? null : item.preview, App.account.username)));
    else if (item.slot === 'tag') box.appendChild(h('span', 'mini-badge', `${esc(App.account.username)}${item.preview === 'classic' ? '' : tagMarkup(item.preview)}`));
    else box.appendChild(h('span', 'mini-badge', `${item.preview === 'classic' ? '' : titleMarkup(item.preview)}${esc(App.account.username)}`));
    return box;
  }
  function paintShop(body) {
    const w = App.wallet;
    body.appendChild(h('div', 'shop-head', `<span>Your coins: <b><i class="ico-coin"></i>${fmt(w.coins)}</b></span>`));
    body.appendChild(h('p', 'fine', esc(SLOT_INFO.boxes[1])));
    const go = h('button', 'pill coll-link', '🗃️ To your collection');
    go.onclick = () => { loungeTab = 'collection'; paintLounge(body); };
    body.appendChild(go);
    paintBoxes(body);
  }

  // ----- the collection: every category, what you own and what is still in the boxes -----
  let collSlot = 'cardback';
  let collSets = null;   // categories completed (from the quests)
  async function paintCollection(body) {
    const w = App.wallet;
    if (!collSets) { const r = await api('/api/quests'); collSets = r.ok ? r.data.sets || [] : []; if (r.ok) App.questSummary = r.data; }
    const achOf = (tag) => (App.questSummary ? App.questSummary.achievements.find((a) => a.tag === tag) : null);
    const inSlot = (slot) => App.shop.items.filter((i) => i.slot === slot && !i.retired);
    const total = App.shop.items.filter((i) => !i.retired).length;
    const mine = App.shop.items.filter((i) => !i.retired && w.owned.includes(i.id)).length;
    body.appendChild(h('div', 'shop-head coll-head', `<span>Your collection: <b>${fmt(mine)} / ${fmt(total)}</b></span>`));
    const sub = h('div', 'subtabs');
    for (const slot of App.shop.slots) {
      const items = inSlot(slot);
      const have = items.filter((i) => w.owned.includes(i.id)).length;
      const b = h('button', (slot === collSlot ? 'on' : '') + (collSets.includes(slot) ? ' complete' : ''), `${SLOT_INFO[slot][0]} <small>${have}/${items.length}</small>`);
      b.onclick = () => { collSlot = slot; paintLounge(body); };
      sub.appendChild(b);
    }
    body.appendChild(sub);
    body.appendChild(h('p', 'fine', esc(SLOT_INFO[collSlot][1])));
    if (collSets.includes(collSlot)) body.appendChild(h('p', 'coll-done', '🏁 Category complete — gold frame earned'));
    else body.appendChild(h('p', 'fine coll-hint', `Complete a whole category for ${fmt((App.questSummary && App.questSummary.setReward) || 300)} coins and a gold frame.`));
    const slot = collSlot;
    const grid = h('div', 'shop-grid' + (collSets.includes(slot) ? ' set-complete' : ''));
    const isGesture = slot === 'gesture';
    const equipped = w.equipped[slot];
    if (!isGesture) {
      const def = h('div', 'shop-item' + (!equipped ? ' on' : ''));
      def.appendChild(shopPreview({ slot, preview: 'classic' }));
      def.appendChild(h('b', '', slot === 'badge' ? 'No title' : slot === 'tag' ? 'No tag' : slot === 'avatar' ? 'Initials' : slot === 'victory' ? 'No effect' : 'House classic'));
      def.appendChild(h('em', '', 'Free'));
      const db = h('button', 'pill', equipped ? 'Use' : 'In use');
      db.disabled = !equipped;
      db.onclick = async () => { if (await walletAction('/api/shop/equip', { slot, item: null })) paintLounge(body); };
      def.appendChild(db);
      grid.appendChild(def);
    }
    // Retired items are only shown to players who own them; owned first.
    const items = App.shop.items.filter((i) => i.slot === slot && (!i.retired || w.owned.includes(i.id)))
      .sort((a, b) => w.owned.includes(b.id) - w.owned.includes(a.id));
    for (const item of items) {
      const owned = w.owned.includes(item.id);
      const on = equipped === item.id;
      const el = h('div', 'shop-item' + (on ? ' on' : '') + (owned ? ' owned' : '') + (item.animated ? ' animated' : ''));
      el.appendChild(shopPreview(item));
      if (item.animated) el.appendChild(h('span', 'anim-tag', '✨ Animated'));
      el.appendChild(h('b', '', esc(item.name)));
      const [rName, rColor] = RARITY[item.rarity || 'common'];
      const ach = item.earned ? achOf(item.id) : null;
      el.appendChild(h('em', '', owned ? (item.retired ? 'Retired · still yours' : `<span style="color:${rColor}">${rName}</span> · yours`)
        : item.earned ? `🏆 Achievement: <span class="ach-name"></span>` : `<span style="color:${rColor}">${rName}</span> · in the box`));
      if (ach) el.querySelector('.ach-name').textContent = ach.text;
      if (!owned) el.classList.add('locked');
      const b = h('button', 'pill');
      if (isGesture && owned) { b.textContent = 'Use at the table'; b.disabled = true; }
      else if (on) { b.textContent = 'In use'; b.disabled = true; }
      else if (owned) { b.textContent = 'Use'; b.onclick = async () => { if (await walletAction('/api/shop/equip', { slot: item.slot, item: item.id })) paintLounge(body); }; }
      else if (item.earned) { b.textContent = '🎯 To the quests'; b.onclick = () => { loungeTab = 'quests'; paintLounge(body); }; }
      else {
        b.textContent = '🎁 To the box';
        b.className = 'pill gold';
        b.onclick = () => { loungeTab = 'shop'; boxFocus = item.slot; paintLounge(body); };
      }
      el.appendChild(b);
      grid.appendChild(el);
    }
    body.appendChild(grid);
  }
  App.openCollection = () => openLounge('collection');

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
      row.appendChild(btn('🃏 Play together', '', () => playTogether(f.username)));
      row.appendChild(btn('💸 Send chips', 'gold', () => sendChipsModal(f.username)));
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

  // Open a private Hold'em table and invite a friend to it.
  async function playTogether(username) {
    const game = await new Promise((resolve) => {
      openModal((card) => {
        modalHead(card, 'Play together', `A private table for you and ${esc(username)}`);
        const g = h('div', 'priv-games');
        for (const [id, name, icon] of PRIV_GAMES) {
          const b = h('button', '', `<i>${icon}</i>${name}`);
          b.onclick = () => resolve(id);
          g.appendChild(b);
        }
        card.appendChild(g);
        card.appendChild(h('p', 'fine', `${esc(username)} gets an invitation and can join with one tap.`));
      });
    });
    closeModal();
    const r = await api('/api/private', { game });
    if (!r.ok) { toast(r.data.error, { kind: 'bad' }); return; }
    const table = r.data.id;
    const inv = await api('/api/friends/invite', { username, table });
    toast(inv.ok ? `Invitation sent to ${username}.` : inv.data.error, { kind: inv.ok ? 'good' : 'bad' });
    joinTable(table);
  }
  App.playTogether = playTogether;

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

  // ----- send chips to a friend -----
  function sendChipsModal(username) {
    openModal((card) => {
      modalHead(card, 'A gift among friends', `Send chips to ${esc(username)}`);
      const have = App.wallet ? App.wallet.chips : 0;
      const form = h('form', 'mform');
      form.innerHTML = `
        <div class="gift-quick">${[500, 1000, 5000, 10000].map((v) => `<button type="button" class="pill" data-v="${v}">${fmt(v)}</button>`).join('')}</div>
        <label>Chips<input name="n" type="number" min="100" step="100" value="1000" inputmode="numeric" required></label>
        <p class="fine">From your bankroll (you have ${fmt(have)}). Up to 50,000 chips a day; you need 20 rounds played before you can send.</p>
        <p class="merror" role="alert"></p>
        <button class="btn btn-navy wide" type="submit">Send the chips</button>`;
      card.appendChild(form);
      form.querySelectorAll('[data-v]').forEach((b) => { b.onclick = () => { form.n.value = b.dataset.v; }; });
      form.onsubmit = async (e) => {
        e.preventDefault();
        const amount = Math.floor(Number(form.n.value) || 0);
        if (!confirm(`Send ${fmt(amount)} chips to ${username}?`)) return;
        const r = await walletAction('/api/friends/chips', { username, amount });
        if (!r) return;
        closeModal();
        coinPop(r.sent, `Sent to ${username}`, 'chip');
        Sound.play('chips');
      };
    });
  }
  App.sendChipsModal = sendChipsModal;

  // ----- presence: heartbeat, invites, friend requests -----
  const seenInvites = new Set();
  async function pollPresence() {
    if (!App.account || document.visibilityState !== 'visible') return;
    const r = await api('/api/presence');
    if (!r.ok) return;
    $('navDot').classList.toggle('hidden', !r.data.requests);
    App.presence = r.data;
    for (const n of r.data.questNews || []) {
      coinPop(n.coins, n.kind === 'achievement' ? `🏆 ${n.text}` : n.kind === 'set' ? `🏁 ${(SLOT_INFO[n.text.slice(4)] || [n.text])[0]} complete` : `✅ ${n.text}`);
      if (n.kind === 'set') collSets = null;
      Sound.play('win');
      loadWallet();
    }
    if ((r.data.questNews || []).length) loadQuestSummary();
    for (const g of r.data.gifts || []) {
      coinPop(g.amount, `🎁 from ${g.from}`, 'chip');
      toast(`${g.from} sent you ${fmt(g.amount)} chips!`, { kind: 'good', timeout: 8000 });
      Sound.play('win');
      loadWallet();
    }
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
  const MODE_NAMES = { friends: "Hold'em with friends", bots: "Hold'em with bots", draw: 'Five Card Draw', chess: 'Chess', blackjack: 'Blackjack', durak: 'Durak', roulette: 'Roulette', flamingo: 'Flamingo', goldrush: 'Gold Rush' };
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
      <div><h3>${titleMarkup(p.badge)}${esc(p.username)}${tagMarkup(p.tag)}</h3>
      <p class="muted"><i class="presence ${p.online ? 'on' : ''}"></i>${p.online ? (p.where ? `Playing at ${esc(p.where.tableName)}` : 'Online') : 'Offline'} · Member since ${new Date(p.memberSince).toLocaleDateString([], { month: 'long', year: 'numeric' })} · ${p.friends} friend${p.friends === 1 ? '' : 's'}</p></div></div>
      ${highlightsHtml(p)}
      ${statsTable(p.stats)}`;
  }
  // The profile's highlights: favourite game, win rate, biggest pot, this week, achievements, recent form.
  function highlightsHtml(p) {
    const x = p.highlights;
    if (!x || !x.hands) return '';
    const NAME = { friends: "Hold'em", bots: "Hold'em (bots)", blackjack: 'Blackjack', roulette: 'Roulette', durak: 'Durak', flamingo: 'Flamingo', goldrush: 'Gold Rush', tourney: 'Sit & Go' };
    const tile = (label, value, sub) => `<div class="hl"><small>${label}</small><b>${value}</b>${sub ? `<em>${sub}</em>` : ''}</div>`;
    const tiles = [
      tile('Favourite game', esc(NAME[x.favorite] || x.favorite || '–')),
      tile('Rounds played', fmt(x.hands), `${x.winRate}% won`),
      tile('Biggest pot', x.biggestPot ? `<i class="ico-chip"></i>${fmt(x.biggestPot)}` : '–'),
      tile('Best game', x.best ? esc(NAME[x.best.mode] || x.best.mode) : '–', x.best ? `+${fmt(x.best.net)} chips` : ''),
      tile('This week', x.week ? `<span>Place ${x.week.place}</span>` : '–', x.week ? `${x.week.net > 0 ? '+' : ''}${fmt(x.week.net)} chips` : ''),
      tile('Achievements', `${x.achievements.length} / ${x.achievementsTotal}`),
    ];
    const form = p.form && p.form.length ? `<div class="hl-form"><small>Recent games</small><div>${p.form.slice().reverse().map((f) =>
      `<i class="${f.won ? 'w' : f.net < 0 ? 'l' : 'n'}" title="${esc(NAME[f.mode] || f.mode)}${['durak', 'flamingo'].includes(f.mode) ? '' : ` ${f.net > 0 ? '+' : ''}${f.net}`}">${f.won ? 'W' : f.net < 0 ? 'L' : '–'}</i>`).join('')}</div></div>` : '';
    const ach = x.achievements.length ? `<div class="hl-ach">${x.achievements.map((t) => `<span>🏅 ${esc(t)}</span>`).join('')}</div>` : '';
    return `<div class="hl-grid">${tiles.join('')}</div>${form}${ach}`;
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
        if (p.friendship === 'friends') btn('🎁 Send chips', 'btn-outline', () => sendChipsModal(p.username));
        if (p.where && p.friendship === 'friends' && p.where.table !== App.tableId) btn(`Join at ${p.where.tableName}`, 'btn-outline', () => { closeModal(); joinTable(p.where.table); });
      }
      card.appendChild(row);
    });
  }
  App.openProfile = openProfile;

  // ================= LEADERBOARD =================
  // The weekly ranking: chips won this week, prizes for the top three.
  async function paintWeekly(body, note) {
    note.textContent = '';
    body.innerHTML = '<p class="muted">Loading…</p>';
    const r = await api('/api/leaderboard/weekly');
    if (!r.ok) { body.textContent = 'Could not load the ranking.'; return; }
    const d = r.data;
    const medals = ['🥇', '🥈', '🥉'];
    const left = Math.max(0, d.endsAt - Date.now());
    const days = Math.floor(left / 86400000), hours = Math.floor((left % 86400000) / 3600000);
    const mine = App.account && d.me;
    body.innerHTML = `
      <div class="wk-head">
        <div class="wk-prizes">${d.prizes.map((p, i) => `<span><b>${medals[i]}</b><i class="ico-coin"></i>${fmt(p)}</span>`).join('')}</div>
        <p class="wk-ends">Ends in <b>${days ? `${days} d ` : ''}${hours} h</b></p>
      </div>
      <p class="fine">Chips won this week in Hold'em against real people, Blackjack and Roulette. Every Monday the best three receive coins (at least ${d.minHands} hands and more chips won than lost).</p>
      ${mine ? `<p class="wk-me">You: place <b>${d.me.place}</b> · <span class="${d.me.net >= 0 ? 'pos' : 'neg'}">${d.me.net > 0 ? '+' : ''}${fmt(d.me.net)}</span> · ${fmt(d.me.hands)} hands${d.me.hands < d.minHands ? ` <em>(${d.minHands - d.me.hands} more for a prize)</em>` : ''}</p>` : ''}
      ${d.rows.length ? `<table class="stats lb"><thead><tr><th>#</th><th>Member</th><th>Chips won</th><th>Hands</th></tr></thead><tbody>
        ${d.rows.map((x) => `<tr class="${App.account && x.username.toLowerCase() === App.account.username.toLowerCase() ? 'me' : ''}"><td>${medals[x.place - 1] || x.place}</td><td><button class="link" data-prof="${esc(x.username)}">${esc(x.username)}</button></td>
          <td class="${x.net >= 0 ? 'pos' : 'neg'}">${x.net > 0 ? '+' : ''}${fmt(x.net)}</td><td>${fmt(x.hands)}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">Nobody has played this week yet — the first hand takes the lead.</p>'}
      ${d.last.winners.length ? `<div class="wk-last"><h4>Last week's winners</h4>${d.last.winners.map((w) => `<span>${medals[w.place - 1]} <b>${esc(w.username)}</b> <em>+${fmt(w.prize)}</em><i class="ico-coin"></i></span>`).join('')}</div>` : ''}`;
    body.querySelectorAll('[data-prof]').forEach((b) => { b.onclick = () => openProfile(b.dataset.prof); });
  }

  async function openLeaderboard(mode = 'week') {
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
        goldrush: 'Gold Rush digs. Ranked by chips won.',
      };
      const load = async (m) => {
        if (m === 'week') return paintWeekly(body, note);
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
      tabs(card, [['week', 'This week'], ['friends', 'Hold\'em'], ['bots', 'vs Bots'], ['blackjack', 'Blackjack'], ['durak', 'Durak'], ['roulette', 'Roulette'], ['flamingo', 'Flamingo'], ['goldrush', 'Gold Rush']], load, mode);
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
    chess: `<ol class="rules-list">
      <li>Normal chess rules: checkmate wins. Stalemate, too little material, threefold repetition, fifty moves without a capture or pawn move, or an agreed draw end in a <b>draw</b> — then no chips change hands.</li>
      <li><b>The stake:</b> every game is played for the table's stake. The winner takes it from the loser's table chips.</li>
      <li><b>The doubling cube:</b> on your turn, before you move, you may <b>double</b>. Your opponent <b>takes</b> (the game is now for twice as much, and only they may double next) or <b>declines</b> and loses the current stake right away. A double needs both players to have the doubled stake.</li>
      <li><b>The clock:</b> each player has a few minutes for the whole game. Out of time = lost (a draw if the opponent can no longer mate).</li>
      <li>You can offer a draw or resign at any time. Leaving the table during a game loses it.</li>
      <li>Tap a piece to see where it can go, then tap the square. Play a friend, anyone at the table, or a bot (three strengths).</li></ol>`,
    draw: `<ol class="rules-list">
      <li>Everyone receives <b>five private cards</b> — there are no shared cards.</li>
      <li><b>First betting round:</b> fold, check, call or raise, as in Hold'em (No-Limit, with blinds).</li>
      <li><b>The draw:</b> tap the cards you want to swap and get new ones — up to <b>three</b>, or <b>four</b> if the card you keep is an ace. Or stand pat and keep all five.</li>
      <li><b>Second betting round</b>, then the showdown: the best five-card hand wins the pot.</li></ol><h4>The hands, from best to worst</h4><div id="rankings"></div>`,
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
  RULES.goldrush = `<ol class="rules-list">
      <li><b>Goal:</b> dig as deep as you dare and cash out before the tunnel caves in. A solo game with your own chips.</li>
      <li>Choose a level and a stake (10–5,000 chips), then <b>Start digging</b>.</li>
      <li>Every <b>Dig deeper</b> takes the miner one tunnel down and raises the multiplier — but the tunnel may cave in: Easy 8 %, Medium 16 %, Hard 28 %, Extreme 45 % per tunnel.</li>
      <li><b>Cash out</b> whenever you like: you get stake × multiplier. Reach the bottom and you are paid automatically.</li>
      <li>A cave-in loses the stake. Every dig is decided by the server; the house keeps 3 % on average.</li></ol>`;
  // German rules (shown when the site is in German).
  const RULES_DE = {
    chess: `<ol class="rules-list">
      <li>Normale Schachregeln: Schachmatt gewinnt. Patt, zu wenig Material, dreifache Stellungswiederholung, 50 Züge ohne Schlagen oder Bauernzug oder ein vereinbartes Remis sind ein <b>Remis</b> – dann wandern keine Chips.</li>
      <li><b>Der Einsatz:</b> Jede Partie wird um den Einsatz des Tisches gespielt. Der Sieger bekommt ihn aus den Tisch-Chips des Verlierers.</li>
      <li><b>Der Verdopplungswürfel:</b> Wenn du am Zug bist, darfst du vor deinem Zug <b>verdoppeln</b>. Dein Gegner <b>nimmt an</b> (die Partie geht jetzt um das Doppelte, und nur er darf als Nächstes verdoppeln) oder <b>lehnt ab</b> und verliert sofort den aktuellen Einsatz. Verdoppeln geht nur, wenn beide den doppelten Einsatz haben.</li>
      <li><b>Die Uhr:</b> Jeder hat ein paar Minuten für die ganze Partie. Zeit abgelaufen = verloren (Remis, wenn der Gegner nicht mehr mattsetzen kann).</li>
      <li>Du kannst jederzeit Remis anbieten oder aufgeben. Wer während einer Partie den Tisch verlässt, verliert sie.</li>
      <li>Tippe eine Figur an, um zu sehen, wohin sie ziehen kann, und dann das Feld. Spiel gegen einen Freund, jeden am Tisch oder einen Bot (drei Stärken).</li></ol>`,
    draw: `<ol class="rules-list">
      <li>Jeder bekommt <b>fünf eigene Karten</b> – es gibt keine gemeinsamen Karten in der Mitte.</li>
      <li><b>Erste Setzrunde:</b> passen, schieben, mitgehen oder erhöhen, wie bei Hold'em (No-Limit, mit Blinds).</li>
      <li><b>Der Tausch:</b> tippe die Karten an, die du tauschen willst, und bekomme neue – bis zu <b>drei</b>, oder <b>vier</b>, wenn die Karte, die du behältst, ein Ass ist. Oder du behältst alle fünf.</li>
      <li><b>Zweite Setzrunde</b>, dann wird aufgedeckt: die beste Fünf-Karten-Hand gewinnt den Pot.</li></ol><h4>Die Hände, von der besten zur schlechtesten</h4><div id="rankings"></div>`,
    holdem: `<ol class="rules-list">
      <li>Jeder bekommt <b>zwei eigene Karten</b>. In die Mitte kommen fünf gemeinsame Karten: drei (Flop), eine (Turn), eine (River).</li>
      <li>Bilde die beste Fünf-Karten-Hand aus deinen zwei Karten und den fünf in der Mitte, in beliebiger Kombination.</li>
      <li>In jeder Setzrunde kannst du <b>passen</b>, <b>schieben</b> (wenn niemand gesetzt hat), einen Einsatz <b>mitgehen</b> oder <b>erhöhen</b>. No-Limit: du darfst alles setzen, was du hast.</li>
      <li>Die beste Hand beim Aufdecken – oder der letzte, der nicht gepasst hat – gewinnt den Pot.</li></ol><h4>Die Hände, von der besten zur schlechtesten</h4><div id="rankings"></div>`,
    blackjack: `<ol class="rules-list">
      <li><b>Ziel:</b> näher an 21 kommen als der Dealer, ohne drüber zu gehen. Du spielst nur gegen den Dealer.</li>
      <li>2–10 zählen ihren Wert, Bube/Dame/König zählen 10, ein Ass 11 oder 1.</li>
      <li>Setz deinen Einsatz, dann bekommen du und der Dealer zwei Karten (eine vom Dealer verdeckt).</li>
      <li><b>Karte</b> zieht eine Karte, <b>Halten</b> beendet. Über 21 ist <b>überkauft</b>. <b>Verdoppeln</b> verdoppelt den Einsatz für genau eine Karte. <b>Teilen</b> macht aus einem Paar zwei Hände.</li>
      <li>Der Dealer zieht bis 16 und bleibt ab 17 stehen. Ein Sieg zahlt 1:1, ein <b>Blackjack</b> (Ass + Zehnerkarte) zahlt <b>3:2</b>, Gleichstand gibt den Einsatz zurück.</li></ol>`,
    durak: `<ol class="rules-list">
      <li><b>Ziel:</b> alle Karten loswerden. Wer am Ende noch Karten hat, ist der <b>Durak</b> – der Dumme.</li>
      <li>36 Karten, Sechs bis Ass. Jeder hält sechs; die Karte unter dem Stapel bestimmt die <b>Trumpf</b>-Farbe.</li>
      <li>Der <b>Angreifer</b> spielt eine Karte gegen den <b>Verteidiger</b> (den nächsten Spieler), der sie mit einer höheren Karte gleicher Farbe oder einem Trumpf schlägt.</li>
      <li>Andere dürfen Karten <b>zulegen</b>, deren Wert schon auf dem Tisch liegt – höchstens sechs pro Runde.</li>
      <li>Alles geschlagen und niemand legt nach: die Karten sind weg (<i>бито</i>) und der Verteidiger greift als Nächstes an. Kann oder will er nicht schlagen, <b>nimmt</b> er alle Karten und verliert seinen Angriff.</li>
      <li>Nach jeder Runde zieht jeder auf sechs nach. Ist der Stapel leer, sind Spieler ohne Karten raus.</li></ol>`,
    roulette: `<ol class="rules-list">
      <li><b>Ziel:</b> erraten, wo die Kugel landet. Das Rad hat die Zahlen <b>0 bis 36</b>; die Null ist grün, die anderen rot oder schwarz.</li>
      <li>Wähle unten einen Chip und tippe aufs Tableau, um zu setzen – so oft und wohin du willst. <b>Zurück</b>, <b>Löschen</b>, <b>Wiederholen</b> und <b>×2</b> helfen.</li>
      <li>Alle setzen gleichzeitig, bis die Uhr abläuft (oder alle <b>Drehen</b> gedrückt haben). Dann: <i>rien ne va plus</i> – das Rad dreht sich.</li>
      <li><b>Auszahlung:</b> eine einzelne Zahl zahlt <b>35 zu 1</b>, ein Dutzend oder eine Kolonne <b>2 zu 1</b>, Rot/Schwarz, Gerade/Ungerade, 1–18/19–36 zahlen <b>1 zu 1</b>.</li>
      <li>Landet die Kugel auf der <b>Null</b>, verlieren alle Einsätze außer einem auf die 0 – das ist der Vorteil des Hauses.</li></ol>`,
    flamingo: `<ol class="rules-list">
      <li><b>Ziel:</b> als Erster alle Karten ablegen. Jeder startet mit <b>7 rosa Karten</b>.</li>
      <li>Vier Farben – <b>Kirsche, Violett, Sonne, Türkis</b> – mit Zahlen 0–9. Leg eine Karte, die zur <b>Farbe</b> oder zur <b>Zahl</b> der obersten Karte passt.</li>
      <li>Nichts passt? <b>Zieh</b> eine Karte – passt sie, darfst du sie sofort legen, sonst <b>passt</b> du.</li>
      <li><b>⊘ Aussetzen</b>: der Nächste setzt aus. <b>⇄ Richtungswechsel</b>: die Spielrichtung dreht sich. <b>+2</b>: der Nächste zieht zwei und setzt aus.</li>
      <li><b>Farbwahl</b>: passt auf alles, du wählst die nächste Farbe. <b>Farbwahl +4</b>: dazu zieht der Nächste vier und setzt aus.</li>
      <li>Nur noch eine Karte? Alle sehen „Letzte Karte!“. Wer zuerst keine Karten mehr hat, gewinnt 10 Münzen.</li></ol>`,
    goldrush: `<ol class="rules-list">
      <li><b>Ziel:</b> so tief graben, wie du dich traust, und auszahlen, bevor der Stollen einstürzt. Ein Einzelspiel mit deinen eigenen Chips.</li>
      <li>Wähle eine Stufe und einen Einsatz (10–5.000 Chips), dann <b>Losgraben</b>.</li>
      <li>Jedes <b>Tiefer graben</b> bringt den Goldsucher einen Stollen tiefer und erhöht den Multiplikator – aber der Stollen kann einstürzen: Leicht 8 %, Mittel 16 %, Schwer 28 %, Extrem 45 % pro Stollen.</li>
      <li><b>Auszahlen</b>, wann du willst: du bekommst Einsatz × Multiplikator. Am Grund wird automatisch ausgezahlt.</li>
      <li>Ein Einsturz kostet den Einsatz. Jeden Schritt entscheidet der Server; das Haus behält im Schnitt 3 %.</li></ol>`,
  };
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
        body.innerHTML = (window.I18n && I18n.lang() === 'de' && RULES_DE[g]) || RULES[g];
        const r = body.querySelector('#rankings');
        if (r) {
          RANKINGS.forEach(([name, cards, desc], i) => {
            const row = h('div', 'rank-row', `<span class="n">${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][i]}</span><span class="cards"></span><span><b>${name}</b><em>${desc}</em></span>`);
            cards.split(' ').forEach((c) => row.querySelector('.cards').appendChild(CardUI.fromCode(c, { size: 30 })));
            r.appendChild(row);
          });
        }
      };
      tabs(card, [['holdem', "Hold'em"], ['blackjack', 'Blackjack'], ['durak', 'Durak'], ['roulette', 'Roulette'], ['flamingo', 'Flamingo'], ['chess', 'Chess'], ['goldrush', 'Gold Rush']], paint, game);
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
