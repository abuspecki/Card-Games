// Blackjack: every player plays their own hand against the dealer.
// Rules: 6-deck shoe, dealer stands on soft 17, blackjack pays 3:2,
// double on any first two cards, one split per hand (split aces get one card),
// dealer peeks for blackjack.
const { BaseTable, RANKS, SUITS, shuffle } = require('./base');

const DECKS = 6;

function cardValue(c) {
  const r = c[0];
  if (r === 'A') return 11;
  if ('TJQK'.includes(r)) return 10;
  return Number(r);
}

// Returns { total, soft } — soft means an ace is still counted as 11.
function handTotal(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) { total += cardValue(c); if (c[0] === 'A') aces++; }
  while (total > 21 && aces) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}

const isBlackjack = (hand) => !hand.split && hand.cards.length === 2 && handTotal(hand.cards).total === 21;

class Blackjack extends BaseTable {
  constructor(opts) {
    super(opts);
    this.game = 'blackjack';
    this.shoe = [];
    this.dealer = [];
  }

  minBet() { return this.settings.bigBlind; }

  isPlaying() { return this.stage === 'betting' || this.stage === 'playing'; }

  canStart() {
    return !this.isPlaying() && this.seats.some((s) => s && !s.sitOut && s.chips >= this.minBet());
  }

  draw() {
    if (this.shoe.length < 60) {
      this.shoe = [];
      for (let d = 0; d < DECKS; d++) for (const r of RANKS) for (const s of SUITS) this.shoe.push(r + s);
      shuffle(this.shoe);
      this.addLog('The dealer shuffles the shoe');
    }
    return this.shoe.pop();
  }

  startHand() {
    if (!this.canStart()) return false;
    this.handNo++;
    this.results = null;
    this.dealer = [];
    for (const s of this.seats) {
      if (!s) continue;
      s.inHand = !s.sitOut && s.chips >= this.minBet();
      s.startChips = s.chips;
      s.hands = [];
      s.handIdx = 0;
      s.bet = 0;
      s.lastAction = null;
    }
    this.stage = 'betting';
    this.addLog(`— Hand #${this.handNo}: Blackjack —`);
    this.toAct = this.nextSeat(-1, (s) => s.inHand);
    return true;
  }

  // Limits for the player to act (used by the client to build buttons).
  limits(i) {
    const s = this.seats[i];
    if (this.stage === 'betting') return { phase: 'bet', minBet: this.minBet(), maxBet: s.chips };
    const h = s.hands[s.handIdx];
    if (!h) return null;
    const firstTwo = h.cards.length === 2 && !h.doubled;
    const canSplit = s.hands.length === 1 && h.cards.length === 2 && cardValue(h.cards[0]) === cardValue(h.cards[1]) && s.chips >= h.bet;
    return { phase: 'play', canDouble: firstTwo && s.chips >= h.bet, canSplit, handIdx: s.handIdx };
  }

  act(id, action, amount) {
    const i = this.seatOf(id);
    if (i === -1 || i !== this.toAct || !this.isPlaying()) return { error: 'Not your turn' };
    const s = this.seats[i];

    if (this.stage === 'betting') {
      if (action !== 'bet') return { error: 'Place your bet first' };
      let amt = Math.floor(Number(amount));
      if (!Number.isFinite(amt)) amt = this.minBet();
      amt = Math.max(this.minBet(), Math.min(s.chips, amt));
      s.bet = amt;
      s.chips -= amt;
      s.lastAction = `Bet ${amt}`;
      this.addLog(`${s.name} bets ${amt}`);
      this.onEvent('chips');
      const next = this.nextSeat(i, (p) => p.inHand && p.bet === 0);
      if (next === -1 || next <= i) this.deal(); else this.toAct = next;
      return { ok: true };
    }

    const h = s.hands[s.handIdx];
    const lim = this.limits(i);
    if (action === 'hit') {
      h.cards.push(this.draw());
      const t = handTotal(h.cards).total;
      s.lastAction = 'Hit';
      this.onEvent('deal');
      if (t > 21) { h.done = true; h.bust = true; s.lastAction = 'Bust'; this.addLog(`${s.name} busts with ${t}`); this.onEvent('fold'); }
      else if (t === 21) h.done = true;
    } else if (action === 'stand') {
      h.done = true;
      s.lastAction = 'Stand';
      this.addLog(`${s.name} stands on ${handTotal(h.cards).total}`);
      this.onEvent('check');
    } else if (action === 'double') {
      if (!lim.canDouble) return { error: 'Cannot double now' };
      s.chips -= h.bet;
      h.bet *= 2;
      h.doubled = true;
      h.cards.push(this.draw());
      h.done = true;
      const t = handTotal(h.cards).total;
      if (t > 21) h.bust = true;
      s.lastAction = 'Double';
      this.addLog(`${s.name} doubles to ${h.bet} and gets ${t}${t > 21 ? ' (bust)' : ''}`);
      this.onEvent('chips');
    } else if (action === 'split') {
      if (!lim.canSplit) return { error: 'Cannot split now' };
      s.chips -= h.bet;
      const [a, b] = h.cards;
      const aces = a[0] === 'A';
      s.hands = [
        { cards: [a, this.draw()], bet: h.bet, split: true, done: aces },
        { cards: [b, this.draw()], bet: h.bet, split: true, done: aces },
      ];
      for (const nh of s.hands) if (handTotal(nh.cards).total === 21) nh.done = true;
      s.lastAction = 'Split';
      this.addLog(`${s.name} splits`);
      this.onEvent('chips');
    } else {
      return { error: 'Unknown action' };
    }
    this.advance();
    return { ok: true };
  }

  deal() {
    const players = this.seats.filter((s) => s && s.inHand);
    for (const s of players) s.hands = [{ cards: [this.draw(), this.draw()], bet: s.bet, done: false }];
    this.dealer = [this.draw(), this.draw()];
    this.stage = 'playing';
    this.onEvent('deal');
    // Dealer peeks: with a blackjack, the hand ends right away.
    if (handTotal(this.dealer).total === 21) {
      this.addLog('Dealer has blackjack!');
      this.settle();
      return;
    }
    for (const s of players) {
      if (isBlackjack(s.hands[0])) { s.hands[0].done = true; s.lastAction = 'Blackjack!'; this.addLog(`${s.name} has blackjack!`); }
    }
    this.toAct = -1;
    this.advance();
  }

  // Move to the next unfinished hand, or let the dealer play.
  advance() {
    const pending = (s) => s.inHand && s.hands.some((h) => !h.done);
    const cur = this.toAct !== -1 ? this.seats[this.toAct] : null;
    if (cur && pending(cur)) { cur.handIdx = cur.hands.findIndex((h) => !h.done); return; }
    const next = this.nextSeat(this.toAct === -1 ? -1 : this.toAct, pending);
    if (next !== -1 && (this.toAct === -1 || next > this.toAct)) {
      this.toAct = next;
      this.seats[next].handIdx = this.seats[next].hands.findIndex((h) => !h.done);
      return;
    }
    this.dealerPlay();
  }

  dealerPlay() {
    this.toAct = -1;
    const live = this.seats.some((s) => s && s.inHand && s.hands.some((h) => !h.bust && !isBlackjack(h)));
    if (live) {
      while (handTotal(this.dealer).total < 17) this.dealer.push(this.draw());
    }
    const d = handTotal(this.dealer).total;
    this.addLog(`Dealer has ${d}${d > 21 ? ' (bust)' : ''}: ${this.dealer.join(' ')}`);
    this.settle();
  }

  settle() {
    const dealerBJ = this.dealer.length === 2 && handTotal(this.dealer).total === 21;
    const d = handTotal(this.dealer).total;
    const winners = [];
    this.seats.forEach((s, i) => {
      if (!s || !s.inHand) return;
      for (const h of s.hands) {
        const p = handTotal(h.cards).total;
        let pay = 0;
        if (h.bust) h.result = 'lose';
        else if (dealerBJ) { h.result = isBlackjack(h) ? 'push' : 'lose'; if (isBlackjack(h)) pay = h.bet; }
        else if (isBlackjack(h)) { h.result = 'blackjack'; pay = h.bet + Math.floor(h.bet * 1.5); }
        else if (d > 21 || p > d) { h.result = 'win'; pay = h.bet * 2; }
        else if (p === d) { h.result = 'push'; pay = h.bet; }
        else h.result = 'lose';
        s.chips += pay;
      }
      const net = s.chips - s.startChips;
      s.lastAction = net > 0 ? `Won ${net}` : net < 0 ? `Lost ${-net}` : 'Push';
      if (net > 0) winners.push({ seat: i, amount: net, hand: s.hands.map((h) => h.result).join(' / ') });
    });
    this.results = { shown: true, winners, dealerTotal: d, dealerBJ };
    this.stage = 'showdown';
    this.toAct = -1;
    this.onEvent('win');
  }

  leave(id) {
    const i = this.seatOf(id);
    if (i === -1) return;
    const wasTurn = this.toAct === i;
    this.seats[i] = null; // their bet stays with the house
    if (!this.isPlaying()) return;
    if (!this.seats.some((s) => s && s.inHand)) { this.stage = 'waiting'; this.toAct = -1; return; }
    if (wasTurn && this.stage === 'betting') {
      const next = this.nextSeat(i, (p) => p.inHand && p.bet === 0);
      if (next === -1 || next < i) this.deal(); else this.toAct = next;
    } else if (wasTurn) {
      this.advance();
    }
  }

  // What a disconnected player does automatically.
  defaultAction(i) {
    return this.stage === 'betting' ? { action: 'bet', amount: this.minBet() } : { action: 'stand' };
  }

  // Simple basic strategy.
  botAction(i) {
    const s = this.seats[i];
    if (this.stage === 'betting') {
      const mult = 1 + Math.floor(Math.random() * 3);
      return { action: 'bet', amount: Math.min(s.chips, this.minBet() * mult) };
    }
    return { action: bestMove(s.hands[s.handIdx].cards, this.dealer[0], this.limits(i)) };
  }

  resultsForRecord() {
    return this.seats.filter((s) => s && s.inHand && s.accountId).map((s) => {
      const net = s.chips - s.startChips;
      return { accountId: s.accountId, mode: 'blackjack', net, won: net > 0, pot: Math.max(0, net) };
    });
  }

  view(viewerId) {
    const v = this.baseView(viewerId);
    const hideHole = this.isPlaying();
    v.variantName = 'Blackjack';
    v.dealer = {
      cards: this.dealer.map((c, k) => (hideHole && k === 1 ? null : c)),
      total: this.dealer.length ? handTotal(hideHole ? this.dealer.slice(0, 1) : this.dealer).total : null,
    };
    v.minBet = this.minBet();
    v.limits = v.mySeat !== -1 && v.mySeat === this.toAct ? this.limits(v.mySeat) : null;
    v.seats = this.seats.map((s) => s && {
      ...this.baseSeatView(s),
      bet: s.bet || 0,
      handIdx: s.handIdx || 0,
      hands: (s.hands || []).map((h) => ({ cards: h.cards, bet: h.bet, total: handTotal(h.cards).total, soft: handTotal(h.cards).soft, bust: !!h.bust, done: !!h.done, result: h.result || null, blackjack: isBlackjack(h) })),
    });
    return v;
  }
}

// Basic strategy (simplified) given the player's cards and the dealer's up card.
function bestMove(cards, upCard, lim) {
  const { total, soft } = handTotal(cards);
  const up = cardValue(upCard);
  const v0 = cardValue(cards[0]);
  if (lim && lim.canSplit) {
    if (v0 === 11 || v0 === 8) return 'split';
    if ([2, 3, 6, 7].includes(v0) && up <= 7) return 'split';
    if (v0 === 9 && up <= 9 && up !== 7) return 'split';
  }
  if (lim && lim.canDouble) {
    if (!soft && (total === 11 || (total === 10 && up <= 9) || (total === 9 && up >= 3 && up <= 6))) return 'double';
    if (soft && total >= 15 && total <= 18 && up >= 4 && up <= 6) return 'double';
  }
  if (soft) {
    if (total >= 19) return 'stand';
    if (total === 18) return up >= 9 ? 'hit' : 'stand';
    return 'hit';
  }
  if (total >= 17) return 'stand';
  if (total >= 13) return up <= 6 ? 'stand' : 'hit';
  if (total === 12) return up >= 4 && up <= 6 ? 'stand' : 'hit';
  return 'hit';
}

module.exports = { Blackjack, handTotal, bestMove, cardValue };
