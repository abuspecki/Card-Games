// Five Card Draw: every player gets five cards, there is a betting round, then
// each player may swap up to three cards (four when keeping an ace), then a
// second betting round and the showdown. No-limit betting with blinds, the same
// betting rules as Hold'em (it reuses the Hold'em engine).
const { Table, eval5, newDeck, CATEGORY_NAMES } = require('../poker');

const MAX_DRAW = 3;          // cards you may swap …
const MAX_DRAW_ACE = 4;      // … or four when the card you keep is an ace

class Draw extends Table {
  constructor(opts = {}) {
    super({ ...opts, variant: 'holdem', rotate: false });
    this.game = 'draw';
    this.usesBoard = false;
    this.maxSeats = 8;
  }

  isPlaying() { return ['bet1', 'draw', 'bet2'].includes(this.stage); }

  startHand() {
    if (!this.canStart()) return false;
    this.handNo++;
    this.resetHand();
    this.deck = newDeck();
    this.discards = [];
    for (const s of this.seats) {
      if (!s) continue;
      Object.assign(s, { hole: [], bet: 0, totalBet: 0, acted: false, allIn: false, drawn: null });
      s.inHand = s.chips > 0 && !s.sitOut;
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
    this.addLog(`— Hand #${this.handNo}: Five Card Draw —`);
    this.postBlind(sb, this.settings.smallBlind, 'SB');
    this.postBlind(bb, this.settings.bigBlind, 'BB');
    this.currentBet = this.settings.bigBlind;
    this.minRaise = this.settings.bigBlind;
    for (let r = 0; r < 5; r++) {
      for (let k = 1; k <= this.maxSeats; k++) {
        const s = this.seats[(this.button + k) % this.maxSeats];
        if (s && s.inHand) s.hole.push(this.deck.pop());
      }
    }
    this.stage = 'bet1';
    this.onEvent('deal');
    this.toAct = bb;
    this.afterAction();
    return true;
  }

  // a card from the deck; the discards are shuffled back in if it runs out
  drawCard() {
    if (!this.deck.length) {
      this.deck = this.discards.splice(0);
      for (let i = this.deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]]; }
    }
    return this.deck.pop();
  }

  live(s) { return s && s.inHand && !s.folded; }

  afterAction() {
    while (this.isPlaying()) {
      if (this.stage === 'draw') {
        if (!this.seats.some((s) => this.live(s) && s.drawn === null)) { this.startSecondRound(); continue; }
        const from = this.toAct === -1 ? this.button : this.toAct;
        this.toAct = this.nextSeat(from, (s) => this.live(s) && s.drawn === null);
        return;
      }
      const actors = this.seats.filter((s) => this.canAct(s));
      const needs = actors.filter((s) => !s.acted || s.bet !== this.currentBet);
      const nobodyToBetAgainst = actors.length <= 1 && actors.every((s) => s.bet >= this.currentBet);
      if (needs.length === 0 || nobodyToBetAgainst) {
        if (this.stage === 'bet2') { this.showdown(); return; }
        this.startDraw();
        continue;
      }
      const from = this.toAct === -1 ? this.button : this.toAct;
      this.toAct = this.nextSeat(from, (s) => needs.includes(s));
      return;
    }
  }

  resetBets() {
    for (const s of this.seats) if (s) { s.bet = 0; s.acted = false; if (!s.folded && !s.allIn) s.lastAction = null; }
    this.currentBet = 0;
    this.toAct = -1;
    this.minRaise = this.settings.bigBlind;
  }

  startDraw() {
    this.resetBets();
    this.stage = 'draw';
    this.addLog('The draw');
    this.onEvent('street');
  }

  startSecondRound() {
    this.resetBets();
    for (const s of this.seats) if (s && this.live(s) && !s.allIn) s.lastAction = null;
    this.stage = 'bet2';
    this.addLog('Second betting round');
    this.onEvent('street');
  }

  // The cards a player may swap: up to 3, or 4 when the card kept is an ace.
  maxDraw(s, idx) {
    const kept = s.hole.filter((_, k) => !idx.includes(k));
    return kept.some((c) => c[0] === 'A') ? MAX_DRAW_ACE : MAX_DRAW;
  }

  act(id, action, amount) {
    if (this.stage === 'draw' && action !== 'fold') {
      const i = this.seatOf(id);
      if (i === -1 || i !== this.toAct) return { error: 'Not your turn' };
      if (action !== 'draw') return { error: 'Choose the cards to swap (or none)' };
      const s = this.seats[i];
      const idx = Array.isArray(amount) ? [...new Set(amount.map(Number))].filter((k) => Number.isInteger(k) && k >= 0 && k < 5) : [];
      if (idx.length > this.maxDraw(s, idx)) return { error: idx.length === 4 ? 'You may swap four cards only when you keep an ace' : `You may swap up to ${MAX_DRAW} cards` };
      for (const k of idx) { this.discards.push(s.hole[k]); s.hole[k] = this.drawCard(); }
      s.drawn = idx.length;
      s.lastAction = idx.length ? `Draws ${idx.length}` : 'Stands pat';
      this.addLog(`${s.name} ${idx.length ? `draws ${idx.length}` : 'stands pat'}`);
      this.onEvent('deal');
      this.toAct = i;
      this.afterAction();
      return { ok: true };
    }
    if (action === 'draw') return { error: 'Not the time to draw' };
    return super.act(id, action, amount);
  }

  defaultAction(i) {
    if (this.stage === 'draw') return { action: 'draw', amount: [] };
    return super.defaultAction(i);
  }

  handOf(s) { return { ...eval5(s.hole), cards: s.hole.slice() }; }

  resultsForRecord() { return super.resultsForRecord().map((r) => ({ ...r, mode: 'draw' })); }
  leaveRecord(i) { const r = super.leaveRecord(i); return r ? { ...r, mode: 'draw' } : null; }

  // ----- computer players -----
  // Strength of five cards: 0 (nothing) … 1 (a monster).
  strength(hole) {
    const e = eval5(hole);
    const top = Math.max(...hole.map((c) => '23456789TJQKA'.indexOf(c[0]) + 2));
    if (e.cat === 0) return 0.05 + (top / 14) * 0.12;
    if (e.cat === 1) return 0.3 + (pairRank(hole) / 14) * 0.18;
    return [0, 0, 0.62, 0.74, 0.82, 0.86, 0.92, 0.97, 0.99][e.cat];
  }

  // What a bot swaps: keep made hands and pairs, draw to four-card flushes and
  // straights, otherwise keep the two highest cards.
  botDiscards(hole) {
    const e = eval5(hole);
    const rv = (c) => '23456789TJQKA'.indexOf(c[0]) + 2;
    if ([4, 5, 6, 8].includes(e.cat)) return [];       // straight, flush, full house, straight flush: stand pat
    const counts = {};
    hole.forEach((c) => { counts[c[0]] = (counts[c[0]] || 0) + 1; });
    if (e.cat >= 1) return hole.map((c, k) => (counts[c[0]] >= 2 ? -1 : k)).filter((k) => k >= 0).slice(0, 3);
    // four to a flush
    const suits = {};
    hole.forEach((c) => { suits[c[1]] = (suits[c[1]] || 0) + 1; });
    const fs = Object.keys(suits).find((x) => suits[x] === 4);
    if (fs) return [hole.findIndex((c) => c[1] !== fs)];
    // four to an open straight
    const sorted = hole.map((c, k) => [rv(c), k]).sort((a, b) => a[0] - b[0]);
    for (const drop of [0, 4]) {
      const rest = sorted.filter((_, j) => j !== drop).map((x) => x[0]);
      if (new Set(rest).size === 4 && rest[3] - rest[0] === 3) return [sorted[drop][1]];
    }
    const keep = sorted.slice(-2).map((x) => x[1]);
    return hole.map((_, k) => k).filter((k) => !keep.includes(k));
  }

  botAction(i) {
    const s = this.seats[i];
    if (this.stage === 'draw') return { action: 'draw', amount: this.botDiscards(s.hole) };
    const lim = this.limits(i);
    const pot = this.pot();
    let str = this.strength(s.hole);
    if (this.stage === 'bet1' && str < 0.3) str += 0.08;           // hope from the draw
    const style = { tight: 0.85, normal: 1, wild: 1.25 }[s.botStyle] || 1;
    const r = Math.random();
    const key = `${this.handNo}:${this.stage}`;
    if (s.botStreet !== key) { s.botStreet = key; s.botRaises = 0; }
    const canRaise = lim.canRaise && s.chips > lim.toCall && s.botRaises < 2;
    if (canRaise && (str > 0.8 || (str > 0.6 && r < 0.45 * style) || (lim.toCall === 0 && r < 0.06 * style))) {
      s.botRaises++;
      const to = Math.round(Math.max(lim.minTo, Math.min(lim.maxTo, this.currentBet + (0.5 + Math.random() * 0.5) * (pot + lim.toCall))));
      return { action: 'raise', amount: to };
    }
    if (lim.toCall === 0) return { action: 'check' };
    const potOdds = lim.toCall / (pot + lim.toCall || 1);
    if (str * style > potOdds * 1.4 || (lim.toCall <= this.settings.bigBlind && str > 0.15)) return { action: 'call' };
    return { action: 'fold' };
  }

  view(viewerId) {
    const v = super.view(viewerId);
    const me = this.seatOf(viewerId);
    const showAll = this.stage === 'showdown' && this.results && this.results.shown;
    v.game = 'draw';
    v.variantName = 'Five Card Draw';
    v.board = [];
    v.runout = [];
    v.drawTurn = this.stage === 'draw' && me !== -1 && me === this.toAct;
    if (this.stage === 'draw') v.limits = null;
    v.maxDraw = MAX_DRAW;
    v.seats = v.seats.map((x, i) => {
      if (!x) return x;
      const s = this.seats[i];
      const visible = i === me || (showAll && s.inHand && !s.folded);
      return { ...x, drawn: s.drawn ?? null, handName: visible && s.inHand && !s.folded && s.hole.length === 5 ? eval5(s.hole).name : null };
    });
    return v;
  }
}

function pairRank(hole) {
  const counts = {};
  hole.forEach((c) => { counts[c[0]] = (counts[c[0]] || 0) + 1; });
  const r = Object.keys(counts).find((x) => counts[x] === 2);
  return r ? '23456789TJQKA'.indexOf(r) + 2 : 0;
}

module.exports = { Draw, MAX_DRAW, MAX_DRAW_ACE, CATEGORY_NAMES };
