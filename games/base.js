// Shared table plumbing for every game: seats, game log, chat.
const RANKS = '23456789TJQKA';
const SUITS = 'shdc';

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class BaseTable {
  constructor(opts = {}) {
    this.maxSeats = 8;
    this.seats = new Array(this.maxSeats).fill(null);
    this.settings = { startingStack: 1000, smallBlind: 5, bigBlind: 10, showOdds: true, ...opts };
    this.button = -1;
    this.handNo = 0;
    this.stage = 'waiting';
    this.toAct = -1;
    this.results = null;
    this.log = [];
    this.chat = [];
    this.chatSeq = 0;
    this.onEvent = () => {};
  }

  newSeat(player) {
    return {
      id: player.id, name: player.name, chips: player.chips ?? this.settings.startingStack,
      isBot: !!player.isBot, botStyle: player.botStyle, accountId: player.accountId || null,
      connected: player.connected ?? true, inHand: false, startChips: 0, lastAction: null,
    };
  }

  sit(player) {
    const idx = this.seats.findIndex((s) => s === null);
    if (idx === -1) return -1;
    this.seats[idx] = this.newSeat(player);
    return idx;
  }

  sitAt(idx, player) { this.seats[idx] = this.newSeat(player); }

  seatOf(id) { return this.seats.findIndex((s) => s && s.id === id); }

  nextSeat(from, pred) {
    for (let k = 1; k <= this.maxSeats; k++) {
      const i = (((from + k) % this.maxSeats) + this.maxSeats) % this.maxSeats;
      if (this.seats[i] && pred(this.seats[i], i)) return i;
    }
    return -1;
  }

  addLog(msg) {
    this.log.push(msg);
    if (this.log.length > 60) this.log.shift();
  }

  addChat(seat, from, text) {
    this.chatSeq++;
    this.chat.push({ id: this.chatSeq, seat, from, text: String(text).slice(0, 200), at: Date.now() });
    if (this.chat.length > 50) this.chat.shift();
  }

  // Fields every game's view shares.
  baseView(viewerId) {
    const me = this.seatOf(viewerId);
    return {
      game: this.game,
      stage: this.stage,
      settings: this.settings,
      handNo: this.handNo,
      button: this.button,
      toAct: this.toAct,
      mySeat: me,
      results: this.results,
      log: this.log.slice(-40),
      chat: this.chat.slice(-50),
    };
  }

  baseSeatView(s) {
    return {
      name: s.name, chips: s.chips, isBot: s.isBot, connected: s.connected, inHand: s.inHand,
      lastAction: s.lastAction, hasAccount: !!s.accountId, folded: false, allIn: false, bet: 0,
    };
  }
}

module.exports = { BaseTable, RANKS, SUITS, shuffle };
