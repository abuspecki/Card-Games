/* =========================================================
   CardGames — shared UI helpers (no dependencies)
   Exposes window.CardUI with:
     CardUI.card(rank, suit, { size })   -> playing card element
     CardUI.back(theme, { size })        -> card back ('holdem' | 'blackjack' | 'durak')
     CardUI.chip(value, { size })        -> chip (5 | 25 | 100 | 500)
     CardUI.chipsFor(amount)             -> best chip values for an amount
     CardUI.fitStage(el)                 -> scales a 1440×900 stage to the window
     CardUI.emit(game, action, detail)   -> fires a 'cardgames:action' event
     CardUI.fmt(n)                       -> 12450 -> "12,450"
   Suits: 'spade' | 'heart' | 'diamond' | 'club'
   Ranks: '2'–'10', 'J', 'Q', 'K', 'A'
   ========================================================= */
(function () {
  const PATHS = {
    spade: 'M12,2C9,7 4,9 4,14C4,16 6,18 8,18C9,18 10,18 11,17C11,17 11.32,19 9,22H15C13,19 13,17 13,17C14,18 15,18 16,18C18,18 20,16 20,14C20,9 15,7 12,2Z',
    heart: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
    diamond: 'M12 1.5L20.5 12L12 22.5L3.5 12Z',
    club: 'M12,2C14.3,2 16.3,4 16.3,6.2C16.3,8.2 15.4,9.4 13.9,9.9C14.6,9.4 15.8,9 16.6,9C19.3,9 21,11 21,13.4C21,15.8 19.3,17.8 16.8,17.8C14.4,17.8 13.2,16 13.2,16C13.2,18.7 14,19.5 15,22H9C10,19.5 10.8,18.7 10.8,16C10.8,16 9.6,17.8 7.2,17.8C4.7,17.8 3,15.8 3,13.4C3,11 4.7,9 7.4,9C8.2,9 9.4,9.4 10.1,9.9C8.6,9.4 7.7,8.2 7.7,6.2C7.7,4 9.7,2 12,2Z'
  };
  const SUIT_NAMES = { spade: 'Spades', heart: 'Hearts', diamond: 'Diamonds', club: 'Clubs' };
  const RANK_NAMES = { A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack' };

  const suitSvg = (suit) =>
    `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${PATHS[suit]}"/></svg>`;

  function card(rank, suit, opts = {}) {
    const el = document.createElement('div');
    el.className = 'card' + (suit === 'heart' || suit === 'diamond' ? ' red' : '');
    el.dataset.rank = rank;
    el.dataset.suit = suit;
    if (opts.size) el.style.setProperty('--w', opts.size + 'px');
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', `${RANK_NAMES[rank] || rank} of ${SUIT_NAMES[suit]}`);
    const s = suitSvg(suit);
    el.innerHTML =
      `<div class="corner tl"><span>${rank}</span>${s}</div>` +
      `<div class="pip">${s}</div>` +
      `<div class="corner br"><span>${rank}</span>${s}</div>`;
    return el;
  }

  function back(theme = 'holdem', opts = {}) {
    const el = document.createElement('div');
    // A card back bought in the shop replaces the room's default back.
    // A player's own card back (everyone sees it on that player's cards) — else the
    // back you bought for your screen, else the room's default back.
    const own = opts.skin !== undefined ? (opts.skin ? 'cb-' + opts.skin : theme) : null;
    el.className = 'card-back ' + (own || (window.CardUI.backOverride && !opts.noOverride ? window.CardUI.backOverride : theme));
    if (opts.size) el.style.setProperty('--w', opts.size + 'px');
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', 'Face-down card');
    el.innerHTML = '<span class="deco"></span><span class="mono">CG</span>';
    return el;
  }

  function chip(value, opts = {}) {
    const el = document.createElement('div');
    el.className = 'chip v' + value;
    const set = opts.set !== undefined ? opts.set : window.CardUI.chipSet; // chip set bought in the shop
    if (set) el.classList.add('cs-' + set);
    el.dataset.v = value;
    if (opts.size) el.style.setProperty('--s', opts.size + 'px');
    el.setAttribute('aria-hidden', 'true');
    return el;
  }

  /** Pick a few chips that visually represent an amount (max 4). */
  function chipsFor(amount) {
    const out = [];
    for (const v of [100000, 25000, 10000, 5000, 1000, 500, 100, 25, 5]) {
      while (amount >= v && out.length < 4) { out.push(v); amount -= v; }
    }
    return out.length ? out : [5];
  }

  /**
   * A real-looking pile of chips for an amount: columns of stacked chips by
   * denomination (biggest on the left), with the amount underneath.
   */
  function stack(amount, opts = {}) {
    const size = opts.size || 34;
    const maxPer = opts.maxPer || 7;          // chips per column
    const maxCols = opts.maxCols || 4;
    const cols = [];
    let left = Math.max(0, Math.round(amount));
    for (const v of [100000, 25000, 10000, 5000, 1000, 500, 100, 25, 5]) {
      const n = Math.floor(left / v);
      if (!n) continue;
      left -= n * v;
      cols.push({ v, n });
    }
    if (!cols.length) cols.push({ v: 5, n: 1 });
    const shown = cols.slice(0, maxCols);
    const step = size * 0.13;
    const tallest = Math.min(maxPer, Math.max(...shown.map((c) => c.n)));
    const el = document.createElement('div');
    el.className = 'chip-stack';
    const pile = document.createElement('div');
    pile.className = 'pile';
    pile.style.width = (shown.length * size * 0.86 + size * 0.14) + 'px';
    pile.style.height = (size + (tallest - 1) * step) + 'px';
    shown.forEach((c, ci) => {
      const n = Math.min(maxPer, c.n);
      for (let k = 0; k < n; k++) {
        const ch = chip(c.v, { size, set: opts.set });
        ch.style.left = (ci * size * 0.86) + 'px';
        ch.style.bottom = (k * step) + 'px';
        pile.appendChild(ch);
      }
    });
    el.appendChild(pile);
    if (opts.label !== false) {
      const lab = document.createElement('span');
      lab.className = 'stack-amt';
      lab.textContent = fmt(amount);
      el.appendChild(lab);
    }
    return el;
  }

  /** Scale a fixed-size stage so it fits its container (or the window). */
  function fitStage(stage, w = 1440, h = 900, box = null) {
    const W = box ? box.clientWidth : window.innerWidth;
    const H = box ? box.clientHeight : window.innerHeight;
    const s = Math.max(0.1, Math.min(W / w, H / h));
    stage.style.width = w + 'px';
    stage.style.height = h + 'px';
    stage.style.transform = `translate(-50%, -50%) scale(${s})`;
    return s;
  }

  /** Our game codes ('As', 'Td', '7h') -> CardUI rank/suit. */
  const SUIT_CODES = { s: 'spade', h: 'heart', d: 'diamond', c: 'club' };
  const rankOf = (code) => (code[0] === 'T' ? '10' : code[0]);
  const suitOf = (code) => SUIT_CODES[code[1]];
  function fromCode(code, opts = {}) {
    if (!code) return back(opts.theme || 'holdem', opts);
    const el = card(rankOf(code), suitOf(code), opts);
    el.dataset.code = code;
    return el;
  }
  function nameOf(code) {
    const r = rankOf(code);
    return `${RANK_NAMES[r] || r} of ${SUIT_NAMES[suitOf(code)]}`;
  }

  /**
   * Every button on the tables calls this. Hook your game logic to it:
   *   document.addEventListener('cardgames:action', e => {
   *     console.log(e.detail); // { game: 'holdem', action: 'raise', amount: 240 }
   *   });
   */
  function emit(game, action, detail = {}) {
    document.dispatchEvent(new CustomEvent('cardgames:action', {
      detail: Object.assign({ game, action }, detail)
    }));
  }

  const fmt = (n) => Number(n).toLocaleString('en-US');

  /** Place an element absolutely with optional rotation. */
  function place(el, x, y, deg = 0) {
    el.classList.add('abs');
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    if (deg) el.style.transform = `rotate(${deg}deg)`;
    return el;
  }

  window.CardUI = { card, back, chip, chipsFor, stack, fitStage, emit, fmt, place, suitSvg, fromCode, nameOf, rankOf, suitOf, SUIT_NAMES, RANK_NAMES, backOverride: null, chipSet: null };
})();
