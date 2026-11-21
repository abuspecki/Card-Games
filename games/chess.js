// Chess for chips, with a doubling cube.
//
// Two players bring chips to the table. A game is played for the table's stake
// (settings.bigBlind) times the cube (1, 2, 4, …). On your turn, before you move,
// you may offer to double: your opponent accepts (the stake doubles, and only they
// may double next) or declines and loses the current stake right away. As in
// backgammon: the cube is "centred" at the start, after a double it belongs to the
// player who took it. A double needs both players to have the doubled stake.
//
// Each player has a clock (settings.minutes). Time out = loss, unless the opponent
// can no longer mate (then a draw). Draws: stalemate, too little material, threefold
// repetition, fifty moves, or agreed. A draw moves no chips.
// Chips change hands only when a game ends, so a game called off by a restart costs
// nobody anything.
const { BaseTable } = require('./base');
const R = require('./chess-rules');

const MAX_CUBE = 64;
const BOT_DEPTH = { tight: 3, normal: 2, wild: 1 };      // bot styles → strength
const BOT_NOISE = { tight: 10, normal: 40, wild: 120 };

class Chess extends BaseTable {
  constructor(opts = {}) {
    super(opts);
    this.game = 'chess';
    this.maxSeats = 2;
    this.seats = new Array(2).fill(null);
    this.settings.minutes = this.settings.minutes || 5;
    this.white = 1;           // seat with the white pieces (alternates every game)
    this.reset();
  }

  stake() { return this.settings.bigBlind; }
  minBet() { return this.stake(); }

  reset() {
    this.pos = null;
    this.moves = [];          // SAN of every move
    this.last = null;         // { from, to } of the last move
    this.keys = [];
    this.cube = 1;
    this.cubeOwner = -1;      // seat that may double next (-1 = either)
    this.offer = null;        // { kind: 'double' | 'draw', from: seat }
    this.clock = [0, 0];      // ms left per seat
    this.turnStart = 0;
    this.captured = { w: [], b: [] };
  }

  isPlaying() { return this.stage === 'playing'; }
  players() { return this.seats.filter((s) => s && !s.sitOut); }
  canStart() { return !this.isPlaying() && this.players().length === 2 && this.players().every((s) => s.chips >= this.stake()); }

  seatOfColor(c) { return c === 'w' ? this.white : 1 - this.white; }
  colorOfSeat(i) { return i === this.white ? 'w' : 'b'; }
  opp(i) { return 1 - i; }

  startHand() {
    if (!this.canStart()) return false;
    this.handNo++;
    this.reset();
    if (this.handNo > 1) this.white = 1 - this.white;
    this.pos = R.start();
    this.keys = [R.key(this.pos)];
    this.clock = [this.settings.minutes * 60000, this.settings.minutes * 60000];
    this.results = null;
    for (const s of this.seats) if (s) { s.inHand = true; s.startChips = s.chips; s.lastAction = null; }
    this.stage = 'playing';
    this.toAct = this.white;
    this.turnStart = Date.now();
    this.addLog(`— Game ${this.handNo}: ${this.seats[this.white].name} (white) v ${this.seats[1 - this.white].name} (black) · stake ${this.stake()} —`);
    this.onEvent('deal');
    return true;
  }

  // The clock of the player to act, now.
  left(i, now = Date.now()) {
    return i === this.toAct && this.isPlaying() ? this.clock[i] - (now - this.turnStart) : this.clock[i];
  }
  // used by the table loop: when the clock of the player to act runs out
  get deadline() { return this.isPlaying() && this.toAct !== -1 ? this.turnStart + this.clock[this.toAct] : 0; }
  tick(now = Date.now()) {
    if (!this.isPlaying() || this.left(this.toAct, now) > 0) return false;
    this.timeout(this.toAct);
    return true;
  }
  timeout(i) {
    this.clock[i] = 0;
    const o = this.opp(i);
    if (!R.canMate(this.pos.b, this.colorOfSeat(o))) this.finish(-1, `${this.seats[i].name} ran out of time — a draw (no mating material)`);
    else this.finish(o, `${this.seats[i].name} ran out of time`);
  }

  // hand the turn to seat j, charging the time used
  passTurn(j, now = Date.now()) {
    this.clock[this.toAct] = Math.max(0, this.clock[this.toAct] - (now - this.turnStart));
    this.toAct = j;
    this.turnStart = now;
  }

  amount() { return this.stake() * this.cube; }
  canDouble(i) {
    if (!this.isPlaying() || this.toAct !== i || this.offer || this.cube >= MAX_CUBE) return false;
    if (this.cubeOwner !== -1 && this.cubeOwner !== i) return false;
    const next = this.stake() * this.cube * 2;
    return this.seats[i].chips >= next && this.seats[this.opp(i)].chips >= next;
  }

  // winner: seat, or -1 for a draw
  finish(winner, reason) {
    let paid = 0;
    if (winner !== -1) {
      const loser = this.seats[this.opp(winner)];
      paid = Math.min(this.amount(), loser.chips);
      loser.chips -= paid;
      this.seats[winner].chips += paid;
    }
    this.results = {
      winners: winner === -1 ? [] : [{ seat: winner, amount: paid, hand: reason }],
      draw: winner === -1, reason, cube: this.cube, stake: this.stake(), shown: true,
    };
    this.addLog(winner === -1 ? `Draw — ${reason}` : `${this.seats[winner].name} wins ${paid} — ${reason}`);
    this.offer = null;
    this.stage = 'showdown';
    this.toAct = -1;
    this.onEvent('win');
  }

  // action: move (amount = 'e2e4' or 'e7e8q') · double · take · drop · draw · accept · decline · resign
  act(id, action, amount) {
    const i = this.seatOf(id);
    if (i === -1 || !this.isPlaying()) return { error: 'Not your turn' };
    const now = Date.now();
    if (action === 'resign') {
      this.clock[this.toAct] = Math.max(0, this.left(this.toAct, now));
      this.finish(this.opp(i), `${this.seats[i].name} resigns`);
      return { ok: true };
    }
    if (i !== this.toAct) return { error: 'Not your turn' };
    if (this.left(i, now) <= 0) { this.timeout(i); return { ok: true }; }
    const s = this.seats[i];
    const o = this.opp(i);

    // answering an offer
    if (this.offer) {
      if (this.offer.kind === 'double') {
        if (action === 'take') {
          this.cube *= 2;
          this.cubeOwner = i;
          s.lastAction = `Takes ×${this.cube}`;
          this.addLog(`${s.name} accepts the double — the game is now for ${this.amount()}`);
          this.offer = null;
          this.passTurn(o, now);
          this.onEvent('chips');
          return { ok: true };
        }
        if (action === 'drop') {
          s.lastAction = 'Declines';
          this.finish(o, `${s.name} declines the double`);
          return { ok: true };
        }
        return { error: 'Accept or decline the double first' };
      }
      if (action === 'accept') { this.finish(-1, 'agreed'); return { ok: true }; }
      if (action === 'decline') {
        s.lastAction = 'No draw';
        this.addLog(`${s.name} declines the draw`);
        this.offer = null;
        this.passTurn(o, now);
        return { ok: true };
      }
      return { error: 'Answer the draw offer first' };
    }

    if (action === 'double') {
      if (!this.canDouble(i)) return { error: this.cubeOwner === o ? 'Only your opponent may double now' : 'You cannot double now' };
      this.offer = { kind: 'double', from: i };
      s.lastAction = `Doubles to ${this.amount() * 2}`;
      this.addLog(`${s.name} offers to double to ${this.amount() * 2}`);
      this.passTurn(o, now);
      this.onEvent('chips');
      return { ok: true };
    }
    if (action === 'draw') {
      if (this.drawOffered === `${this.handNo}:${this.moves.length}:${i}`) return { error: 'You already offered a draw this move' };
      this.drawOffered = `${this.handNo}:${this.moves.length}:${i}`;
      this.offer = { kind: 'draw', from: i };
      s.lastAction = 'Offers a draw';
      this.addLog(`${s.name} offers a draw`);
      this.passTurn(o, now);
      return { ok: true };
    }
    if (action !== 'move') return { error: 'Unknown action' };

    const str = String(amount || '');
    const from = /^[a-h][1-8]/.test(str) ? R.sq(str.slice(0, 2)) : -1;
    const to = /^[a-h][1-8][a-h][1-8]/.test(str) ? R.sq(str.slice(2, 4)) : -1;
    const promo = str[4] || undefined;
    const legal = R.legal(this.pos);
    const m = legal.find((x) => x.from === from && x.to === to && (x.promo || undefined) === (x.promo ? (promo || 'q') : undefined));
    if (!m) return { error: 'That move is not allowed' };
    const notation = R.san(this.pos, m, legal);
    const next = R.play(this.pos, m);
    if (next.captured) this.captured[this.colorOfSeat(i)].push(next.captured);
    this.pos = next;
    this.moves.push(notation);
    this.last = { from: R.nameOf(m.from), to: R.nameOf(m.to) };
    this.keys.push(R.key(next));
    s.lastAction = notation;
    this.passTurn(o, now);
    this.onEvent(next.captured ? 'chips' : 'check');
    // the game ends?
    const replies = R.legal(next);
    if (!replies.length) {
      if (R.inCheck(next)) this.finish(i, `checkmate (${notation})`);
      else this.finish(-1, 'stalemate');
    } else if (R.insufficient(next.b)) this.finish(-1, 'not enough material to mate');
    else if (this.keys.filter((k) => k === this.keys[this.keys.length - 1]).length >= 3) this.finish(-1, 'threefold repetition');
    else if (next.half >= 100) this.finish(-1, 'fifty-move rule');
    return { ok: true };
  }

  // A player gone from the table loses the game (the chips at stake go to the opponent).
  leave(id) {
    const i = this.seatOf(id);
    if (i === -1) return;
    if (this.isPlaying()) this.finish(this.opp(i), `${this.seats[i].name} left the table`);
    this.seats[i] = null;
  }

  // Nothing is played automatically for an idle player: the clock decides.
  defaultAction() { return { action: 'wait' }; }

  resultsForRecord() {
    if (!this.results) return [];
    const won = new Set(this.results.winners.map((w) => w.seat));
    return this.seats.map((s, i) => (s && s.accountId && s.inHand
      ? { accountId: s.accountId, mode: 'chess', net: s.chips - s.startChips, won: won.has(i), pot: won.has(i) ? this.results.winners[0].amount : 0 } : null)).filter(Boolean);
  }
  leaveRecord() { return null; }   // a game left is settled (and recorded) by leave()

  // ----- the computer player -----
  botAction(i) {
    const s = this.seats[i];
    const style = s.botStyle || 'normal';
    const eval0 = () => {
      const sc = R.evaluate(this.pos.b);
      return this.colorOfSeat(i) === 'w' ? sc : -sc;        // centipawns for the bot
    };
    if (this.offer && this.offer.kind === 'double') return { action: eval0() < -500 ? 'drop' : 'take' };
    if (this.offer && this.offer.kind === 'draw') return { action: Math.abs(eval0()) < 80 || eval0() < -300 ? 'accept' : 'decline' };
    if (this.canDouble(i) && eval0() > 450 && Math.random() < 0.5) return { action: 'double' };
    const r = R.bestMove(this.pos, BOT_DEPTH[style] || 2, { noise: BOT_NOISE[style] || 40, budget: 40000 });
    if (!r) return { action: 'resign' };
    return { action: 'move', amount: R.nameOf(r.move.from) + R.nameOf(r.move.to) + (r.move.promo || '') };
  }

  view(viewerId) {
    const v = this.baseView(viewerId);
    const me = v.mySeat;
    const now = Date.now();
    const myTurn = me !== -1 && me === this.toAct && this.isPlaying();
    v.minBet = this.stake();
    v.stake = this.stake();
    v.minutes = this.settings.minutes;
    v.cube = this.cube;
    v.cubeOwner = this.cubeOwner;
    v.amount = this.amount();
    v.white = this.white;
    v.board = this.pos ? this.pos.b : R.start().b;
    v.turn = this.pos ? this.pos.turn : 'w';
    v.check = !!(this.pos && this.isPlaying() && R.inCheck(this.pos));
    v.last = this.last;
    v.moves = this.moves.slice(-200);
    v.captured = this.captured;
    v.offer = this.offer;
    v.clocks = [0, 1].map((k) => Math.max(0, Math.round(this.left(k, now))));
    v.running = this.isPlaying() ? this.toAct : -1;
    v.canDouble = myTurn && !this.offer && this.canDouble(me);
    v.nextAmount = this.amount() * 2;
    // the moves you may play (only to the player to move)
    v.legal = myTurn && !this.offer ? R.legal(this.pos).map((m) => R.nameOf(m.from) + R.nameOf(m.to) + (m.promo || '')) : [];
    v.seats = this.seats.map((s, i) => s && { ...this.baseSeatView(s), botLevel: s.isBot ? ({ tight: 3, normal: 2, wild: 1 })[s.botStyle] || 2 : null, color: this.isPlaying() || this.stage === 'showdown' ? this.colorOfSeat(i) : null });
    return v;
  }
}

module.exports = { Chess, MAX_CUBE };
