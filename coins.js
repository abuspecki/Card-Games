// The economy. Two play-money currencies for accounts (never bought with real
// money, never cashed out):
//   • Chips — your bankroll. You bring chips to a table (buy-in) and take them
//     back when you leave. Going bankrupt gives you a fresh stack.
//   • Coins — the shop currency. Earned from the daily bonus, from wins at the
//     tables, and by converting chips you have WON.
// Anti-exploit rules:
//   • Only chips above CONVERT_FLOOR can be converted, and free chips (welcome +
//     bankruptcy refills) never lift you above it — so only winnings convert.
//   • Conversion and table coin rewards have daily caps.
//   • Every balance change runs inside a locked wallet update (no double spends).

const WELCOME_COINS = 200;
const WELCOME_CHIPS = 5000;
const DAILY_BASE = 100;          // daily coin bonus on day 1 of a streak
const DAILY_STEP = 25;           // extra per consecutive day…
const DAILY_MAX_DAYS = 7;        // …up to day 7 (250 coins)
const TABLE_DAILY_CAP = 500;     // most coins you can win at tables per day
const CONVERT_RATE = 100;        // chips per coin
const CONVERT_FLOOR = 5000;      // chips you always keep; only chips above it convert
const CONVERT_DAILY_MAX = 300;   // most coins from conversion per day
const BANKRUPT_BELOW = 100;      // total chips (bankroll + at tables) to count as bankrupt
const BANKRUPT_GRANT = 1000;
const BANKRUPT_COOLDOWN = 15 * 60 * 1000;
const INIT = { coins: WELCOME_COINS, chips: WELCOME_CHIPS };

// slots: cardback / cardface / felt / background are shown on your own screen;
// avatar and badge are seen by everyone at your table and on your profile.
const CATALOG = [
  { id: 'back-royal', slot: 'cardback', name: 'Royal Blue', price: 200, preview: 'royal' },
  { id: 'back-midnight', slot: 'cardback', name: 'Midnight Gold', price: 300, preview: 'midnight' },
  { id: 'back-emerald', slot: 'cardback', name: 'Emerald Lattice', price: 300, preview: 'emerald' },
  { id: 'back-sunburst', slot: 'cardback', name: 'Bordeaux Sunburst', price: 450, preview: 'sunburst' },
  { id: 'back-flames', slot: 'cardback', name: 'Flames', price: 500, preview: 'flames' },
  { id: 'face-fourcolor', slot: 'cardface', name: 'Four-Colour Deck', price: 250, preview: 'fourcolor' },
  { id: 'face-gilded', slot: 'cardface', name: 'Gilded Edges', price: 600, preview: 'gilded' },
  { id: 'felt-blue', slot: 'felt', name: 'Ocean Felt', price: 250, preview: 'blue' },
  { id: 'felt-purple', slot: 'felt', name: 'Royal Purple', price: 250, preview: 'purple' },
  { id: 'felt-crimson', slot: 'felt', name: 'Crimson', price: 400, preview: 'crimson' },
  { id: 'felt-black', slot: 'felt', name: 'Black Velvet', price: 600, preview: 'black' },
  { id: 'bg-damask', slot: 'background', name: 'Ivory Damask', price: 200, preview: 'damask' },
  { id: 'bg-marble', slot: 'background', name: 'White Marble', price: 300, preview: 'marble' },
  { id: 'bg-library', slot: 'background', name: 'Oak Library', price: 400, preview: 'library' },
  { id: 'bg-midnight', slot: 'background', name: 'Midnight Salon', price: 500, preview: 'midnight' },
  { id: 'avatar-fox', slot: 'avatar', name: 'The Fox', price: 150, preview: '🦊' },
  { id: 'avatar-owl', slot: 'avatar', name: 'The Owl', price: 150, preview: '🦉' },
  { id: 'avatar-wolf', slot: 'avatar', name: 'The Wolf', price: 250, preview: '🐺' },
  { id: 'avatar-bear', slot: 'avatar', name: 'The Bear', price: 250, preview: '🐻' },
  { id: 'avatar-lion', slot: 'avatar', name: 'The Lion', price: 400, preview: '🦁' },
  { id: 'avatar-tophat', slot: 'avatar', name: 'The Gentleman', price: 400, preview: '🎩' },
  { id: 'avatar-queen', slot: 'avatar', name: 'The Queen', price: 700, preview: '👸' },
  { id: 'avatar-king', slot: 'avatar', name: 'The King', price: 700, preview: '🤴' },
  { id: 'badge-star', slot: 'badge', name: 'Star', price: 150, preview: '⭐' },
  { id: 'badge-clover', slot: 'badge', name: 'Lucky Clover', price: 150, preview: '🍀' },
  { id: 'badge-fire', slot: 'badge', name: 'On Fire', price: 200, preview: '🔥' },
  { id: 'badge-shark', slot: 'badge', name: 'Card Shark', price: 400, preview: '🦈' },
  { id: 'badge-crown', slot: 'badge', name: 'Crown', price: 800, preview: '👑' },
  { id: 'badge-diamond', slot: 'badge', name: 'Diamond', price: 1000, preview: '💎' },
];
const ITEMS = Object.fromEntries(CATALOG.map((i) => [i.id, i]));
const SLOTS = ['cardback', 'cardface', 'felt', 'background', 'avatar', 'badge'];

const dayString = (t) => new Date(t).toISOString().slice(0, 10); // UTC day
const dailyAmount = (streak) => DAILY_BASE + DAILY_STEP * (Math.min(streak, DAILY_MAX_DAYS) - 1);
const int = (v) => Math.floor(Number(v));

// The streak the next claim would reach (missing a day resets to 1).
function nextStreak(w, now) {
  const today = dayString(now);
  if (w.last_daily === today) return w.streak;
  return w.last_daily === dayString(now - 86400000) ? w.streak + 1 : 1;
}

function convertible(w, now) {
  const usedToday = w.converted_day === dayString(now) ? w.converted_today : 0;
  const byChips = Math.floor(Math.max(0, w.chips - CONVERT_FLOOR) / CONVERT_RATE);
  return { coins: Math.max(0, Math.min(byChips, CONVERT_DAILY_MAX - usedToday)), usedToday };
}

// Everything the client needs to show the wallet.
function status(w, now = Date.now()) {
  const today = dayString(now);
  const streak = nextStreak(w, now);
  const dailyReady = w.last_daily !== today;
  const tomorrow = new Date(today + 'T00:00:00Z').getTime() + 86400000;
  const bankruptAt = Number(w.last_bankrupt || 0) + BANKRUPT_COOLDOWN;
  const conv = convertible(w, now);
  return {
    coins: w.coins,
    chips: w.chips,
    inPlay: w.in_play,
    daily: {
      ready: dailyReady,
      amount: dailyAmount(dailyReady ? streak : streak + 1),
      streak: dailyReady ? streak - 1 : w.streak, // days already collected in a row
      nextAt: dailyReady ? null : tomorrow,
    },
    bankrupt: {
      eligible: w.chips + w.in_play < BANKRUPT_BELOW,
      ready: w.chips + w.in_play < BANKRUPT_BELOW && now >= bankruptAt,
      amount: BANKRUPT_GRANT,
      below: BANKRUPT_BELOW,
      nextAt: now >= bankruptAt ? null : bankruptAt,
    },
    convert: {
      rate: CONVERT_RATE, floor: CONVERT_FLOOR, dailyMax: CONVERT_DAILY_MAX,
      maxCoins: conv.coins, usedToday: conv.usedToday,
    },
    earnedToday: w.earned_day === today ? w.earned_today : 0,
    tableCap: TABLE_DAILY_CAP,
  };
}

function makeCoins(store) {
  const wallet = (userId, fn) => store.updateWallet(userId, INIT, fn);

  const api = {
    CATALOG, SLOTS,

    async getStatus(userId) {
      const w = await wallet(userId, (row) => ({ result: row }));
      const items = await store.getItems(userId);
      return { ...status(w), owned: items.owned, equipped: items.equipped };
    },

    async balances(userId) { return wallet(userId, (w) => ({ result: { coins: w.coins, chips: w.chips, inPlay: w.in_play } })); },

    async claimDaily(userId, now = Date.now()) {
      return wallet(userId, (w) => {
        if (w.last_daily === dayString(now)) return { result: { error: 'You already claimed today\'s bonus' } };
        const streak = nextStreak(w, now);
        const amount = dailyAmount(streak);
        const coins = w.coins + amount;
        return { update: { coins, last_daily: dayString(now), streak }, result: { amount, streak, coins } };
      });
    },

    // Fresh chips for a bankrupt player.
    async claimBankrupt(userId, now = Date.now()) {
      return wallet(userId, (w) => {
        if (w.chips + w.in_play >= BANKRUPT_BELOW) return { result: { error: `You still have chips — the refill is for players with fewer than ${BANKRUPT_BELOW}` } };
        if (now < Number(w.last_bankrupt || 0) + BANKRUPT_COOLDOWN) return { result: { error: 'Your next refill isn\'t ready yet' } };
        const chips = w.chips + BANKRUPT_GRANT;
        return { update: { chips, last_bankrupt: now }, result: { amount: BANKRUPT_GRANT, chips } };
      });
    },

    // Convert won chips into coins.
    async convert(userId, coinsWanted, now = Date.now()) {
      const want = int(coinsWanted);
      if (!(want >= 1)) return { error: 'Choose how many coins you want' };
      return wallet(userId, (w) => {
        const c = convertible(w, now);
        if (c.coins < want) {
          if (c.usedToday >= CONVERT_DAILY_MAX) return { result: { error: `You can convert up to ${CONVERT_DAILY_MAX} coins per day — come back tomorrow` } };
          return { result: { error: `You can convert up to ${c.coins} coins right now (only chips above ${CONVERT_FLOOR.toLocaleString()} can be converted)` } };
        }
        const chips = w.chips - want * CONVERT_RATE;
        const coins = w.coins + want;
        return {
          update: { chips, coins, converted_day: dayString(now), converted_today: c.usedToday + want },
          result: { coins, chips, converted: want, spentChips: want * CONVERT_RATE },
        };
      });
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
    async earn(userId, amount, now = Date.now()) {
      if (amount <= 0) return { amount: 0 };
      return wallet(userId, (w) => {
        const today = dayString(now);
        const already = w.earned_day === today ? w.earned_today : 0;
        const granted = Math.max(0, Math.min(amount, TABLE_DAILY_CAP - already));
        if (!granted) return { result: { amount: 0, capped: true, coins: w.coins } };
        const coins = w.coins + granted;
        return { update: { coins, earned_day: today, earned_today: already + granted }, result: { amount: granted, capped: granted < amount, coins } };
      });
    },

    async buy(userId, itemId) {
      const item = ITEMS[itemId];
      if (!item) return { error: 'That item doesn\'t exist' };
      // Ownership is checked inside the locked update, so two quick clicks
      // can't buy (and pay for) the same item twice.
      return wallet(userId, (w, owned) => {
        if (owned.includes(itemId)) return { result: { error: 'You already own this' } };
        if (w.coins < item.price) return { result: { error: `You need ${item.price - w.coins} more coins` } };
        const coins = w.coins - item.price;
        return { update: { coins }, addItem: itemId, result: { coins, item: itemId } };
      });
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

    // Avatar + badge, shown to other players.
    async lookOf(userId) {
      const { equipped } = await store.getItems(userId);
      const pick = (slot) => (equipped[slot] && ITEMS[equipped[slot]] ? ITEMS[equipped[slot]].preview : null);
      return { avatar: pick('avatar'), badge: pick('badge') };
    },

    // Owner tool: add or remove coins/chips (never below zero).
    async adjust(userId, dCoins, dChips) {
      const c = int(dCoins) || 0;
      const h = int(dChips) || 0;
      if (Math.abs(c) > 1e6 || Math.abs(h) > 1e8) return { error: 'That amount is too large' };
      return wallet(userId, (w) => ({
        update: { coins: Math.max(0, w.coins + c), chips: Math.max(0, w.chips + h) },
        result: { coins: Math.max(0, w.coins + c), chips: Math.max(0, w.chips + h) },
      }));
    },
  };
  return api;
}

// Coins for one player's result at the end of a hand / Durak game.
function rewardFor(r, highRoller) {
  if (!r.won) return 0;
  let coins = 0;
  if (r.mode === 'friends' || r.mode === 'bots') coins = 10 + Math.min(40, Math.floor(Math.max(0, r.pot) / 100));
  else if (r.mode === 'blackjack') coins = 5 + Math.min(20, Math.floor(Math.max(0, r.net) / 50));
  else if (r.mode === 'durak') coins = 15;
  return highRoller ? coins * 2 : coins;
}

module.exports = {
  makeCoins, rewardFor, status, dailyAmount, dayString, CATALOG, ITEMS, SLOTS,
  WELCOME_COINS, WELCOME_CHIPS, TABLE_DAILY_CAP, CONVERT_RATE, CONVERT_FLOOR, CONVERT_DAILY_MAX,
  BANKRUPT_BELOW, BANKRUPT_GRANT, BANKRUPT_COOLDOWN,
};
