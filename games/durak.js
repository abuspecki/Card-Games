// Durak (podkidnoy / "throw-in"), 2–6 players, 36-card deck (6 to Ace).
// The bottom card of the deck sets the trump suit. Each round one attacker
// leads, the next player defends. After each beaten card, the attacker and
// then the other players may throw in more cards whose rank is already on the
// table (max 6 per round and never more than the defender held at the start).
// The defender may take everything instead. Everyone refills to 6 from the
// deck (attacker first, defender last). Players with no cards once the deck
// is empty are out; the last player holding cards is the durak (the fool).
const { BaseTable, SUITS, shuffle } = require('./base');

const D_RANKS = '6789TJQKA';
const MAX_PLAYERS = 6;
const rankOf = (c) => D_RANKS.indexOf(c[0]);
const RANK_NAMES = { 6: '6', 7: '7', 8: '8', 9: '9', T: '10', J: 'Jack', Q: 'Queen', K: 'King', A: 'Ace' };
const SUIT_NAMES = { s: 'Spades', h: 'Hearts', d: 'Diamonds', c: 'Clubs' };

class Durak extends BaseTable {
  constructor(opts) {
    super(opts);
    this.game = 'durak';
    this.deck = [];
    this.table = []; // [{ a: attackCard, d: defenseCard|null }]
    this.trump = null;
    this.trumpCard = null;
  }

  isPlaying() { return this.stage === 'playing'; }

  canStart() { return !this.isPlaying() && this.seats.filter(Boolean).length >= 2; }

  beats(def, att) {
    if (def[1] === att[1]) return rankOf(def) > rankOf(att);
    return def[1] === this.trump && att[1] !== this.trump;
  }

  // Still in the game: has cards, or can still draw from the deck.
  active(s) { return s && s.inHand && !s.out; }

  nextActive(from) { return this.nextSeat(from, (s) => this.active(s)); }

  startHand() {
    if (!this.canStart()) return false;
    this.handNo++;
    this.results = null;
    this.deck = [];
    for (const r of D_RANKS) for (const s of SUITS) this.deck.push(r + s);
    shuffle(this.deck);
    // Bottom card (index 0) is shown and sets trumps; cards are drawn from the end.
    this.trumpCard = this.deck[0];
    this.trump = this.trumpCard[1];
    let count = 0;
    for (const s of this.seats) {
      if (!s) continue;
      s.inHand = count < MAX_PLAYERS;
      if (s.inHand) count++;
      s.hand = [];
      s.out = false;
      s.lastAction = null;
    }
    for (let k = 0; k < 6; k++) for (const s of this.seats) if (s && s.inHand) s.hand.push(this.deck.pop());
    this.finished = [];
    this.addLog(`— Game #${this.handNo}: Durak — trumps are ${SUIT_NAMES[this.trump]} (${this.trumpCard}) —`);

    // The player with the lowest trump attacks first.
    let first = -1;
    let low = 99;
    this.seats.forEach((s, i) => {
      if (!s || !s.inHand) return;
      for (const c of s.hand) if (c[1] === this.trump && rankOf(c) < low) { low = rankOf(c); first = i; }
    });
    if (first === -1) first = this.nextActive(this.button);
    else this.addLog(`${this.seats[first].name} has the lowest trump and attacks first`);
    this.button = first;
    this.stage = 'playing';
    this.onEvent('deal');
    this.newRound(first);
    return true;
  }

  newRound(attacker) {
    this.attacker = attacker;
    this.defender = this.nextActive(attacker);
    this.table = [];
    this.limit = Math.min(6, this.seats[this.defender].hand.length);
    this.phase = 'attack';
    this.toAct = attacker;
    for (const s of this.seats) if (s && s.inHand && !s.out) s.lastAction = null;
    this.seats[attacker].lastAction = 'Attacking';
    this.seats[this.defender].lastAction = 'Defending';
  }

  // Attacker first, then everyone else clockwise, never the defender.
  throwers() {
    const order = [this.attacker];
    for (let i = this.nextActive(this.attacker); i !== -1 && i !== this.attacker; i = this.nextActive(i)) {
      if (i !== this.defender && !order.includes(i)) order.push(i);
    }
    return order;
  }

  tableRanks() {
    const r = new Set();
    for (const p of this.table) { r.add(p.a[0]); if (p.d) r.add(p.d[0]); }
    return r;
  }

  throwableCards(i) {
    const s = this.seats[i];
    if (!s || this.table.length >= this.limit) return [];
    const ranks = this.tableRanks();
    return s.hand.filter((c) => ranks.has(c[0]));
  }

  // Valid moves for seat i right now.
  moves(i) {
    const s = this.seats[i];
    if (!this.isPlaying() || i !== this.toAct || !s) return null;
    if (this.phase === 'attack') return { phase: 'attack', cards: s.hand.slice(), canTake: false, canPass: false };
    if (this.phase === 'defend') {
      const open = this.table.find((p) => !p.d);
      return { phase: 'defend', cards: s.hand.filter((c) => this.beats(c, open.a)), canTake: true, canPass: false, target: open.a };
    }
    return { phase: this.phase, cards: this.throwableCards(i), canTake: false, canPass: true };
  }

  act(id, action, card) {
    const i = this.seatOf(id);
    if (i === -1 || i !== this.toAct || !this.isPlaying()) return { error: 'Not your turn' };
    const s = this.seats[i];
    const mv = this.moves(i);

    if (action === 'play') {
      if (!mv.cards.includes(card)) return { error: 'You can\'t play that card now' };
      s.hand.splice(s.hand.indexOf(card), 1);
      this.onEvent('deal');
      if (this.phase === 'defend') {
        this.table.find((p) => !p.d).d = card;
        s.lastAction = 'Beat';
        this.addLog(`${s.name} beats with ${card}`);
        if (this.table.length >= this.limit || s.hand.length === 0) return this.endRound(false);
        this.startThrowing('throw');
      } else if (this.phase === 'takeThrow') {
        this.table.push({ a: card, d: null });
        s.lastAction = 'Throws in';
        this.addLog(`${s.name} throws in ${card}`);
        this.continueThrowing(i, false);
      } else {
        this.table.push({ a: card, d: null });
        s.lastAction = this.phase === 'attack' ? 'Attacks' : 'Throws in';
        this.addLog(`${s.name} ${this.phase === 'attack' ? 'attacks' : 'throws in'} ${card}`);
        this.phase = 'defend';
        this.toAct = this.defender;
      }
      return { ok: true };
    }
    if (action === 'take') {
      if (!mv.canTake) return { error: 'You can\'t take now' };
      s.lastAction = 'Takes';
      this.addLog(`${s.name} takes the cards`);
      this.onEvent('fold');
      this.startThrowing('takeThrow');
      return { ok: true };
    }
    if (action === 'pass') {
      if (!mv.canPass) return { error: 'You can\'t pass now' };
      s.lastAction = this.phase === 'takeThrow' ? 'Done' : 'Pass';
      this.continueThrowing(i, true);
      return { ok: true };
    }
    return { error: 'Unknown action' };
  }

  // Ask throwers in order whether they want to add a card; skip anyone who can't.
  startThrowing(phase) {
    this.phase = phase;
    this.throwOrder = this.throwers();
    this.throwPos = -1;
    this.continueThrowing(null, true);
  }

  continueThrowing(fromSeat, passed) {
    if (!passed) return; // same player may keep adding cards (takeThrow)
    for (let p = this.throwPos + 1; p < this.throwOrder.length; p++) {
      const i = this.throwOrder[p];
      if (this.throwableCards(i).length) { this.throwPos = p; this.toAct = i; return; }
    }
    this.endRound(this.phase === 'takeThrow');
  }

  endRound(taken) {
    const def = this.seats[this.defender];
    const cards = this.table.flatMap((p) => (p.d ? [p.a, p.d] : [p.a]));
    if (taken) {
      def.hand.push(...cards);
      def.lastAction = `Took ${cards.length}`;
    } else {
      this.addLog('Bito — the cards are discarded');
      this.onEvent('check');
    }
    this.table = [];
    // Refill: attacker, the other throwers, defender last.
    const order = [...this.throwers(), this.defender];
    for (const i of order) {
      const s = this.seats[i];
      while (s.hand.length < 6 && this.deck.length) s.hand.push(this.deck.pop());
    }
    // Anyone without cards once the deck is empty is out — they escaped.
    if (!this.deck.length) {
      this.seats.forEach((s, i) => {
        if (this.active(s) && s.hand.length === 0) {
          s.out = true;
          s.lastAction = 'Out ✓';
          this.finished.push(i);
          this.addLog(`${s.name} is out of cards!`);
        }
      });
    }
    const left = this.seats.map((s, i) => (this.active(s) ? i : -1)).filter((i) => i !== -1);
    if (left.length <= 1) return this.endGame(left.length ? left[0] : -1);

    // Next attacker: after a successful defense the defender attacks;
    // after a take, the player after the defender attacks.
    let next;
    if (!taken && this.active(def)) next = this.defender;
    else next = this.nextActive(this.defender);
    this.newRound(next);
    return { ok: true };
  }

  endGame(loser) {
    this.stage = 'showdown';
    this.toAct = -1;
    this.durak = loser;
    const winners = this.seats.map((s, i) => (s && s.inHand && i !== loser ? { seat: i, amount: 0, hand: 'escaped' } : null)).filter(Boolean);
    this.results = { shown: true, winners, durak: loser };
    if (loser !== -1) {
      this.seats[loser].lastAction = '🃏 Durak!';
      this.addLog(`${this.seats[loser].name} is the durak!`);
    } else {
      this.addLog('Draw — everyone got rid of their cards');
    }
    this.onEvent('win');
    return { ok: true };
  }

  leave(id) {
    const i = this.seatOf(id);
    if (i === -1) return;
    const s = this.seats[i];
    if (this.isPlaying() && this.active(s)) {
      // Leaving mid-game makes you the durak.
      this.addLog(`${s.name} left the game`);
      this.endGame(i);
    }
    this.seats[i] = null;
  }

  defaultAction(i) {
    const mv = this.moves(i);
    if (!mv) return { action: 'pass' };
    if (mv.phase === 'attack') return { action: 'play', amount: this.lowest(mv.cards) };
    if (mv.phase === 'defend') return { action: 'take' };
    return { action: 'pass' };
  }

  // Order cards by value: non-trumps first, then by rank.
  cost(c) { return rankOf(c) + (c[1] === this.trump ? 20 : 0); }
  lowest(cards) { return cards.slice().sort((a, b) => this.cost(a) - this.cost(b))[0]; }

  botAction(i) {
    const mv = this.moves(i);
    if (!mv) return { action: 'pass' };
    const late = this.deck.length === 0;
    if (mv.phase === 'attack') return { action: 'play', amount: this.lowest(mv.cards) };
    if (mv.phase === 'defend') {
      if (!mv.cards.length) return { action: 'take' };
      const best = this.lowest(mv.cards);
      // Early in the game, don't waste a high trump on a cheap card.
      if (!late && best[1] === this.trump && rankOf(best) >= 5 && rankOf(mv.target) <= 3 && this.table.length === 1) return { action: 'take' };
      return { action: 'play', amount: best };
    }
    // Throw in only cheap non-trumps (or anything once the deck is empty).
    const cheap = mv.cards.filter((c) => late || (c[1] !== this.trump && rankOf(c) <= 5));
    if (cheap.length) return { action: 'play', amount: this.lowest(cheap) };
    return { action: 'pass' };
  }

  resultsForRecord() {
    if (!this.results) return [];
    return this.seats.filter((s) => s && s.inHand && s.accountId).map((s) => {
      const lost = this.seats.indexOf(s) === this.durak;
      return { accountId: s.accountId, mode: 'durak', net: this.durak === -1 ? 0 : lost ? -1 : 1, won: !lost, pot: 0 };
    });
  }

  view(viewerId) {
    const v = this.baseView(viewerId);
    v.variantName = 'Durak';
    v.trump = this.trump;
    v.trumpCard = this.deck.length ? this.trumpCard : null;
    v.deckCount = this.deck.length;
    v.table = this.table;
    v.attacker = this.isPlaying() ? this.attacker : -1;
    v.defender = this.isPlaying() ? this.defender : -1;
    v.phase = this.isPlaying() ? this.phase : null;
    v.limit = this.limit;
    v.durak = this.stage === 'showdown' ? this.durak : null;
    v.moves = v.mySeat !== -1 ? this.moves(v.mySeat) : null;
    v.limits = v.moves; // client uses limits to know it's your turn
    v.seats = this.seats.map((s, i) => s && {
      ...this.baseSeatView(s),
      out: !!s.out,
      cardCount: (s.hand || []).length,
      hole: i === v.mySeat ? (s.hand || []).slice().sort((a, b) => this.cost(a) - this.cost(b)) : null,
    });
    return v;
  }
}

module.exports = { Durak, D_RANKS };
