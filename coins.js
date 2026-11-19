// The economy — one principle: CHIPS ARE PLAY MONEY, COINS ARE REWARDS.
// Both are play money for accounts (never bought with real money, never cashed out).
//   • Chips — what you bet with. You bring them to a table and take them back
//     when you leave. Below 1,000 chips? Once a day the house tops you up to 1,000.
//   • Coins — what you earn and spend in the shop: 1 coin for every 100 chips
//     you win (at least 1 per win, up to TABLE_DAILY_CAP a day), plus the
//     daily bonus.
//   • The Bank exchanges both ways at one rate (100 chips = 1 coin) and keeps
//     a 10 % fee on every exchange — so trading back and forth never pays.
// Every balance change runs inside a locked wallet update (no double spends).

const WELCOME_COINS = 200;
const WELCOME_CHIPS = 5000;
const DAILY_BASE = 100;          // daily coin bonus on day 1 of a streak
const DAILY_STEP = 25;           // extra per consecutive day…
const DAILY_MAX_DAYS = 7;        // …up to day 7 (250 coins)
const TABLE_DAILY_CAP = 500;     // most coins you can win at tables per day
const CHIPS_PER_COIN = 100;      // the one exchange rate
const EXCHANGE_FEE = 0.10;       // the Bank keeps 10 % of every exchange
const CONVERT_RATE = Math.round(CHIPS_PER_COIN * (1 + EXCHANGE_FEE)); // chips you pay for 1 coin (110)
const COIN_TO_CHIPS = Math.round(CHIPS_PER_COIN * (1 - EXCHANGE_FEE)); // chips you get for 1 coin (90)
const BUYCHIPS_MAX = 1000;       // most coins per exchange
const TOPUP_TO = 1000;
// Chips sent to friends: limits that keep second accounts from feeding a main one.
const GIFT_MIN = 100;
const GIFT_DAILY = 50000;        // most chips one member may send per day
const GIFT_MIN_HANDS = 20;       // you must have played this many rounds before you can send           // the daily top-up brings you back to this many chips
const BANKRUPT_GRANT = TOPUP_TO; // (name kept for the API)
const INIT = { coins: WELCOME_COINS, chips: WELCOME_CHIPS };

// Equip slots — one item each:
//   cardback / cardface / felt / chips / background / turn — your own screen only;
//   avatar (portrait frame) and badge (title) — seen by everyone at your table
//   and on your profile.
// Gestures are a collection, not a slot: every gesture you own can be used at
// the table (everyone sees it).
// `retired` items are no longer sold. Players who bought them keep them and
// can still use them; the shop only shows them to their owners.
const CATALOG = [
  // ----- card backs -----
  { id: 'back-royal', slot: 'cardback', name: 'Royal Blue', price: 200, preview: 'royal' },
  { id: 'back-ivory', slot: 'cardback', name: 'Ivory Lace', price: 250, preview: 'ivory' },
  { id: 'back-midnight', slot: 'cardback', name: 'Midnight Gold', price: 300, preview: 'midnight' },
  { id: 'back-emerald', slot: 'cardback', name: 'Emerald Lattice', price: 300, preview: 'emerald' },
  { id: 'back-saville', slot: 'cardback', name: 'Savile Row', price: 350, preview: 'saville' },
  { id: 'back-regatta', slot: 'cardback', name: 'Regatta', price: 350, preview: 'regatta' },
  { id: 'back-sunburst', slot: 'cardback', name: 'Bordeaux Sunburst', price: 450, preview: 'sunburst' },
  { id: 'back-tartan', slot: 'cardback', name: 'Hunting Lodge', price: 450, preview: 'tartan' },
  { id: 'back-faberge', slot: 'cardback', name: 'Fabergé', price: 750, preview: 'faberge' },
  { id: 'back-flames', slot: 'cardback', name: 'Flames', price: 500, preview: 'flames', retired: true },
  // ----- animated (everyone at the table sees them move) -----
  { id: 'back-aurora', slot: 'cardback', name: 'Aurora', price: 1200, preview: 'aurora', animated: true },
  { id: 'back-goldflux', slot: 'cardback', name: 'Liquid Gold', price: 1500, preview: 'goldflux', animated: true },
  // anime collection (original designs)
  { id: 'back-sakura', slot: 'cardback', name: 'Sakura Storm', price: 1600, preview: 'sakura', animated: true },
  { id: 'back-kitsune', slot: 'cardback', name: 'Neon Kitsune', price: 2000, preview: 'kitsune', animated: true },
  { id: 'back-burst', slot: 'cardback', name: 'Shonen Burst', price: 1800, preview: 'burst', animated: true },
  { id: 'back-starry', slot: 'cardback', name: 'Starry Dream', price: 1600, preview: 'starry', animated: true },
  { id: 'face-sakura', slot: 'cardface', name: 'Sakura Bloom', price: 1400, preview: 'sakura', animated: true },
  { id: 'face-neon', slot: 'cardface', name: 'Neon Night', price: 1800, preview: 'neon', animated: true },
  { id: 'face-manga', slot: 'cardface', name: 'Manga Ink', price: 1500, preview: 'manga', animated: true },
  { id: 'face-starlight', slot: 'cardface', name: 'Starlight', price: 1400, preview: 'starlight', animated: true },
  { id: 'pf-neon', slot: 'avatar', name: 'Neon Pulse', price: 900, preview: 'pf:neon', animated: true },
  { id: 'pf-flame', slot: 'avatar', name: 'Eternal Flame', price: 1300, preview: 'pf:flame', animated: true },
  { id: 'pf-halo', slot: 'avatar', name: 'Golden Halo', price: 1800, preview: 'pf:halo', animated: true },
  { id: 'title-legend', slot: 'badge', name: 'Legend', price: 2500, preview: 'ta:Legend', animated: true },
  { id: 'chips-holo', slot: 'chips', name: 'Holographic', price: 1400, preview: 'holo', animated: true },
  { id: 'turn-lightning', slot: 'turn', name: 'Lightning', price: 1000, preview: 'lightning', animated: true },
  // ----- decks (card faces) -----
  { id: 'face-bridge', slot: 'cardface', name: 'Bridge Club', price: 200, preview: 'bridge' },
  { id: 'face-fourcolor', slot: 'cardface', name: 'Four-Colour Deck', price: 250, preview: 'fourcolor' },
  { id: 'face-ink', slot: 'cardface', name: 'Ink & Paper', price: 300, preview: 'ink' },
  { id: 'face-cyrillic', slot: 'cardface', name: 'Imperial Russian', price: 400, preview: 'cyrillic' },
  { id: 'face-gilded', slot: 'cardface', name: 'Gilded Edges', price: 600, preview: 'gilded' },
  // ----- table felts -----
  { id: 'felt-blue', slot: 'felt', name: 'Ocean Felt', price: 250, preview: 'blue' },
  { id: 'felt-purple', slot: 'felt', name: 'Royal Purple', price: 250, preview: 'purple' },
  { id: 'felt-camel', slot: 'felt', name: 'Camel Hair', price: 300, preview: 'camel' },
  { id: 'felt-navy', slot: 'felt', name: 'Admiralty Navy', price: 350, preview: 'navy' },
  { id: 'felt-crimson', slot: 'felt', name: 'Crimson', price: 400, preview: 'crimson' },
  { id: 'felt-ice', slot: 'felt', name: 'Neva Ice', price: 500, preview: 'ice' },
  { id: 'felt-black', slot: 'felt', name: 'Black Velvet', price: 600, preview: 'black' },
  // ----- chip sets -----
  { id: 'chips-clay', slot: 'chips', name: 'Monte Carlo Clay', price: 300, preview: 'clay' },
  { id: 'chips-brass', slot: 'chips', name: 'Engraved Brass', price: 450, preview: 'brass' },
  { id: 'chips-onyx', slot: 'chips', name: 'Onyx & Silver', price: 500, preview: 'onyx' },
  { id: 'chips-malachite', slot: 'chips', name: 'Malachite', price: 650, preview: 'malachite' },
  { id: 'chips-pearl', slot: 'chips', name: 'Mother-of-Pearl', price: 800, preview: 'pearl' },
  // ----- backgrounds -----
  { id: 'bg-damask', slot: 'background', name: 'Ivory Damask', price: 200, preview: 'damask' },
  { id: 'bg-riviera', slot: 'background', name: 'Riviera Awning', price: 250, preview: 'riviera' },
  { id: 'bg-marble', slot: 'background', name: 'White Marble', price: 300, preview: 'marble' },
  { id: 'bg-tweed', slot: 'background', name: 'Country Tweed', price: 350, preview: 'tweed' },
  { id: 'bg-library', slot: 'background', name: 'Oak Library', price: 400, preview: 'library' },
  { id: 'bg-club', slot: 'background', name: "Gentlemen's Club", price: 450, preview: 'club' },
  { id: 'bg-midnight', slot: 'background', name: 'Midnight Salon', price: 500, preview: 'midnight' },
  // ----- portraits (a frame around your initials) -----
  { id: 'pf-signet', slot: 'avatar', name: 'Signet Ring', price: 200, preview: 'pf:signet' },
  { id: 'pf-cameo', slot: 'avatar', name: 'Cameo', price: 250, preview: 'pf:cameo' },
  { id: 'pf-seal', slot: 'avatar', name: 'Wax Seal', price: 350, preview: 'pf:seal' },
  { id: 'pf-crest', slot: 'avatar', name: 'Family Crest', price: 450, preview: 'pf:crest' },
  { id: 'pf-laurel', slot: 'avatar', name: 'Laurel Wreath', price: 600, preview: 'pf:laurel' },
  { id: 'pf-sovereign', slot: 'avatar', name: 'Gold Sovereign', price: 900, preview: 'pf:sovereign' },
  { id: 'avatar-fox', slot: 'avatar', name: 'The Fox', price: 150, preview: '🦊', retired: true },
  { id: 'avatar-owl', slot: 'avatar', name: 'The Owl', price: 150, preview: '🦉', retired: true },
  { id: 'avatar-wolf', slot: 'avatar', name: 'The Wolf', price: 250, preview: '🐺', retired: true },
  { id: 'avatar-bear', slot: 'avatar', name: 'The Bear', price: 250, preview: '🐻', retired: true },
  { id: 'avatar-lion', slot: 'avatar', name: 'The Lion', price: 400, preview: '🦁', retired: true },
  { id: 'avatar-tophat', slot: 'avatar', name: 'The Gentleman', price: 400, preview: '🎩', retired: true },
  { id: 'avatar-queen', slot: 'avatar', name: 'The Queen', price: 700, preview: '👸', retired: true },
  { id: 'avatar-king', slot: 'avatar', name: 'The King', price: 700, preview: '🤴', retired: true },
  // ----- titles (shown before your name) -----
  { id: 'title-hon', slot: 'badge', name: 'The Honourable', price: 150, preview: 't:The Hon.' },
  { id: 'title-sir', slot: 'badge', name: 'Sir', price: 250, preview: 't:Sir' },
  { id: 'title-dame', slot: 'badge', name: 'Dame', price: 250, preview: 't:Dame' },
  { id: 'title-lord', slot: 'badge', name: 'Lord', price: 400, preview: 't:Lord' },
  { id: 'title-lady', slot: 'badge', name: 'Lady', price: 400, preview: 't:Lady' },
  { id: 'title-baron', slot: 'badge', name: 'Baron', price: 600, preview: 't:Baron' },
  { id: 'title-baroness', slot: 'badge', name: 'Baroness', price: 600, preview: 't:Baroness' },
  { id: 'title-count', slot: 'badge', name: 'Count', price: 800, preview: 't:Count' },
  { id: 'title-countess', slot: 'badge', name: 'Countess', price: 800, preview: 't:Countess' },
  { id: 'title-duke', slot: 'badge', name: 'Duke', price: 1200, preview: 't:Duke' },
  { id: 'title-duchess', slot: 'badge', name: 'Duchess', price: 1200, preview: 't:Duchess' },
  { id: 'title-grandduke', slot: 'badge', name: 'Grand Duke', price: 2000, preview: 't:Grand Duke' },
  { id: 'badge-star', slot: 'badge', name: 'Star', price: 150, preview: '⭐', retired: true },
  { id: 'badge-clover', slot: 'badge', name: 'Lucky Clover', price: 150, preview: '🍀', retired: true },
  { id: 'badge-fire', slot: 'badge', name: 'On Fire', price: 200, preview: '🔥', retired: true },
  { id: 'badge-shark', slot: 'badge', name: 'Card Shark', price: 400, preview: '🦈', retired: true },
  { id: 'badge-crown', slot: 'badge', name: 'Crown', price: 800, preview: '👑', retired: true },
  { id: 'badge-diamond', slot: 'badge', name: 'Diamond', price: 1000, preview: '💎', retired: true },
  // ----- turn markers (marks whose turn it is) -----
  { id: 'turn-candle', slot: 'turn', name: 'Candlelight', price: 200, preview: 'candle' },
  { id: 'turn-hourglass', slot: 'turn', name: 'Hourglass', price: 300, preview: 'hourglass' },
  { id: 'turn-watch', slot: 'turn', name: 'Pocket Watch', price: 400, preview: 'watch' },
  // ----- victory effects: played over your seat when you win (everyone sees them) -----
  { id: 'fx-confetti', slot: 'victory', name: 'Confetti Cannon', price: 1500, preview: 'confetti', animated: true },
  { id: 'fx-goldrain', slot: 'victory', name: 'Gold Rain', price: 2200, preview: 'goldrain', animated: true },
  { id: 'fx-sakura', slot: 'victory', name: 'Sakura Vortex', price: 2500, preview: 'sakura', animated: true },
  { id: 'fx-fireworks', slot: 'victory', name: 'Fireworks', price: 3000, preview: 'fireworks', animated: true },
  { id: 'fx-dragon', slot: 'victory', name: 'Dragon Flight', price: 5000, preview: 'dragon', animated: true },
  // ----- gestures (owned, used at the table) -----
  { id: 'gesture-nod', slot: 'gesture', name: 'A Courteous Nod', price: 100, preview: 'nods courteously' },
  { id: 'gesture-wellplayed', slot: 'gesture', name: 'Well Played', price: 150, preview: 'says “Well played.”' },
  { id: 'gesture-applause', slot: 'gesture', name: 'Polite Applause', price: 200, preview: 'applauds politely' },
  { id: 'gesture-hat', slot: 'gesture', name: 'Tip of the Hat', price: 250, preview: 'tips the hat' },
  { id: 'gesture-eyebrow', slot: 'gesture', name: 'A Raised Eyebrow', price: 300, preview: 'raises an eyebrow' },
  { id: 'gesture-watch', slot: 'gesture', name: 'Checks the Watch', price: 300, preview: 'checks the pocket watch' },
  { id: 'gesture-monocle', slot: 'gesture', name: 'The Monocle Drop', price: 500, preview: 'drops the monocle' },
  // ----- player tags: a small label next to your name (everyone sees it) -----
  // From the Tag box …
  { id: 'tag-nightowl', slot: 'tag', name: 'Night Owl', price: 300, preview: '🦉 Night Owl' },
  { id: 'tag-bluffer', slot: 'tag', name: 'Bluffer', price: 350, preview: '🎭 Bluffer' },
  { id: 'tag-lucky', slot: 'tag', name: 'Lucky Charm', price: 400, preview: '🍀 Lucky Charm' },
  { id: 'tag-gentleman', slot: 'tag', name: 'Gentleman', price: 600, preview: '🎩 Gentleman' },
  { id: 'tag-icecold', slot: 'tag', name: 'Ice Cold', price: 900, preview: '🧊 Ice Cold' },
  { id: 'tag-highroller', slot: 'tag', name: 'High Roller', price: 1500, preview: '💎 High Roller', animated: true },
  { id: 'tag-phantom', slot: 'tag', name: 'Phantom', price: 2000, preview: '👻 Phantom', animated: true },
  { id: 'tag-dragon', slot: 'tag', name: 'Dragon', price: 3000, preview: '🐉 Dragon', animated: true },
  // … and earned with achievements (never in a box)
  { id: 'tag-regular', slot: 'tag', name: 'Regular', price: 300, preview: '☕ Regular', earned: true },
  { id: 'tag-furniture', slot: 'tag', name: 'Furniture', price: 600, preview: '🛋️ Furniture', earned: true },
  { id: 'tag-institution', slot: 'tag', name: 'Institution', price: 2500, preview: '🏛️ Institution', earned: true },
  { id: 'tag-winner', slot: 'tag', name: 'Winner', price: 600, preview: '🏅 Winner', earned: true },
  { id: 'tag-champion', slot: 'tag', name: 'Champion', price: 2500, preview: '🏆 Champion', earned: true },
  { id: 'tag-earner', slot: 'tag', name: 'Earner', price: 300, preview: '💰 Earner', earned: true },
  { id: 'tag-shark', slot: 'tag', name: 'Shark', price: 1200, preview: '🦈 Shark', earned: true },
  { id: 'tag-whale', slot: 'tag', name: 'Whale', price: 2500, preview: '🐋 Whale', earned: true },
  { id: 'tag-pothunter', slot: 'tag', name: 'Pot Hunter', price: 1200, preview: '🎯 Pot Hunter', earned: true },
  { id: 'tag-allrounder', slot: 'tag', name: 'All-rounder', price: 600, preview: '🎲 All-rounder', earned: true },
  { id: 'tag-flamingo', slot: 'tag', name: 'Flamingo Royalty', price: 1200, preview: '🦩 Flamingo Royalty', earned: true },
  { id: 'tag-durak', slot: 'tag', name: 'Durak Master', price: 1200, preview: '🃏 Durak Master', earned: true },
  { id: 'tag-digger', slot: 'tag', name: 'Digger', price: 600, preview: '⛏️ Digger', earned: true },
  { id: 'tag-loyal', slot: 'tag', name: 'Loyal', price: 1200, preview: '🤝 Loyal', earned: true },
  { id: 'tag-devoted', slot: 'tag', name: 'Devoted', price: 3000, preview: '🌟 Devoted', earned: true },
  { id: 'tag-generous', slot: 'tag', name: 'Generous', price: 600, preview: '🤲 Generous', earned: true },
  { id: 'tag-patron', slot: 'tag', name: 'Patron', price: 2500, preview: '👑 Patron', earned: true },
  { id: 'tag-unboxer', slot: 'tag', name: 'Unboxer', price: 1200, preview: '🎁 Unboxer', earned: true },
  { id: 'tag-collector', slot: 'tag', name: 'Collector', price: 600, preview: '🗃️ Collector', earned: true },
  { id: 'tag-curator', slot: 'tag', name: 'Curator', price: 2500, preview: '🖼️ Curator', earned: true },
  { id: 'tag-goodfriend', slot: 'tag', name: 'Good Friend', price: 600, preview: '🎀 Good Friend', earned: true },
  { id: 'tag-questor', slot: 'tag', name: 'Questor', price: 600, preview: '🧭 Questor', earned: true },
  { id: 'tag-socialite', slot: 'tag', name: 'Socialite', price: 600, preview: '🥂 Socialite', earned: true },
  { id: 'tag-completionist', slot: 'tag', name: 'Completionist', price: 1200, preview: '🏁 Completionist', earned: true },
];
const ITEMS = Object.fromEntries(CATALOG.map((i) => [i.id, i]));


const SLOTS = ['cardback', 'cardface', 'felt', 'chips', 'background', 'turn', 'avatar', 'badge', 'victory', 'tag'];
const SHOP_TABS = ['cardback', 'cardface', 'felt', 'chips', 'background', 'avatar', 'badge', 'tag', 'turn', 'victory', 'gesture'];
const GESTURE_COOLDOWN = 4000;   // ms between gestures per player

// ----- skin boxes: the only way to get skins -----
// One box per category plus a Mystery box with everything. A box gives a skin you
// don't own yet (never a duplicate); dearer skins are rarer (chance ∝ 1 / price).
// The price follows what is inside. Paid with play money only (coins, or chips):
// coins can never be bought with real money, so a box is never a stake of real value.
const rarityOf = (item) => (item.price >= 2500 ? 'legendary' : item.price >= 1200 ? 'epic' : item.price >= 500 ? 'rare' : 'common');
const RARITIES = ['common', 'rare', 'epic', 'legendary'];
const CHIPS_PER_BOX_COIN = 150;          // paying with chips: 150 chips per coin of the price
const boxItems = (boxId) => CATALOG.filter((i) => !i.retired && !i.earned && (boxId === 'mystery' || i.slot === boxId));
// Everything that can be collected in a category (box skins and earned tags).
const collectable = (slot) => CATALOG.filter((i) => !i.retired && i.slot === slot);
const weight = (i) => 1 / i.price;
function boxPrice(boxId) {
  const items = boxItems(boxId);
  const avg = items.length / items.reduce((a, i) => a + weight(i), 0);   // the expected price of what you draw
  const coins = Math.max(150, Math.ceil((avg * 1.1) / 50) * 50);
  return { coins, chips: coins * CHIPS_PER_BOX_COIN };
}
const BOX_IDS = ['mystery', ...SHOP_TABS];
const BOXES = Object.fromEntries(BOX_IDS.map((id) => [id, { id, slot: id === 'mystery' ? null : id, ...boxPrice(id), size: boxItems(id).length }]));
// Each skin's chance for this player (0 for skins already owned).
function boxChances(boxId, owned) {
  const items = boxItems(boxId);
  const open = items.filter((i) => !owned.includes(i.id));
  const total = open.reduce((a, i) => a + weight(i), 0);
  return items.map((i) => ({ id: i.id, rarity: rarityOf(i), owned: owned.includes(i.id), chance: owned.includes(i.id) || !total ? 0 : weight(i) / total }));
}
function drawFromBox(boxId, owned, rand = Math.random) {
  const open = boxItems(boxId).filter((i) => !owned.includes(i.id));
  if (!open.length) return null;
  const total = open.reduce((a, i) => a + weight(i), 0);
  let x = rand() * total;
  for (const i of open) { if (x < weight(i)) return i; x -= weight(i); }
  return open[open.length - 1];
}

const dayString = (t) => new Date(t).toISOString().slice(0, 10); // UTC day
// The daily bonus runs in weeks: day 1 … 7 (100 → 250 coins), day 7 also gives a
// skin from the Mystery Box, then the next week starts at day 1 again. The streak
// itself keeps counting (milestones at 30 and 100 days are achievements).
const cycleDay = (streak) => ((Math.max(1, streak) - 1) % DAILY_MAX_DAYS) + 1;
const dailyAmount = (streak) => DAILY_BASE + DAILY_STEP * (cycleDay(streak) - 1);
const int = (v) => Math.floor(Number(v));

// The streak the next claim would reach (missing a day resets to 1).
function nextStreak(w, now) {
  const today = dayString(now);
  if (w.last_daily === today) return w.streak;
  return w.last_daily === dayString(now - 86400000) ? w.streak + 1 : 1;
}

// Coins you can get for your chips right now.
const convertible = (w) => Math.floor(Math.max(0, w.chips) / CONVERT_RATE);

// Coins earned for a net win of `chips`: 1 per 100, at least 1.
const coinsForWin = (chips) => (chips > 0 ? Math.max(1, Math.round(chips / CHIPS_PER_COIN)) : 0);

// Everything the client needs to show the wallet.
function status(w, now = Date.now()) {
  const today = dayString(now);
  const streak = nextStreak(w, now);
  const dailyReady = w.last_daily !== today;
  const tomorrow = new Date(today + 'T00:00:00Z').getTime() + 86400000;
  const total = w.chips + w.in_play;
  const toppedToday = w.last_bankrupt && dayString(Number(w.last_bankrupt)) === today;
  return {
    coins: w.coins,
    chips: w.chips,
    inPlay: w.in_play,
    daily: {
      ready: dailyReady,
      amount: dailyAmount(dailyReady ? streak : streak + 1),
      streak: dailyReady ? streak - 1 : w.streak, // days already collected in a row
      week: dailyReady ? (streak - 1) % DAILY_MAX_DAYS : cycleDay(w.streak), // days of this week already collected
      nextDay: cycleDay(dailyReady ? streak : streak + 1),                    // the day the next claim is
      boxDay: DAILY_MAX_DAYS,
      nextAt: dailyReady ? null : tomorrow,
    },
    bankrupt: {                                    // the daily top-up
      eligible: total < TOPUP_TO,
      ready: total < TOPUP_TO && !toppedToday,
      amount: Math.max(0, TOPUP_TO - total),
      below: TOPUP_TO,
      nextAt: toppedToday ? tomorrow : null,
    },
    buyChips: { rate: COIN_TO_CHIPS, max: BUYCHIPS_MAX },
    convert: { rate: CONVERT_RATE, maxCoins: convertible(w) },
    rules: { chipsPerCoin: CHIPS_PER_COIN, fee: EXCHANGE_FEE, topUpTo: TOPUP_TO },
    earnedToday: w.earned_day === today ? w.earned_today : 0,
    tableCap: TABLE_DAILY_CAP,
  };
}

function makeCoins(store) {
  // A locked wallet update. With a `reason`, every change of coins or chips
  // is written to the player's statement in the same step.
  const wallet = (userId, fn, reason) => store.updateWallet(userId, INIT, (w, owned) => {
    const out = fn(w, owned) || {};
    if (reason && out.update) {
      const dc = 'coins' in out.update ? out.update.coins - w.coins : 0;
      const dh = 'chips' in out.update ? out.update.chips - w.chips : 0;
      if (dc || dh) out.log = { coins: dc, chips: dh, reason: typeof reason === 'function' ? reason(out) : reason };
    }
    return out;
  });

  const api = {
    CATALOG, SLOTS,

    async getStatus(userId) {
      const w = await wallet(userId, (row) => ({ result: row }));
      const items = await store.getItems(userId);
      return { ...status(w), owned: items.owned, equipped: items.equipped };
    },

    async balances(userId) { return wallet(userId, (w) => ({ result: { coins: w.coins, chips: w.chips, inPlay: w.in_play } })); },

    async claimDaily(userId, now = Date.now()) {
      return wallet(userId, (w, owned) => {
        if (w.last_daily === dayString(now)) return { result: { error: 'You already claimed today\'s bonus' } };
        const streak = nextStreak(w, now);
        let amount = dailyAmount(streak);
        const day = cycleDay(streak);
        // day 7: a skin from the Mystery Box (or 250 extra coins if you own them all)
        const item = day === DAILY_MAX_DAYS ? drawFromBox('mystery', owned) : null;
        if (day === DAILY_MAX_DAYS && !item) amount += 250;
        const coins = w.coins + amount;
        return { update: { coins, last_daily: dayString(now), streak }, addItem: item ? item.id : undefined,
          result: { amount, streak, day, coins, item: item ? item.id : null, rarity: item ? rarityOf(item) : null } };
      }, (out) => `daily:${out.result.streak}`);
    },

    // The daily top-up: below 1,000 chips (bankroll + at tables), once a day, back to 1,000.
    async claimBankrupt(userId, now = Date.now()) {
      return wallet(userId, (w) => {
        const total = w.chips + w.in_play;
        if (total >= TOPUP_TO) return { result: { error: `The top-up is for players with fewer than ${TOPUP_TO.toLocaleString()} chips` } };
        if (w.last_bankrupt && dayString(Number(w.last_bankrupt)) === dayString(now)) return { result: { error: 'You have had today\'s top-up — the next one comes tomorrow' } };
        const amount = TOPUP_TO - total;
        const chips = w.chips + amount;
        return { update: { chips, last_bankrupt: now }, result: { amount, chips } };
      }, 'topup');
    },

    // The Bank, chips -> coins: 110 chips per coin (100 + 10 % fee).
    async convert(userId, coinsWanted) {
      const want = int(coinsWanted);
      if (!(want >= 1)) return { error: 'Choose how many coins you want' };
      if (want > BUYCHIPS_MAX) return { error: `You can exchange up to ${BUYCHIPS_MAX.toLocaleString()} coins at once` };
      return wallet(userId, (w) => {
        const cost = want * CONVERT_RATE;
        if (w.chips < cost) return { result: { error: `${want} coins cost ${cost.toLocaleString()} chips — you have ${w.chips.toLocaleString()}` } };
        const chips = w.chips - cost;
        const coins = w.coins + want;
        return { update: { chips, coins }, result: { coins, chips, converted: want, spentChips: cost } };
      }, 'bank');
    },

    // The Bank, coins -> chips: 90 chips per coin (100 − 10 % fee).
    async buyChips(userId, coinsGiven) {
      const n = int(coinsGiven);
      if (!(n >= 1)) return { error: 'Choose how many coins to trade' };
      if (n > BUYCHIPS_MAX) return { error: `You can trade up to ${BUYCHIPS_MAX.toLocaleString()} coins at once` };
      return wallet(userId, (w) => {
        if (w.coins < n) return { result: { error: `You only have ${w.coins.toLocaleString()} coins` } };
        const coins = w.coins - n;
        const chips = w.chips + n * COIN_TO_CHIPS;
        return { update: { coins, chips }, result: { coins, chips, traded: n, gotChips: n * COIN_TO_CHIPS } };
      }, 'bank');
    },

    // Move chips from the bankroll to a table. Takes up to `amount`, at least `min`.
    async buyIn(userId, amount, min) {
      return wallet(userId, (w) => {
        if (w.chips < min) return { result: { error: `You need at least ${min.toLocaleString()} chips for this table (you have ${w.chips.toLocaleString()})`, chips: w.chips } };
        const take = Math.min(w.chips, amount);
        return { update: { chips: w.chips - take, in_play: w.in_play + take }, result: { amount: take, chips: w.chips - take } };
      });
    },

    // Chips come back from a table. `boughtIn` is what was taken for that seat.
    async cashOut(userId, amount, boughtIn) {
      return wallet(userId, (w) => ({
        update: { chips: w.chips + Math.max(0, int(amount) || 0), in_play: Math.max(0, w.in_play - Math.max(0, int(boughtIn) || 0)) },
        result: { chips: w.chips + Math.max(0, int(amount) || 0) },
      }));
    },

    // Coins won at the tables, limited to TABLE_DAILY_CAP per day.
    // `reason` says where they were won (e.g. "win:blackjack").
    async earn(userId, amount, now = Date.now(), reason = 'win') {
      if (amount <= 0) return { amount: 0 };
      return wallet(userId, (w) => {
        const today = dayString(now);
        const already = w.earned_day === today ? w.earned_today : 0;
        const granted = Math.max(0, Math.min(amount, TABLE_DAILY_CAP - already));
        if (!granted) return { result: { amount: 0, capped: true, coins: w.coins, today: already, cap: TABLE_DAILY_CAP } };
        const coins = w.coins + granted;
        return { update: { coins, earned_day: today, earned_today: already + granted },
          result: { amount: granted, capped: granted < amount, coins, today: already + granted, cap: TABLE_DAILY_CAP } };
      }, reason);
    },

    async buy(userId, itemId) {
      const item = ITEMS[itemId];
      if (!item) return { error: 'That item doesn\'t exist' };
      if (item.retired) return { error: 'That item is no longer sold' };
      // Ownership is checked inside the locked update, so two quick clicks
      // can't buy (and pay for) the same item twice.
      return wallet(userId, (w, owned) => {
        if (owned.includes(itemId)) return { result: { error: 'You already own this' } };
        if (w.coins < item.price) return { result: { error: `You need ${item.price - w.coins} more coins` } };
        const coins = w.coins - item.price;
        return { update: { coins }, addItem: itemId, result: { coins, item: itemId } };
      }, `shop:${itemId}`);
    },

    async equip(userId, slot, itemId) {
      if (!SLOTS.includes(slot)) return { error: 'Unknown slot' };
      if (itemId) {
        const item = ITEMS[itemId];
        if (!item || item.slot !== slot) return { error: 'That item doesn\'t fit there' };
        const { owned } = await store.getItems(userId);
        if (!owned.includes(itemId)) return { error: 'Buy it first' };
      }
      await store.setEquipped(userId, slot, itemId || null);
      return { ok: true };
    },

    // The gesture to show at the table, or null if the player doesn't own it.
    async gestureOf(userId, itemId) {
      const item = ITEMS[itemId];
      if (!item || item.slot !== 'gesture') return null;
      const { owned } = await store.getItems(userId);
      return owned.includes(itemId) ? item : null;
    },

    // What other players see of you: portrait, title and your table skins.
    async lookOf(userId) {
      const { equipped } = await store.getItems(userId);
      const pick = (slot) => (equipped[slot] && ITEMS[equipped[slot]] ? ITEMS[equipped[slot]].preview : null);
      // seen by everyone at the table: portrait, title, card back, chip set, turn marker
      return { avatar: pick('avatar'), badge: pick('badge'), tag: pick('tag'), skin: { back: pick('cardback'), chips: pick('chips'), turn: pick('turn'), victory: pick('victory') } };
    },

    // Open a skin box, paid with coins or chips.
    async openBox(userId, boxId, pay = 'coins', rand = Math.random) {
      const box = BOXES[boxId];
      if (!box) return { error: 'Pick a box' };
      if (pay !== 'coins' && pay !== 'chips') return { error: 'Pay with coins or chips' };
      return wallet(userId, (w, owned) => {
        const price = box[pay];
        if (w[pay] < price) return { result: { error: `This box costs ${price.toLocaleString()} ${pay} — you have ${w[pay].toLocaleString()}` } };
        const item = drawFromBox(boxId, owned, rand);
        if (!item) return { result: { error: 'You already own everything this box can give' } };
        return { update: { [pay]: w[pay] - price }, addItem: item.id, result: { item: item.id, rarity: rarityOf(item), paid: price, pay } };
      }, `box:${boxId}`);
    },
    // What a box can give this player, and the chance for each skin.
    async boxPreview(userId, boxId) {
      if (!BOXES[boxId]) return { error: 'Pick a box' };
      const { owned } = await store.getItems(userId);
      return { box: BOXES[boxId], items: boxChances(boxId, owned) };
    },

    // Send chips to a friend: taken from your bankroll, added to theirs, both on the statement.
    async sendChips(fromId, toId, amount, fromName, toName, now = Date.now()) {
      const n = int(amount);
      if (!(n >= GIFT_MIN)) return { error: `Send at least ${GIFT_MIN} chips` };
      const today = dayString(now);
      const out = await wallet(fromId, (w) => {
        const sent = w.sent_day === today ? w.sent_today : 0;
        if (sent + n > GIFT_DAILY) return { result: { error: `You can send up to ${GIFT_DAILY.toLocaleString()} chips a day (${Math.max(0, GIFT_DAILY - sent).toLocaleString()} left today)` } };
        if (w.chips < n) return { result: { error: `You only have ${w.chips.toLocaleString()} chips in your bankroll` } };
        return { update: { chips: w.chips - n, sent_day: today, sent_today: sent + n }, result: { chips: w.chips - n, left: GIFT_DAILY - sent - n } };
      }, `gift-out:${toName}`);
      if (out.error) return out;
      try {
        await wallet(toId, (w) => ({ update: { chips: w.chips + n }, result: {} }), `gift-in:${fromName}`);
      } catch (e) {
        // could not deliver: give the chips back
        await wallet(fromId, (w) => ({ update: { chips: w.chips + n, sent_today: Math.max(0, (w.sent_today || 0) - n) }, result: {} }), `gift-back:${toName}`);
        throw e;
      }
      return { ok: true, sent: n, chips: out.chips, left: out.left };
    },

    // Give an item for free (earned tags); false if it was already owned.
    async grantItem(userId, itemId) {
      if (!ITEMS[itemId]) return false;
      return wallet(userId, (w, owned) => (owned.includes(itemId) ? { result: false } : { addItem: itemId, result: true }));
    },

    // Pay chips from the bankroll (a dealer tip at Durak or Flamingo).
    async spendChips(userId, amount, reason) {
      const n = int(amount);
      if (!(n >= 1)) return { error: 'Pick an amount' };
      return wallet(userId, (w) => (w.chips < n
        ? { result: { error: `You only have ${w.chips.toLocaleString()} chips in your bankroll` } }
        : { update: { chips: w.chips - n }, result: { chips: w.chips - n } }), reason);
    },

    // Owner tool: add or remove coins/chips (never below zero).
    // `reason`: owner, gift, quest:…, tourney, bonus …
    async adjust(userId, dCoins, dChips, reason = 'owner') {
      const c = int(dCoins) || 0;
      const h = int(dChips) || 0;
      if (Math.abs(c) > 1e6 || Math.abs(h) > 1e8) return { error: 'That amount is too large' };
      return wallet(userId, (w) => ({
        update: { coins: Math.max(0, w.coins + c), chips: Math.max(0, w.chips + h) },
        result: { coins: Math.max(0, w.coins + c), chips: Math.max(0, w.chips + h) },
      }), reason);
    },

    // The player's statement: the newest coin and chip bookings (not table buy-ins).
    async history(userId, limit = 60) {
      return store.coinLog ? store.coinLog(userId, limit) : [];
    },
  };
  return api;
}

// Coins for one player's result: 1 per 100 chips won (at least 1 per win).
// Durak and Flamingo have no chips: escaping Durak / winning Flamingo earns 10 coins.
function rewardFor(r) {
  if (!r.won) return 0;
  if (r.mode === 'durak' || r.mode === 'flamingo') return 10;
  return coinsForWin(r.net);
}

module.exports = {
  makeCoins, rewardFor, status, dailyAmount, dayString, CATALOG, ITEMS, SLOTS, SHOP_TABS, GESTURE_COOLDOWN,
  WELCOME_COINS, WELCOME_CHIPS, TABLE_DAILY_CAP, CHIPS_PER_COIN, EXCHANGE_FEE, CONVERT_RATE, COIN_TO_CHIPS, BUYCHIPS_MAX,
  TOPUP_TO, BANKRUPT_GRANT, coinsForWin, BOXES, RARITIES, rarityOf, drawFromBox, boxChances, boxItems, collectable, CHIPS_PER_BOX_COIN, GIFT_MIN, GIFT_DAILY, GIFT_MIN_HANDS,
};
