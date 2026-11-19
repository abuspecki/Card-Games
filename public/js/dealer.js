/* =========================================================
   The dealer: one croupier for every table.
   Each table view says where the dealer stands (TableUI.<game>.dealer =
   { land: {x, y, size}, port: {...} }); this file draws the figure, the tip
   button and menu (any amount), and the little moments: dealing, the bow
   after a tip, and comments after a round. A dealer who was tipped recently
   is in a better mood and talks more.
   ========================================================= */
(function () {
  const SVG = `<svg viewBox="0 0 120 120" aria-hidden="true">
    <defs>
      <linearGradient id="dgSkin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F3D2B8"/><stop offset=".6" stop-color="#E2B293"/><stop offset="1" stop-color="#C98F70"/></linearGradient>
      <radialGradient id="dgFace" cx=".42" cy=".38" r=".75"><stop offset="0" stop-color="#F8DEC9"/><stop offset=".62" stop-color="#E8BA9A"/><stop offset="1" stop-color="#C98F70"/></radialGradient>
      <linearGradient id="dgHair" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#433024"/><stop offset="1" stop-color="#1A120D"/></linearGradient>
      <linearGradient id="dgVest" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#26090F"/><stop offset=".5" stop-color="#5E1B28"/><stop offset="1" stop-color="#26090F"/></linearGradient>
      <linearGradient id="dgShirt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#DAD5CB"/></linearGradient>
      <linearGradient id="dgSleeve" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#CFC9BD"/><stop offset=".5" stop-color="#FFFFFF"/><stop offset="1" stop-color="#C8C2B5"/></linearGradient>
      <linearGradient id="dgSatin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#16161A"/><stop offset=".5" stop-color="#43434C"/><stop offset="1" stop-color="#101013"/></linearGradient>
      <linearGradient id="dgGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF0B8"/><stop offset=".5" stop-color="#D4AF37"/><stop offset="1" stop-color="#8E6D1C"/></linearGradient>
    </defs>
    <g class="d-body">
      <path d="M14 120 Q14 92 30 86 L48 80 L72 80 L90 86 Q106 92 106 120 Z" fill="url(#dgSleeve)"/>
      <path d="M30 86 L48 81 L60 108 L72 81 L90 86 Q96 100 94 120 L26 120 Q24 100 30 86 Z" fill="url(#dgVest)"/>
      <path d="M48 81 L60 108 L54 120 L44 120 Q46 100 40 88 Z" fill="url(#dgSatin)" opacity=".92"/>
      <path d="M72 81 L60 108 L66 120 L76 120 Q74 100 80 88 Z" fill="url(#dgSatin)" opacity=".92"/>
      <path d="M50 80 L60 106 L70 80 Z" fill="url(#dgShirt)"/>
      <path d="M60 88 L60 104" stroke="#CFC9BD" stroke-width=".6"/>
      <path d="M50 79 L56 88 L60 82 L64 88 L70 79 L66 76 L54 76 Z" fill="#FFFFFF" stroke="#CFC9BD" stroke-width=".6"/>
      <path d="M60 84 L50 79.5 Q48 84 50 88.5 Z M60 84 L70 79.5 Q72 84 70 88.5 Z" fill="#111114"/>
      <rect x="57.6" y="81.8" width="4.8" height="4.4" rx="1.2" fill="#2A2A31"/>
      <circle cx="60" cy="112" r="1.5" fill="url(#dgGold)"/><circle cx="60" cy="118" r="1.5" fill="url(#dgGold)"/>
      <rect x="73" y="96" width="12" height="3.6" rx=".9" fill="url(#dgGold)"/>
      <g class="d-head">
        <path d="M53 62 L53 78 Q60 82 67 78 L67 62 Z" fill="url(#dgSkin)"/>
        <path d="M53 70 Q60 75 67 70 L67 74 Q60 78 53 74 Z" fill="#000" opacity=".13"/>
        <ellipse cx="44.6" cy="47" rx="2.6" ry="4.4" fill="#DDAA8A"/><ellipse cx="75.4" cy="47" rx="2.6" ry="4.4" fill="#DDAA8A"/>
        <path d="M45 42 Q45 28 60 27 Q75 28 75 42 L75 50 Q74 62 66 67 Q60 70 54 67 Q46 62 45 50 Z" fill="url(#dgFace)"/>
        <path d="M47 54 Q50 64 60 67 Q70 64 73 54 Q70 62 60 64 Q50 62 47 54 Z" fill="#6E4636" opacity=".12"/>
        <path d="M44 46 Q41 26 58 23 Q74 21 77 34 Q78 40 76 46 Q74 37 70 34 Q62 31 52 33 Q47 35 46 41 Z" fill="url(#dgHair)"/>
        <path d="M51 28 Q60 24.5 71 28" stroke="#7A5C47" stroke-width="1" fill="none" opacity=".75"/>
        <path d="M49 41.5 Q53 39.8 56.5 41.2 M63.5 41.2 Q67 39.8 71 41.5" stroke="#2B1D15" stroke-width="1.4" fill="none" stroke-linecap="round"/>
        <g class="d-eyes">
          <ellipse cx="53" cy="45" rx="2.6" ry="1.6" fill="#FFFDF8"/><ellipse cx="67" cy="45" rx="2.6" ry="1.6" fill="#FFFDF8"/>
          <circle cx="53.3" cy="45" r="1.25" fill="#4A3426"/><circle cx="67.3" cy="45" r="1.25" fill="#4A3426"/>
          <circle cx="53.7" cy="44.6" r=".4" fill="#fff"/><circle cx="67.7" cy="44.6" r=".4" fill="#fff"/>
        </g>
        <path d="M60 46 Q58.6 52 58 54.4 Q60 55.6 62 54.4" stroke="#B07A5B" stroke-width="1" fill="none" stroke-linecap="round"/>
        <path class="d-mouth" d="M55.5 59 Q60 61.5 64.5 59" stroke="#9C4F45" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      </g>
    </g>
    <g class="d-arm d-arm-l"><path d="M26 104 Q14 110 18 120 L34 120 Z" fill="url(#dgSleeve)"/><path d="M19 108 L31 104" stroke="url(#dgGold)" stroke-width="2.2" stroke-linecap="round"/><ellipse cx="24" cy="117" rx="6.5" ry="4" fill="url(#dgSkin)"/></g>
    <g class="d-arm d-arm-r"><path d="M94 104 Q106 110 102 120 L86 120 Z" fill="url(#dgSleeve)"/><path d="M89 104 L101 108" stroke="url(#dgGold)" stroke-width="2.2" stroke-linecap="round"/><ellipse cx="96" cy="117" rx="6.5" ry="4" fill="url(#dgSkin)"/></g>
  </svg>`;

  const THANKS = ['Thank you!', 'Much appreciated!', 'Good luck at the table!', 'May the river be kind!', 'You are too generous!'];
  const CHEERS = ['Nicely played!', 'What a round!', 'Well done!', 'The cards like you tonight!', 'A fine game, everyone.', 'Shuffle up and deal!'];
  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let pos = null;           // where the dealer stands on the stage
  let tips = [];            // times of tips at this table (the dealer's mood)
  let tableId = null;
  let lastDeal = 0;

  const fig = () => document.getElementById('tDealer');

  function build(ctx, where) {
    document.querySelectorAll('.tip-menu').forEach((x) => x.remove());
    if (tableId !== App.tableId) { tableId = App.tableId; tips = []; }
    pos = where || null;
    if (!pos) return;
    const d = ctx.h('div', 'dealer-figure');
    d.id = 'tDealer';
    d.innerHTML = SVG + '<span class="d-bubble"></span>';
    Object.assign(d.style, { left: pos.x - pos.size / 2 + 'px', top: pos.y + 'px', width: pos.size + 'px', height: pos.size + 'px' });
    const tip = ctx.h('button', 'tip-btn', '💰');
    tip.id = 'tTip';
    tip.title = 'Tip the dealer';
    tip.setAttribute('aria-label', 'Tip the dealer');
    tip.hidden = true;
    Object.assign(tip.style, { left: pos.x + pos.size * 0.42 + 'px', top: pos.y + pos.size * 0.5 + 'px' });
    tip.onclick = (e) => { e.stopPropagation(); menu(ctx, tip); };
    ctx.stage.append(d, tip);
  }

  // Who may tip: seated players; at Durak and Flamingo (no table chips) members only.
  function update(ctx, st, S) {
    const tip = document.getElementById('tTip');
    if (!tip) return;
    tip.hidden = st.mySeat === -1 || !!(S && S.watching) || !!(S && S.tourney) || (!S.usesChips && !App.account);
  }

  function menu(ctx, anchor) {
    document.querySelectorAll('.tip-menu').forEach((x) => x.remove());
    const st = ctx.st, S = ctx.S;
    const fromTable = !!(S && S.usesChips);
    const me = st.seats[st.mySeat];
    const have = fromTable ? (me ? me.chips : 0) : (App.wallet ? App.wallet.chips : 0);
    const base = fromTable ? ((st.settings && st.settings.bigBlind) || st.minBet || 10) : 10;
    const presets = (fromTable ? [1, 5, 25].map((x) => x * base) : [10, 100, 1000]).filter((v) => v <= have);
    const m = ctx.h('div', 'tip-menu');
    m.innerHTML = `<div class="tm-head"><b>Tip the dealer</b><small>🐷 goes into the piggy bank</small></div>
      <div class="tm-quick">${presets.map((v) => `<button type="button" data-a="${v}">${ctx.fmt(v)}</button>`).join('')}</div>
      <form class="tm-own"><input type="number" min="1" max="${Math.max(1, have)}" step="1" inputmode="numeric" placeholder="Your amount" aria-label="Your amount"><button type="submit">Give</button></form>
      <small class="tm-src"><span>${fromTable ? 'From your table chips' : 'From your bankroll'}</span> · ${ctx.fmt(have)}</small>`;
    const give = (a) => {
      a = Math.floor(Number(a));
      if (!(a >= 1)) return;
      if (a > have) { ctx.toast(`You have ${ctx.fmt(have)} chips${fromTable ? ' at the table' : ''}`, { kind: 'bad' }); return; }
      ctx.send({ t: 'tip', amount: a });
      m.remove();
      if (!fromTable) setTimeout(() => window.App && App.loadWallet && App.loadWallet(), 600);
    };
    m.querySelectorAll('[data-a]').forEach((b) => { b.onclick = () => give(b.dataset.a); });
    const form = m.querySelector('form');
    form.onsubmit = (e) => { e.preventDefault(); give(form.querySelector('input').value); };
    const r = anchor.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(window.innerWidth - 268, r.left - 100)) + 'px';
    m.style.top = Math.min(window.innerHeight - 190, r.bottom + 8) + 'px';
    document.body.appendChild(m);
    setTimeout(() => document.addEventListener('click', function close(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('click', close); } }), 0);
  }

  function say(text, ms = 2600) {
    const d = fig();
    if (!d) return;
    d.querySelector('.d-bubble').textContent = text;
    d.classList.add('talking');
    clearTimeout(say.t);
    say.t = setTimeout(() => d.classList.remove('talking'), ms);
  }
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  // Someone tipped: their chip flies to the dealer, who bows and says thank you.
  function onTip(m, ctx) {
    tips.push(Date.now());
    const d = fig();
    const from = ctx.plates && ctx.plates[m.seat];
    if (d && from && pos && !reduced()) {
      const f = document.createElement('div');
      f.className = 'chip-fly tip-fly';
      f.append(CardUI.stack(m.amount, { size: ctx.layout === 'port' ? 24 : 36, maxPer: 4, maxCols: 2, label: false }));
      CardUI.place(f, from[0], from[1]).style.transform = 'translate(-50%,-50%)';
      ctx.stage.appendChild(f);
      const to = [pos.x, pos.y + pos.size * 0.75];
      const a = f.animate([{ transform: 'translate(-50%,-50%)', opacity: 1 }, { transform: `translate(calc(-50% + ${to[0] - from[0]}px), calc(-50% + ${to[1] - from[1]}px)) scale(.7)`, opacity: 0 }],
        { duration: 800, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'both' });
      a.onfinish = () => f.remove();
    }
    if (d) {
      d.classList.remove('bow'); void d.offsetWidth; d.classList.add('bow');
      setTimeout(() => d.classList.remove('bow'), 1300);
    }
    setTimeout(() => say(`${pick(THANKS)} ♥`), 500);
  }

  // The mood: tips in the last 15 minutes make the dealer chattier.
  function mood() {
    const now = Date.now();
    tips = tips.filter((t) => now - t < 15 * 60 * 1000);
    return tips.length;
  }

  // Sounds from the table: cards being dealt, a round won.
  function onSfx(name) {
    const d = fig();
    if (!d || reduced()) return;
    if (name === 'deal' && Date.now() - lastDeal > 1500) {
      lastDeal = Date.now();
      d.classList.remove('dealing'); void d.offsetWidth; d.classList.add('dealing');
      setTimeout(() => d.classList.remove('dealing'), 1600);
    }
    if (name === 'win') {
      const chance = Math.min(0.85, 0.1 + 0.25 * mood());
      if (Math.random() < chance) setTimeout(() => say(pick(CHEERS)), 1200);
    }
  }
  // For the Hold'em deal animation: where the cards come from.
  const at = () => pos;

  window.Dealer = { build, update, onTip, onSfx, say, at, mood };
})();
