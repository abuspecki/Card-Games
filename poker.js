// Poker engine: deck, hand evaluation, betting rounds, side pots.
// Variants share one engine; they differ in hole-card count, betting limit
// and how hole cards may be combined with the board.

const VARIANTS = {
  holdem: { name: "Texas Hold'em", hole: 2, limit: 'nl', mustUseHole: 0 },
  omaha: { name: 'Omaha (Pot Limit)', hole: 4, limit: 'pl', mustUseHole: 2 },
  omaha5: { name: '5-Card Omaha (Pot Limit)', hole: 5, limit: 'pl', mustUseHole: 2 },
};

const RANKS = '23456789TJQKA';
const SUITS = 'shdc';

function newDeck() {
  const d = [];
  for (const r of RANKS) for (const s of SUITS) d.push(r + s);
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

const rankVal = (c) => RANKS.indexOf(c[0]) + 2;

const CATEGORY_NAMES = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
];

// Score a 5-card hand. Higher is better.
function eval5(cards) {
  const ranks = cards.map(rankVal);
  const flush = cards.every((c) => c[1] === cards[0][1]);
  const counts = {};
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
  const groups = Object.entries(counts)
    .map(([r, n]) => [Number(r), n])
    .sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const uniq = [...new Set(ranks)].sort((a, b) => b - a);
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq.join() === '14,5,4,3,2') straightHigh = 5;
  }
  let cat;
  let kick;
  if (straightHigh && flush) { cat = 8; kick = [straightHigh]; }
  else if (groups[0][1] === 4) { cat = 7; kick = groups.map((g) => g[0]); }
  else if (groups[0][1] === 3 && groups[1][1] === 2) { cat = 6; kick = groups.map((g) => g[0]); }
  else if (flush) { cat = 5; kick = uniq; }
  else if (straightHigh) { cat = 4; kick = [straightHigh]; }
  else if (groups[0][1] === 3) { cat = 3; kick = groups.map((g) => g[0]); }
  else if (groups[0][1] === 2 && groups[1][1] === 2) { cat = 2; kick = groups.map((g) => g[0]); }
  else if (groups[0][1] === 2) { cat = 1; kick = groups.map((g) => g[0]); }
  else { cat = 0; kick = uniq; }
  let score = cat;
  for (let i = 0; i < 5; i++) score = score * 15 + (kick[i] || 0);
  return { score, cat, name: CATEGORY_NAMES[cat] };
}

function combos(arr, k) {
  const out = [];
  const rec = (start, pick) => {
    if (pick.length === k) { out.push(pick.slice()); return; }
    for (let i = start; i < arr.length; i++) { pick.push(arr[i]); rec(i + 1, pick); pick.pop(); }
  };
  rec(0, []);
  return out;
}

// Best hand from hole + board according to variant rules.
function bestHand(hole, board, variant) {
  const v = VARIANTS[variant];
  let best = null;
  const consider = (five) => {
    const e = eval5(five);
    if (!best || e.score > best.score) best = { ...e, cards: five };
  };
  if (v.mustUseHole) {
    for (const h of combos(hole, 2)) for (const b of combos(board, 3)) consider([...h, ...b]);
  } else {
    for (const five of combos([...hole, ...board], 5)) consider(five);
  }
  return best;
}

// Monte Carlo odds: deal random opponent hands and runouts many times.
// Uses only the player's own cards and the board (never other players' cards).
// Returns win share (ties split) and how often each final hand category is made.
function simulateOdds(hole, board, variant, opponents, sims) {
  const known = new Set([...hole, ...board]);
  const rest = newDeck().filter((c) => !known.has(c));
  const holeSize = VARIANTS[variant].hole;
  const need = opponents * holeSize + (5 - board.length);
  const made = new Array(9).fill(0);
  let win = 0;
  let tie = 0;
  for (let n = 0; n < sims; n++) {
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(Math.random() * (rest.length - i));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    let k = 5 - board.length;
    const fullBoard = board.concat(rest.slice(0, k));
    const mine = bestHand(hole, fullBoard, variant);
    made[mine.cat]++;
    let ties = 0;
    let lost = false;
    for (let o = 0; o < opponents; o++) {
      const s = bestHand(rest.slice(k, k + holeSize), fullBoard, variant).score;
      k += holeSize;
      if (s > mine.score) { lost = true; break; }
      if (s === mine.score) ties++;
    }
    if (!lost) { win += 1 / (ties + 1); if (ties) tie++; }
  }
  return { win: win / sims, tie: tie / sims, made: made.map((m) => m / sims) };
}

class Table {
  constructor(opts = {}) {
    this.maxSeats = 8;
    this.seats = new Array(this.maxSeats).fill(null);
    this.settings = {
      variant: 'holdem',
      rotate: false,
      startingStack: 1000,
      smallBlind: 5,
      bigBlind: 10,
      showOdds: true,
      ...opts,
    };
    this.game = 'holdem';
    this.button = -1;
    this.handNo = 0;
    this.resetHand();
    this.log = [];
    this.onEvent = () => {};
  }

  resetHand() {
    this.stage = 'waiting'; // waiting | preflop | flop | turn | river | showdown
    this.board = [];
    this.deck = [];
    this.currentBet = 0;
    this.minRaise = 0;
    this.toAct = -1;
    this.results = null;
    this.variant = this.settings.variant;
  }

  // Chat is kept apart from the game log so busy hands don't push messages out.
  addChat(seat, from, text) {
    this.chatSeq = (this.chatSeq || 0) + 1;
    this.chat = this.chat || [];
    this.chat.push({ id: this.chatSeq, seat, from, text: String(text).slice(0, 200), at: Date.now() });
    if (this.chat.length > 50) this.chat.shift();
  }

  addLog(msg) {
    this.log.push(msg);
    if (this.log.length > 60) this.log.shift();
  }

  sit(player) {
    const idx = this.seats.findIndex((s) => s === null);
    if (idx === -1) return -1;
    this.seats[idx] = {
      id: player.id, name: player.name, chips: this.settings.startingStack,
      hole: [], folded: true, allIn: false, bet: 0, totalBet: 0, acted: false,
      inHand: false, connected: true, isBot: !!player.isBot, botStyle: player.botStyle,
      accountId: player.accountId || null, startChips: 0,
    };
    return idx;
  }

  seatOf(id) { return this.seats.findIndex((s) => s && s.id === id); }

  // Put a player into a specific seat (used when the room switches games).
  sitAt(idx, player) {
    const saved = this.seats;
    this.seats = new Array(this.maxSeats).fill(null);
    this.sit(player); // builds the seat object at index 0
    const seat = this.seats[0];
    this.seats = saved;
    this.seats[idx] = seat;
    if (player.chips !== undefined) seat.chips = player.chips;
    if (player.connected !== undefined) seat.connected = player.connected;
  }

  // What a disconnected player does automatically.
  defaultAction(i) { return { action: this.limits(i).toCall > 0 ? 'fold' : 'check' }; }

  // Results to save for accounts. 2+ humans count as "friends", else "bots".
  resultsForRecord() {
    const humans = this.seats.filter((s) => s && s.inHand && !s.isBot).length;
    const mode = humans >= 2 ? 'friends' : 'bots';
    const winners = new Map((this.results ? this.results.winners : []).map((w) => [w.seat, w.amount]));
    return this.seats.map((s, i) => (s && s.accountId && s.inHand
      ? { accountId: s.accountId, mode, net: s.chips - s.startChips, won: winners.has(i), pot: winners.get(i) || 0 } : null)).filter(Boolean);
  }

  // Leaving mid-hand still counts as a loss of what was put in.
  leaveRecord(i) {
    const s = this.seats[i];
    if (!s || !s.accountId || !s.inHand || !this.isPlaying()) return null;
    const humans = this.seats.filter((x) => x && x.inHand && !x.isBot).length;
    return { accountId: s.accountId, mode: humans >= 2 ? 'friends' : 'bots', net: s.chips - s.startChips, won: false, pot: 0 };
  }

  leave(id) {
    const i = this.seatOf(id);
    if (i === -1) return;
    const p = this.seats[i];
    if (p.inHand && !p.folded && this.isPlaying()) {
      if (this.toAct === i) { this.act(id, 'fold'); }
      else { p.folded = true; this.checkHandOver(); }
    }
    this.seats[i] = null;
  }

  isPlaying() { return ['preflop', 'flop', 'turn', 'river'].includes(this.stage); }

  nextSeat(from, pred) {
    for (let k = 1; k <= this.maxSeats; k++) {
      const i = (from + k) % this.maxSeats;
      if (this.seats[i] && pred(this.seats[i], i)) return i;
    }
    return -1;
  }

  eligiblePlayers() { return this.seats.filter((s) => s && s.chips > 0); }

  canStart() { return !this.isPlaying() && this.eligiblePlayers().length >= 2; }

  startHand() {
    if (!this.canStart()) return false;
    const variantKeys = Object.keys(VARIANTS);
    if (this.settings.rotate && this.handNo > 0) {
      const i = variantKeys.indexOf(this.settings.variant);
      this.settings.variant = variantKeys[(i + 1) % variantKeys.length];
    }
    this.handNo++;
    this.resetHand();
    const v = VARIANTS[this.variant];
    this.deck = newDeck();
    for (const s of this.seats) {
      if (!s) continue;
      Object.assign(s, { hole: [], bet: 0, totalBet: 0, acted: false, allIn: false });
      s.inHand = s.chips > 0;
      s.startChips = s.chips;
      s.folded = !s.inHand;
      s.lastAction = null;
    }
    const inHand = (s) => s.inHand;
    this.button = this.nextSeat(this.button, inHand);
    const headsUp = this.seats.filter((s) => s && s.inHand).length === 2;
    const sb = headsUp ? this.button : this.nextSeat(this.button, inHand);
    const bb = this.nextSeat(sb, inHand);
    this.sbSeat = sb;
    this.bbSeat = bb;
    this.addLog(`— Hand #${this.handNo}: ${v.name} —`);
    this.postBlind(sb, this.settings.smallBlind, 'SB');
    this.postBlind(bb, this.settings.bigBlind, 'BB');
    this.currentBet = this.settings.bigBlind;
    this.minRaise = this.settings.bigBlind;
    for (let r = 0; r < v.hole; r++) {
      for (let k = 1; k <= this.maxSeats; k++) {
        const s = this.seats[(this.button + k) % this.maxSeats];
        if (s && s.inHand) s.hole.push(this.deck.pop());
      }
    }
    this.stage = 'preflop';
    this.onEvent('deal');
    this.toAct = bb;
    this.afterAction();
    return true;
  }

  postBlind(i, amt, label) {
    const s = this.seats[i];
    const a = Math.min(amt, s.chips);
    s.chips -= a; s.bet += a; s.totalBet += a;
    if (s.chips === 0) s.allIn = true;
    s.lastAction = `${label} ${a}`;
    this.addLog(`${s.name} posts ${label} ${a}`);
  }

  canAct(s) { return s && s.inHand && !s.folded && !s.allIn; }

  pot() { return this.seats.reduce((t, s) => t + (s ? s.totalBet : 0), 0); }

  // Limits for the player to act: returns {toCall, minTo, maxTo}
  limits(i) {
    const s = this.seats[i];
    const toCall = Math.min(this.currentBet - s.bet, s.chips);
    const allInTo = s.bet + s.chips;
    let maxTo = allInTo;
    if (VARIANTS[this.variant].limit === 'pl') {
      const potAfterCall = this.pot() + (this.currentBet - s.bet);
      maxTo = Math.min(allInTo, this.currentBet + potAfterCall);
    }
    const minTo = Math.min(this.currentBet + this.minRaise, allInTo);
    const canRaise = allInTo > this.currentBet;
    return { toCall, minTo, maxTo, canRaise, bet: s.bet };
  }

  act(id, action, amount) {
    const i = this.seatOf(id);
    if (i === -1 || i !== this.toAct || !this.isPlaying()) return { error: 'Not your turn' };
    const s = this.seats[i];
    const lim = this.limits(i);
    if (action === 'fold') {
      s.folded = true;
      s.lastAction = 'Fold';
      this.addLog(`${s.name} folds`);
      this.onEvent('fold');
    } else if (action === 'check') {
      if (lim.toCall > 0) return { error: 'Cannot check' };
      s.lastAction = 'Check';
      this.addLog(`${s.name} checks`);
      this.onEvent('check');
    } else if (action === 'call') {
      if (lim.toCall <= 0) return { error: 'Nothing to call' };
      this.putIn(s, lim.toCall);
      s.lastAction = s.allIn ? 'All-in' : `Call ${lim.toCall}`;
      this.addLog(`${s.name} calls ${lim.toCall}${s.allIn ? ' (all-in)' : ''}`);
      this.onEvent(s.allIn ? 'allin' : 'chips');
    } else if (action === 'raise') {
      if (!lim.canRaise) return { error: 'Cannot raise' };
      let to = Math.floor(Number(amount));
      if (!Number.isFinite(to)) return { error: 'Bad amount' };
      to = Math.max(lim.minTo, Math.min(lim.maxTo, to));
      const increment = to - this.currentBet;
      this.putIn(s, to - s.bet);
      if (increment >= this.minRaise) this.minRaise = increment;
      const verb = this.currentBet === 0 ? 'bets' : 'raises to';
      this.currentBet = to;
      s.lastAction = s.allIn ? 'All-in' : (verb === 'bets' ? `Bet ${to}` : `Raise ${to}`);
      this.addLog(`${s.name} ${verb} ${to}${s.allIn ? ' (all-in)' : ''}`);
      this.onEvent(s.allIn ? 'allin' : 'chips');
    } else {
      return { error: 'Unknown action' };
    }
    s.acted = true;
    if (this.checkHandOver()) return { ok: true };
    this.toAct = i;
    this.afterAction();
    return { ok: true };
  }

  putIn(s, amt) {
    const a = Math.min(amt, s.chips);
    s.chips -= a; s.bet += a; s.totalBet += a;
    if (s.chips === 0) s.allIn = true;
  }

  // Ends the hand if everyone else folded.
  checkHandOver() {
    const live = this.seats.filter((s) => s && s.inHand && !s.folded);
    if (live.length === 1 && this.isPlaying()) {
      const w = live[0];
      const total = this.pot();
      w.chips += total;
      this.addLog(`${w.name} wins ${total}`);
      this.results = { winners: [{ seat: this.seats.indexOf(w), amount: total, hand: null }], shown: false };
      this.endHand();
      return true;
    }
    return false;
  }

  afterAction() {
    // Advance streets until someone needs to act, or the hand ends.
    while (this.isPlaying()) {
      const actors = this.seats.filter((s) => this.canAct(s));
      const needs = actors.filter((s) => !s.acted || s.bet !== this.currentBet);
      const nobodyToBetAgainst = actors.length <= 1 && actors.every((s) => s.bet >= this.currentBet);
      if (needs.length === 0 || nobodyToBetAgainst) {
        if (this.stage === 'river') { this.showdown(); return; }
        this.nextStreet();
        continue;
      }
      const from = this.toAct === -1 ? this.button : this.toAct;
      this.toAct = this.nextSeat(from, (s) => needs.includes(s));
      return;
    }
  }

  nextStreet() {
    for (const s of this.seats) if (s) { s.bet = 0; s.acted = false; if (!s.folded && !s.allIn) s.lastAction = null; }
    this.currentBet = 0;
    this.toAct = -1;
    this.minRaise = this.settings.bigBlind;
    this.deck.pop(); // burn
    if (this.stage === 'preflop') { this.board.push(this.deck.pop(), this.deck.pop(), this.deck.pop()); this.stage = 'flop'; }
    else if (this.stage === 'flop') { this.board.push(this.deck.pop()); this.stage = 'turn'; }
    else if (this.stage === 'turn') { this.board.push(this.deck.pop()); this.stage = 'river'; }
    this.addLog(`${this.stage[0].toUpperCase() + this.stage.slice(1)}: ${this.board.join(' ')}`);
    this.onEvent('street');
  }

  showdown() {
    while (this.board.length < 5) this.board.push(this.deck.pop());
    const live = [];
    this.seats.forEach((s, i) => {
      if (s && s.inHand && !s.folded) {
        s.best = bestHand(s.hole, this.board, this.variant);
        live.push(i);
      }
    });
    // Build side pots from total contributions.
    const contrib = this.seats.map((s) => (s ? s.totalBet : 0));
    const levels = [...new Set(contrib.filter((c) => c > 0))].sort((a, b) => a - b);
    let prev = 0;
    const pots = [];
    for (const lvl of levels) {
      let amount = 0;
      for (const c of contrib) amount += Math.max(0, Math.min(c, lvl) - prev);
      const eligible = live.filter((i) => contrib[i] >= lvl);
      if (eligible.length === 0 && pots.length) pots[pots.length - 1].amount += amount;
      else if (eligible.length) {
        const last = pots[pots.length - 1];
        if (last && last.eligible.join() === eligible.join()) last.amount += amount;
        else pots.push({ amount, eligible });
      }
      prev = lvl;
    }
    const won = {};
    pots.forEach((pot, pi) => {
      const top = Math.max(...pot.eligible.map((i) => this.seats[i].best.score));
      // Order winners clockwise from the button for odd chips.
      const winners = pot.eligible
        .filter((i) => this.seats[i].best.score === top)
        .sort((a, b) => ((a - this.button - 1 + 16) % 8) - ((b - this.button - 1 + 16) % 8));
      const share = Math.floor(pot.amount / winners.length);
      let odd = pot.amount - share * winners.length;
      for (const w of winners) {
        const amt = share + (odd-- > 0 ? 1 : 0);
        this.seats[w].chips += amt;
        won[w] = (won[w] || 0) + amt;
      }
      const label = pots.length > 1 ? (pi === 0 ? 'main pot' : `side pot ${pi}`) : 'the pot';
      this.addLog(`${winners.map((w) => this.seats[w].name).join(' & ')} win${winners.length > 1 ? '' : 's'} ${label} (${pot.amount}) with ${this.seats[winners[0]].best.name}`);
    });
    this.results = {
      shown: true,
      winners: Object.entries(won).map(([seat, amount]) => ({
        seat: Number(seat), amount, hand: this.seats[seat].best.name, cards: this.seats[seat].best.cards,
      })),
    };
    this.endHand();
  }

  endHand() {
    this.stage = 'showdown';
    this.toAct = -1;
    this.onEvent('win');
  }

  // State as seen by one viewer (hides other players' hole cards).
  view(viewerId) {
    const showAll = this.stage === 'showdown' && this.results && this.results.shown;
    const me = this.seatOf(viewerId);
    return {
      game: 'holdem',
      stage: this.stage,
      variant: this.variant,
      variantName: VARIANTS[this.variant].name,
      settings: this.settings,
      variants: Object.fromEntries(Object.entries(VARIANTS).map(([k, v]) => [k, v.name])),
      board: this.board,
      pot: this.pot(),
      button: this.button,
      toAct: this.toAct,
      currentBet: this.currentBet,
      handNo: this.handNo,
      mySeat: me,
      limits: me !== -1 && me === this.toAct ? this.limits(me) : null,
      results: this.results,
      log: this.log.slice(-40),
      chat: (this.chat || []).slice(-50),
      seats: this.seats.map((s, i) => s && {
        name: s.name, chips: s.chips, bet: s.bet, folded: s.folded, allIn: s.allIn,
        inHand: s.inHand, connected: s.connected, lastAction: s.lastAction, isBot: s.isBot, hasAccount: !!s.accountId, badge: s.badge || null, avatar: s.avatar || null,
        cardCount: s.hole.length,
        hole: i === me || (showAll && s.inHand && !s.folded) ? s.hole : null,
        handName: (i === me || showAll) && s.inHand && !s.folded && this.board.length >= 3
          ? bestHand(s.hole, this.board, this.variant).name : null,
      }),
    };
  }
}

const PokerEngine = { Table, VARIANTS, CATEGORY_NAMES, eval5, bestHand, newDeck, simulateOdds };
// Works in Node (server) and in the browser (odds window).
if (typeof module !== 'undefined' && module.exports) module.exports = PokerEngine;
else globalThis.PokerEngine = PokerEngine;
