// European roulette (single zero). Everyone at the table bets at the same
// time during a short betting window; then the wheel spins once for all.
//
// Stages: waiting -> betting (deadline) -> spinning (deadline) -> showdown.
// Bets are held aside while betting (you can undo / clear them) and taken
// from your stack when the wheel starts; winnings are paid at the showdown.
const { BaseTable } = require('./base');

const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const BETTING_MS = 20000;
const SPIN_MS = 6000;
const MAX_BETS = 60; // per player and spin

const colorOf = (n) => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black');

// Every bet spot: which numbers it covers and what it pays (x to 1).
const SPOTS = {};
for (let n = 0; n <= 36; n++) SPOTS['n' + n] = { nums: [n], pays: 35, label: String(n) };
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const all = range(1, 36);
Object.assign(SPOTS, {
  red: { nums: all.filter((n) => REDS.has(n)), pays: 1, label: 'Red' },
  black: { nums: all.filter((n) => !REDS.has(n)), pays: 1, label: 'Black' },
  even: { nums: all.filter((n) => n % 2 === 0), pays: 1, label: 'Even' },
  odd: { nums: all.filter((n) => n % 2 === 1), pays: 1, label: 'Odd' },
  low: { nums: range(1, 18), pays: 1, label: '1–18' },
  high: { nums: range(19, 36), pays: 1, label: '19–36' },
  dozen1: { nums: range(1, 12), pays: 2, label: '1st 12' },
  dozen2: { nums: range(13, 24), pays: 2, label: '2nd 12' },
  dozen3: { nums: range(25, 36), pays: 2, label: '3rd 12' },
  col1: { nums: all.filter((n) => n % 3 === 1), pays: 2, label: 'Column 1' },
  col2: { nums: all.filter((n) => n % 3 === 2), pays: 2, label: 'Column 2' },
  col3: { nums: all.filter((n) => n % 3 === 0), pays: 2, label: 'Column 3' },
});

// Payout (including the stake) of one bet for a winning number.
function payout(spot, amount, n) {
  const s = SPOTS[spot];
  return s && s.nums.includes(n) ? amount * (s.pays + 1) : 0;
}

class Roulette extends BaseTable {
  constructor(opts) {
    super(opts);
    this.game = 'roulette';
    this.deadline = 0;
    this.number = null;
    this.history = [];
    this.rng = opts && opts.rng ? opts.rng : () => Math.random();
  }

  minBet() { return this.settings.bigBlind || 5; }
  maxSpot() { return this.minBet() * 1000; }   // per place: up to 1,000× the minimum

  isPlaying() { return this.stage === 'betting' || this.stage === 'spinning'; }

  canStart() { return !this.isPlaying() && this.seats.some((s) => s && s.chips >= this.minBet()); }

  staked(s) { return (s.bets || []).reduce((a, b) => a + b.amount, 0); }

  startHand(now = Date.now()) {
    if (!this.canStart()) return false;
    this.handNo++;
    this.results = null;
    this.number = null;
    for (const s of this.seats) {
      if (!s) continue;
      s.bets = [];
      s.ready = false;
      s.inHand = false;
      s.startChips = s.chips;
      s.lastAction = null;
    }
    this.stage = 'betting';
    this.toAct = -1;
    this.deadline = now + BETTING_MS;
    this.addLog(`— Spin #${this.handNo}: place your bets —`);
    this.placeBotBets();
    return true;
  }

  placeBotBets() {
    const outside = ['red', 'black', 'even', 'odd', 'low', 'high', 'dozen1', 'dozen2', 'dozen3', 'col1', 'col2', 'col3'];
    for (const s of this.seats) {
      if (!s || !s.isBot || s.chips < this.minBet()) continue;
      const n = 1 + Math.floor(this.rng() * 3);
      for (let k = 0; k < n; k++) {
        const spot = this.rng() < 0.6 ? outside[Math.floor(this.rng() * outside.length)] : 'n' + Math.floor(this.rng() * 37);
        const amount = this.minBet() * (1 + Math.floor(this.rng() * 4));
        this.placeBet(s, spot, amount);
      }
      s.ready = true;
    }
  }

  placeBet(s, spot, amount) {
    if (!SPOTS[spot]) return { error: 'Choose a place on the layout' };
    amount = Math.floor(Number(amount));
    if (!Number.isFinite(amount) || amount < this.minBet()) return { error: `The minimum bet is ${this.minBet()}` };
    if ((s.bets || []).length >= MAX_BETS) return { error: 'That is plenty of bets for one spin' };
    if (this.staked(s) + amount > s.chips) return { error: 'Not enough chips' };
    const onSpot = s.bets.filter((b) => b.spot === spot).reduce((a, b) => a + b.amount, 0);
    if (onSpot + amount > this.maxSpot()) return { error: `At most ${this.maxSpot()} on one place` };
    s.bets.push({ spot, amount });
    return { ok: true };
  }

  // Actions: bet {spot, amount} · undo · clear · repeat · double · ready
  act(id, action, data) {
    const i = this.seatOf(id);
    if (i === -1) return { error: 'Take a seat first' };
    if (this.stage !== 'betting') return { error: 'No more bets — the wheel is spinning' };
    const s = this.seats[i];
    s.bets = s.bets || [];
    let r = { ok: true };
    if (action === 'bet') {
      const d = data && typeof data === 'object' ? data : {};
      r = this.placeBet(s, String(d.spot || ''), d.amount);
    } else if (action === 'undo') {
      s.bets.pop();
    } else if (action === 'clear') {
      s.bets = [];
    } else if (action === 'repeat') {
      if (!s.lastBets || !s.lastBets.length) return { error: 'Nothing to repeat yet' };
      const total = s.lastBets.reduce((a, b) => a + b.amount, 0);
      if (this.staked(s) + total > s.chips) return { error: 'Not enough chips to repeat' };
      for (const b of s.lastBets) this.placeBet(s, b.spot, b.amount);
    } else if (action === 'double') {
      if (!s.bets.length) return { error: 'Place a bet first' };
      if (this.staked(s) * 2 > s.chips) return { error: 'Not enough chips to double' };
      const copy = s.bets.map((b) => ({ ...b }));
      for (const b of copy) this.placeBet(s, b.spot, b.amount);
    } else if (action === 'ready') {
      if (!s.bets.length) return { error: 'Place a bet first' };
      s.ready = true;
      // Everyone with bets is ready (and no human is still empty-handed): spin now.
      const humans = this.seats.filter((p) => p && !p.isBot && p.connected);
      if (humans.every((p) => p.ready || !p.bets.length) && humans.some((p) => p.ready)) this.deadline = Date.now();
      return { ok: true, tick: true };
    } else {
      return { error: 'Unknown action' };
    }
    if (r.error) return r;
    if (action !== 'ready') s.ready = false;
    s.lastAction = s.bets.length ? `Bets ${this.staked(s)}` : null;
    this.onEvent('chips');
    return r;
  }

  // Called by the lobby when the deadline passes. Returns true if anything changed.
  tick(now = Date.now()) {
    if (!this.isPlaying() || now < this.deadline) return false;
    if (this.stage === 'betting') {
      const players = this.seats.filter((s) => s && s.bets && s.bets.length);
      if (!players.some((s) => !s.isBot)) {
        // Nobody real has bet: keep the table open for another round of bets.
        this.deadline = now + BETTING_MS;
        for (const s of this.seats) if (s && s.isBot) { s.bets = []; s.ready = false; }
        this.placeBotBets();
        return true;
      }
      for (const s of this.seats) {
        if (!s) continue;
        s.bets = s.bets || [];
        s.inHand = s.bets.length > 0;
        s.chips -= this.staked(s);
        if (s.inHand) s.lastBets = s.bets.map((b) => ({ ...b }));
      }
      this.number = WHEEL[Math.floor(this.rng() * WHEEL.length)];
      this.stage = 'spinning';
      this.deadline = now + SPIN_MS;
      this.addLog('No more bets');
      this.onEvent('deal');
      return true;
    }
    this.settle();
    return true;
  }

  settle() {
    const n = this.number;
    const winners = [];
    this.seats.forEach((s, i) => {
      if (!s || !s.inHand) return;
      let won = 0;
      for (const b of s.bets) { b.win = payout(b.spot, b.amount, n); won += b.win; }
      s.chips += won;
      const net = s.chips - s.startChips;
      s.lastAction = net > 0 ? `Won ${net}` : net < 0 ? `Lost ${-net}` : 'Even';
      if (net > 0) winners.push({ seat: i, amount: net });
    });
    this.history.unshift(n);
    this.history = this.history.slice(0, 14);
    this.addLog(`The ball lands on ${n} ${colorOf(n)}`);
    for (const w of winners) this.addLog(`${this.seats[w.seat].name} wins ${w.amount}`);
    this.results = { shown: true, number: n, color: colorOf(n), winners };
    this.stage = 'showdown';
    this.toAct = -1;
    this.deadline = 0;
    this.onEvent('win');
  }

  leave(id) {
    const i = this.seatOf(id);
    if (i === -1) return;
    // While betting nothing has been taken yet; once spinning, the bets stay on the table.
    this.seats[i] = null;
    if (this.isPlaying() && !this.seats.some((s) => s && !s.isBot)) { this.stage = 'waiting'; this.deadline = 0; this.toAct = -1; }
  }

  defaultAction() { return { action: 'ready' }; }
  botAction() { return { action: 'ready' }; }

  resultsForRecord() {
    return this.seats.filter((s) => s && s.inHand && s.accountId).map((s) => {
      const net = s.chips - s.startChips;
      return { accountId: s.accountId, mode: 'roulette', net, won: net > 0, pot: Math.max(0, net) };
    });
  }

  view(viewerId) {
    const v = this.baseView(viewerId);
    v.variantName = 'Roulette';
    v.minBet = this.minBet();
    v.maxSpot = this.maxSpot();
    v.msLeft = this.isPlaying() ? Math.max(0, this.deadline - Date.now()) : 0;
    v.number = this.stage === 'spinning' || this.stage === 'showdown' ? this.number : null;
    v.history = this.history.slice();
    const me = v.mySeat !== -1 ? this.seats[v.mySeat] : null;
    v.limits = me && this.stage === 'betting'
      ? { phase: 'bet', minBet: this.minBet(), maxSpot: this.maxSpot(), available: me.chips - this.staked(me), canRepeat: !!(me.lastBets && me.lastBets.length), ready: !!me.ready }
      : null;
    v.seats = this.seats.map((s) => s && {
      ...this.baseSeatView(s),
      bet: this.staked(s),
      ready: !!s.ready,
      bets: (s.bets || []).map((b) => ({ spot: b.spot, amount: b.amount, win: b.win || 0 })),
    });
    return v;
  }
}

module.exports = { Roulette, WHEEL, REDS, SPOTS, payout, colorOf, BETTING_MS, SPIN_MS };
