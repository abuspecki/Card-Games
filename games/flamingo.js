// Flamingo — a colour-and-number shedding game for 2–6 players (original
// CardGames game in the classic "match the colour or the number" family).
//
// Deck (108 cards): four colours — c(herry), v(iolet), s(un), t(eal) — each
// with one 0, two of 1–9, two Skip (S), two Reverse (R) and two Draw-Two (D);
// plus four Wild (W) and four Wild Draw-Four (F).
// Card codes: colour + rank + copy letter, e.g. 'c7a', 'vSb', 'xWc' (x = wild).
//
// Each player starts with 7 cards. On your turn play a card that matches the
// colour or the rank of the top card (or a wild, naming the next colour), or
// draw one card — which you may play right away if it fits, else pass.
// Skip: next player misses a turn. Reverse: direction flips (with two players
// it acts as a Skip). Draw-Two / Wild Draw-Four: the next player draws 2 / 4
// and misses a turn. The first player to empty their hand wins.
const { BaseTable, shuffle } = require('./base');

const COLORS = ['c', 'v', 's', 't'];
const COLOR_NAMES = { c: 'Cherry', v: 'Violet', s: 'Sun', t: 'Teal' };
const RANK_NAMES = { S: 'Skip', R: 'Reverse', D: 'Draw Two', W: 'Wild', F: 'Wild Draw Four' };
const HAND = 7;
const MAX_PLAYERS = 6;

const colorOf = (c) => c[0];
const rankOf = (c) => c[1];
const isWild = (c) => c[0] === 'x';
const nameOf = (c) => (isWild(c) ? RANK_NAMES[rankOf(c)] : `${COLOR_NAMES[colorOf(c)]} ${RANK_NAMES[rankOf(c)] || rankOf(c)}`);

function buildDeck() {
  const deck = [];
  for (const col of COLORS) {
    deck.push(col + '0a');
    for (const r of '123456789SRD') for (const k of 'ab') deck.push(col + r + k);
  }
  for (const k of 'abcd') { deck.push('xW' + k); deck.push('xF' + k); }
  return deck;
}

class Flamingo extends BaseTable {
  constructor(opts) {
    super(opts);
    this.game = 'flamingo';
    this.maxSeats = MAX_PLAYERS;
    this.seats = new Array(MAX_PLAYERS).fill(null);
    this.deck = [];
    this.discard = [];
    this.color = null;      // colour in force (differs from the top card after a wild)
    this.dir = 1;           // 1 = clockwise, -1 = counter-clockwise
    this.winner = -1;
    this.rng = opts && opts.rng ? opts.rng : null;
  }

  isPlaying() { return this.stage === 'playing'; }
  canStart() { return !this.isPlaying() && this.seats.filter(Boolean).length >= 2; }
  top() { return this.discard[this.discard.length - 1]; }

  shuffleIn(cards) {
    if (this.rng) {
      for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
      return cards;
    }
    return shuffle(cards);
  }

  // Draw n cards for seat i, reshuffling the discard pile into the deck when needed.
  drawFor(i, n) {
    const s = this.seats[i];
    const got = [];
    for (let k = 0; k < n; k++) {
      if (!this.deck.length) {
        const keep = this.discard.pop();
        this.deck = this.shuffleIn(this.discard);
        this.discard = keep ? [keep] : [];
        if (this.deck.length) this.addLog('The discard pile is shuffled into a new deck');
      }
      if (!this.deck.length) break;
      const c = this.deck.pop();
      s.hand.push(c);
      got.push(c);
    }
    return got;
  }

  startHand() {
    if (!this.canStart()) return false;
    this.handNo++;
    this.results = null;
    this.winner = -1;
    this.dir = 1;
    this.deck = this.shuffleIn(buildDeck());
    this.discard = [];
    for (const s of this.seats) {
      if (!s) continue;
      s.inHand = true;
      s.hand = [];
      s.drewCard = null;
      s.lastAction = null;
    }
    for (let k = 0; k < HAND; k++) this.seats.forEach((s, i) => { if (s) this.drawFor(i, 1); });
    // The first card is always a plain number card.
    let first = this.deck.findIndex((c) => !isWild(c) && /[0-9]/.test(rankOf(c)));
    this.discard.push(this.deck.splice(first, 1)[0]);
    this.color = colorOf(this.top());
    this.stage = 'playing';
    this.button = this.nextSeat(this.button, (s) => s.inHand);
    this.toAct = this.nextSeat(this.button, (s) => s.inHand);
    this.addLog(`— Game #${this.handNo}: Flamingo — first card ${nameOf(this.top())}`);
    this.onEvent('deal');
    return true;
  }

  fits(c) {
    if (isWild(c)) return true;
    const t = this.top();
    return colorOf(c) === this.color || (!isWild(t) && rankOf(c) === rankOf(t));
  }

  next(from, steps = 1) {
    let i = from;
    for (let k = 0; k < steps; k++) {
      for (let n = 1; n <= this.maxSeats; n++) {
        const j = (((i + this.dir * n) % this.maxSeats) + this.maxSeats) % this.maxSeats;
        if (this.seats[j] && this.seats[j].inHand) { i = j; break; }
      }
    }
    return i;
  }

  // What seat i may do now.
  moves(i) {
    if (!this.isPlaying() || i !== this.toAct) return null;
    const s = this.seats[i];
    if (s.drewCard) {
      return { cards: this.fits(s.drewCard) ? [s.drewCard] : [], canDraw: false, canPass: true, drew: s.drewCard };
    }
    return { cards: s.hand.filter((c) => this.fits(c)), canDraw: true, canPass: false, drew: null };
  }

  // act(id, 'play', { card, color }) · act(id, 'draw') · act(id, 'pass')
  act(id, action, data) {
    const i = this.seatOf(id);
    if (i === -1 || i !== this.toAct || !this.isPlaying()) return { error: 'Not your turn' };
    const s = this.seats[i];
    const mv = this.moves(i);
    if (action === 'draw') {
      if (!mv.canDraw) return { error: 'You have already drawn' };
      const [c] = this.drawFor(i, 1);
      s.lastAction = 'Draws';
      this.addLog(`${s.name} draws a card`);
      this.onEvent('deal');
      if (!c) return this.endTurn(i); // nothing left to draw
      s.drewCard = c;
      if (!this.fits(c)) return this.endTurn(i, 'Draws and passes');
      return { ok: true };
    }
    if (action === 'pass') {
      if (!mv.canPass) return { error: 'Play a card or draw first' };
      return this.endTurn(i, 'Passes');
    }
    if (action !== 'play') return { error: 'Unknown action' };
    const d = data && typeof data === 'object' ? data : { card: data };
    const card = String(d.card || '');
    if (!s.hand.includes(card)) return { error: 'You do not hold that card' };
    if (!mv.cards.includes(card)) return { error: 'That card does not fit — match the colour or the number' };
    let chosen = null;
    if (isWild(card)) {
      chosen = String(d.color || '');
      if (!COLORS.includes(chosen)) return { error: 'Choose a colour for your wild card' };
    }
    s.hand.splice(s.hand.indexOf(card), 1);
    s.drewCard = null;
    this.discard.push(card);
    this.color = chosen || colorOf(card);
    s.lastAction = isWild(card) ? `${RANK_NAMES[rankOf(card)]} → ${COLOR_NAMES[this.color]}` : nameOf(card);
    this.addLog(`${s.name} plays ${nameOf(card)}${chosen ? ` and picks ${COLOR_NAMES[chosen]}` : ''}`);
    this.onEvent('check');
    if (!s.hand.length) return this.endGame(i);
    if (s.hand.length === 1) { s.lastAction = 'Last card!'; this.addLog(`${s.name}: last card!`); }

    const r = rankOf(card);
    const players = this.seats.filter((p) => p && p.inHand).length;
    if (r === 'R') {
      this.dir = -this.dir;
      if (players === 2) { this.toAct = i; return { ok: true }; } // acts as a skip
      this.toAct = this.next(i);
      return { ok: true };
    }
    if (r === 'S') { const victim = this.next(i); this.seats[victim].lastAction = 'Skipped'; this.toAct = this.next(i, 2); return { ok: true }; }
    if (r === 'D' || r === 'F') {
      const victim = this.next(i);
      const n = r === 'D' ? 2 : 4;
      this.drawFor(victim, n);
      this.seats[victim].lastAction = `+${n} and skipped`;
      this.addLog(`${this.seats[victim].name} draws ${n} and misses a turn`);
      this.toAct = this.next(i, 2);
      return { ok: true };
    }
    this.toAct = this.next(i);
    return { ok: true };
  }

  endTurn(i, note) {
    const s = this.seats[i];
    s.drewCard = null;
    if (note) s.lastAction = note;
    this.toAct = this.next(i);
    return { ok: true };
  }

  endGame(winner) {
    this.stage = 'showdown';
    this.toAct = -1;
    this.winner = winner;
    const s = this.seats[winner];
    s.lastAction = '🦩 Flamingo!';
    this.results = { shown: true, winners: [{ seat: winner, amount: 0, hand: 'first out' }], winner };
    this.addLog(`${s.name} is out of cards and wins!`);
    this.onEvent('win');
    return { ok: true };
  }

  leave(id) {
    const i = this.seatOf(id);
    if (i === -1) return;
    const s = this.seats[i];
    if (this.isPlaying() && s.inHand) {
      this.addLog(`${s.name} left the game`);
      this.deck.unshift(...(s.hand || []));
      const wasTurn = this.toAct === i;
      const nextSeat = this.next(i);
      s.inHand = false;
      this.seats[i] = null;
      const left = this.seats.map((p, k) => (p && p.inHand ? k : -1)).filter((k) => k !== -1);
      if (left.length === 1) return this.endGame(left[0]);
      if (!left.length) { this.stage = 'waiting'; this.toAct = -1; return; }
      if (wasTurn) this.toAct = nextSeat !== i ? nextSeat : left[0];
      return;
    }
    this.seats[i] = null;
  }

  // Most cards of one colour in a hand (for picking a wild's colour).
  bestColor(hand) {
    const n = { c: 0, v: 0, s: 0, t: 0 };
    for (const c of hand) if (!isWild(c)) n[colorOf(c)]++;
    return COLORS.slice().sort((a, b) => n[b] - n[a])[0];
  }

  botAction(i) {
    const s = this.seats[i];
    const mv = this.moves(i);
    if (!mv) return { action: 'pass' };
    if (mv.cards.length) {
      const nextCount = this.seats[this.next(i)].hand.length;
      const score = (c) => {
        const r = rankOf(c);
        if (r === 'F') return nextCount <= 2 ? 0 : 9;           // save the big wild unless it stops a winner
        if (r === 'W') return 8;
        if ('SDR'.includes(r)) return nextCount <= 2 ? 1 : 4;
        return 5 - Number(r) / 10;                               // shed high numbers first
      };
      const card = mv.cards.slice().sort((a, b) => score(a) - score(b))[0];
      return { action: 'play', amount: { card, color: isWild(card) ? this.bestColor(s.hand.filter((c) => c !== card)) : undefined } };
    }
    return mv.canDraw ? { action: 'draw' } : { action: 'pass' };
  }

  defaultAction(i) { return this.botAction(i); }

  resultsForRecord() {
    if (!this.results) return [];
    return this.seats.filter((s) => s && s.inHand && s.accountId).map((s) => {
      const won = this.seats.indexOf(s) === this.winner;
      return { accountId: s.accountId, mode: 'flamingo', net: won ? 1 : 0, won, pot: 0 };
    });
  }

  view(viewerId) {
    const v = this.baseView(viewerId);
    v.variantName = 'Flamingo';
    v.top = this.top() || null;
    v.color = this.isPlaying() || this.stage === 'showdown' ? this.color : null;
    v.dir = this.dir;
    v.deckCount = this.deck.length;
    v.winner = this.stage === 'showdown' ? this.winner : null;
    v.moves = v.mySeat !== -1 ? this.moves(v.mySeat) : null;
    v.limits = v.moves;
    const order = (c) => (isWild(c) ? 50 + 'WF'.indexOf(rankOf(c)) : COLORS.indexOf(colorOf(c)) * 12 + '0123456789SRD'.indexOf(rankOf(c)));
    v.seats = this.seats.map((s, i) => s && {
      ...this.baseSeatView(s),
      cardCount: (s.hand || []).length,
      hole: i === v.mySeat ? (s.hand || []).slice().sort((a, b) => order(a) - order(b)) : null,
    });
    return v;
  }
}

module.exports = { Flamingo, buildDeck, COLORS, COLOR_NAMES, nameOf, isWild };
