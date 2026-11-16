// Reward coins: a play-money currency for accounts, separate from table chips.
// Earned from a daily bonus, winning at tables, and a free refill when low.
// Spent in the cosmetic shop; a minimum balance unlocks the high roller tables.
// Coins can never be bought with real money or cashed out.

const WELCOME = 200;            // new accounts start with this
const DAILY_BASE = 100;         // daily bonus on day 1 of a streak
const DAILY_STEP = 25;          // extra per consecutive day…
const DAILY_MAX_DAYS = 7;       // …up to day 7 (250 coins)
const REFILL_BELOW = 50;        // refill is available under this balance
const REFILL_AMOUNT = 100;
const REFILL_EVERY = 4 * 60 * 60 * 1000;
const TABLE_DAILY_CAP = 500;    // most coins you can win at tables per day
const HIGH_ROLLER_MIN = 500;    // balance needed to sit at a high roller table

// slot: cardback/felt are only shown on your own screen; badge is seen by everyone.
const CATALOG = [
  { id: 'back-royal', slot: 'cardback', name: 'Royal Blue', price: 200, preview: 'royal' },
  { id: 'back-midnight', slot: 'cardback', name: 'Midnight Gold', price: 300, preview: 'midnight' },
  { id: 'back-emerald', slot: 'cardback', name: 'Emerald', price: 300, preview: 'emerald' },
  { id: 'back-flames', slot: 'cardback', name: 'Flames', price: 500, preview: 'flames' },
  { id: 'felt-blue', slot: 'felt', name: 'Ocean Felt', price: 250, preview: 'blue' },
  { id: 'felt-purple', slot: 'felt', name: 'Royal Purple Felt', price: 250, preview: 'purple' },
  { id: 'felt-crimson', slot: 'felt', name: 'Crimson Felt', price: 400, preview: 'crimson' },
  { id: 'felt-black', slot: 'felt', name: 'Black Velvet', price: 600, preview: 'black' },
  { id: 'badge-star', slot: 'badge', name: 'Star', price: 150, preview: '⭐' },
  { id: 'badge-clover', slot: 'badge', name: 'Lucky Clover', price: 150, preview: '🍀' },
  { id: 'badge-fire', slot: 'badge', name: 'On Fire', price: 200, preview: '🔥' },
  { id: 'badge-shark', slot: 'badge', name: 'Card Shark', price: 400, preview: '🦈' },
  { id: 'badge-crown', slot: 'badge', name: 'Crown', price: 800, preview: '👑' },
  { id: 'badge-diamond', slot: 'badge', name: 'Diamond', price: 1000, preview: '💎' },
];
const ITEMS = Object.fromEntries(CATALOG.map((i) => [i.id, i]));

const dayString = (t) => new Date(t).toISOString().slice(0, 10); // UTC day
const dailyAmount = (streak) => DAILY_BASE + DAILY_STEP * (Math.min(streak, DAILY_MAX_DAYS) - 1);

// The streak the next claim would reach (missing a day resets to 1).
function nextStreak(w, now) {
  const today = dayString(now);
  const yesterday = dayString(now - 86400000);
  if (w.last_daily === today) return w.streak;
  return w.last_daily === yesterday ? w.streak + 1 : 1;
}

// What the client needs to show the wallet.
function status(w, now = Date.now()) {
  const today = dayString(now);
  const streak = nextStreak(w, now);
  const dailyReady = w.last_daily !== today;
  const tomorrow = new Date(today + 'T00:00:00Z').getTime() + 86400000;
  const refillAt = Number(w.last_refill || 0) + REFILL_EVERY;
  return {
    coins: w.coins,
    daily: {
      ready: dailyReady,
      amount: dailyAmount(dailyReady ? streak : Math.max(1, streak + 1)),
      streak: dailyReady ? streak - 1 : w.streak, // days already in a row
      nextAt: dailyReady ? null : tomorrow,
    },
    refill: {
      ready: w.coins < REFILL_BELOW && now >= refillAt,
      amount: REFILL_AMOUNT,
      below: REFILL_BELOW,
      nextAt: now >= refillAt ? null : refillAt,
    },
    earnedToday: w.earned_day === today ? w.earned_today : 0,
    tableCap: TABLE_DAILY_CAP,
  };
}

function makeCoins(store) {
  const wallet = (userId, fn) => store.updateWallet(userId, WELCOME, fn);

  return {
    CATALOG, HIGH_ROLLER_MIN,

    async getStatus(userId) {
      const w = await wallet(userId, (row) => ({ result: row }));
      const items = await store.getItems(userId);
      return { ...status(w), owned: items.owned, equipped: items.equipped };
    },

    async balance(userId) { return wallet(userId, (row) => ({ result: row.coins })); },

    async claimDaily(userId, now = Date.now()) {
      return wallet(userId, (w) => {
        if (w.last_daily === dayString(now)) return { result: { error: 'You already claimed today\'s bonus' } };
        const streak = nextStreak(w, now);
        const amount = dailyAmount(streak);
        const coins = w.coins + amount;
        return { update: { coins, last_daily: dayString(now), streak }, result: { amount, streak, coins } };
      });
    },

    async claimRefill(userId, now = Date.now()) {
      return wallet(userId, (w) => {
        if (w.coins >= REFILL_BELOW) return { result: { error: `Refills are for balances under ${REFILL_BELOW} coins` } };
        if (now < Number(w.last_refill || 0) + REFILL_EVERY) return { result: { error: 'Your next refill isn\'t ready yet' } };
        const coins = w.coins + REFILL_AMOUNT;
        return { update: { coins, last_refill: now }, result: { amount: REFILL_AMOUNT, coins } };
      });
    },

    // Table winnings, limited to TABLE_DAILY_CAP per day.
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
      // Ownership is checked inside the locked wallet update, so two quick
      // clicks can't buy (and pay for) the same item twice.
      return wallet(userId, (w, owned) => {
        if (owned.includes(itemId)) return { result: { error: 'You already own this' } };
        if (w.coins < item.price) return { result: { error: `You need ${item.price - w.coins} more coins` } };
        const coins = w.coins - item.price;
        return { update: { coins }, addItem: itemId, result: { coins, item: itemId } };
      });
    },

    async equip(userId, slot, itemId) {
      if (!['cardback', 'felt', 'badge'].includes(slot)) return { error: 'Unknown slot' };
      if (itemId) {
        const item = ITEMS[itemId];
        if (!item || item.slot !== slot) return { error: 'That item doesn\'t fit there' };
        const { owned } = await store.getItems(userId);
        if (!owned.includes(itemId)) return { error: 'Buy it first' };
      }
      await store.setEquipped(userId, slot, itemId || null);
      return { ok: true };
    },

    async badgeOf(userId) {
      const { equipped } = await store.getItems(userId);
      return equipped.badge && ITEMS[equipped.badge] ? ITEMS[equipped.badge].preview : null;
    },
  };
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

module.exports = { makeCoins, rewardFor, status, dailyAmount, CATALOG, ITEMS, HIGH_ROLLER_MIN, WELCOME, TABLE_DAILY_CAP, REFILL_EVERY };
