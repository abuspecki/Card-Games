// The lobby's permanent tables: seats, bots, timers, and moving chips between
// a player's bankroll and the table (buy-in on sit-down, cash-out on leaving).
const crypto = require('crypto');
const { Table } = require('./poker');
const bots = require('./bots');
const { Blackjack } = require('./games/blackjack');
const { Durak } = require('./games/durak');
const { Roulette } = require('./games/roulette');
const { Flamingo } = require('./games/flamingo');
const { rewardFor, dayString, GESTURE_COOLDOWN } = require('./coins');

const GAMES = {
  holdem: { name: "Texas Hold'em", make: (settings) => new Table({ ...settings, variant: 'holdem', rotate: false }) },
  blackjack: { name: 'Blackjack', make: (settings) => new Blackjack(settings) },
  durak: { name: 'Durak', make: (settings) => new Durak(settings) },
  roulette: { name: 'Roulette', make: (settings) => new Roulette(settings) },
  flamingo: { name: 'Flamingo', make: (settings) => new Flamingo(settings) },
};

// Two tables per game. `buyIn` is the stack you bring (from your bankroll if
// you have an account); `minBuyIn` is the least you may sit down with.
const TABLES = [
  { id: 'HOLDEM-1', name: "Hold'em · Table 1", game: 'holdem', capacity: 8, buyIn: 1000, minBuyIn: 200, settings: { smallBlind: 5, bigBlind: 10 } },
  { id: 'HOLDEM-2', name: "Hold'em · High Roller", game: 'holdem', capacity: 8, highRoller: true, buyIn: 5000, minBuyIn: 2500, settings: { smallBlind: 25, bigBlind: 50 } },
  // The big one: 500 / 1,000 blinds. Buy-in 20,000 (20 big blinds), at least 10,000.
  { id: 'HOLDEM-3', name: "Hold'em · Diamond Room", game: 'holdem', capacity: 8, highRoller: true, buyIn: 20000, minBuyIn: 10000, settings: { smallBlind: 500, bigBlind: 1000 } },
  { id: 'BLACKJACK-1', name: 'Blackjack · Table 1', game: 'blackjack', capacity: 7, buyIn: 1000, minBuyIn: 100, settings: { bigBlind: 10 } },
  { id: 'BLACKJACK-2', name: 'Blackjack · High Roller', game: 'blackjack', capacity: 7, highRoller: true, buyIn: 5000, minBuyIn: 1000, settings: { bigBlind: 50 } },
  { id: 'DURAK-1', name: 'Durak · Table 1', game: 'durak', capacity: 6 },
  { id: 'DURAK-2', name: 'Durak · High Roller', game: 'durak', capacity: 6, highRoller: true, minBankroll: 10000 },
  { id: 'ROULETTE-1', name: 'Roulette · Table 1', game: 'roulette', capacity: 8, buyIn: 1000, minBuyIn: 100, settings: { bigBlind: 5 } },
  { id: 'TOURNEY-1', name: "Hold'em · Sit & Go", game: 'holdem', capacity: 6, accountsOnly: true, tourney: { entry: 500, stack: 1500, handsPerLevel: 6 }, settings: { smallBlind: 10, bigBlind: 20 }, buyIn: 1500 },
  { id: 'FLAMINGO-1', name: 'Flamingo · Table 1', game: 'flamingo', capacity: 6 },
  { id: 'ROULETTE-2', name: 'Roulette · High Roller', game: 'roulette', capacity: 8, highRoller: true, buyIn: 5000, minBuyIn: 1000, settings: { bigBlind: 25 } },
];

const NEXT_HAND_DELAY = 6000;
const DISCONNECTED_TURN_TIMEOUT = 4000;
const TURN_TIMEOUT = Number(process.env.TURN_TIMEOUT_MS) || 40000;            // a seated player who does nothing this long gets a safe default move
const BOT_THINK_MS = [700, 1800];
const AUTO_START_DELAY = 3000;          // deal this long after enough players sit down
const AWAY_LIMIT = Number(process.env.AWAY_LIMIT_MS) || 90 * 1000; // disconnected players lose their seat after this (also mid-game)
const SITOUT_LIMIT = 15 * 60 * 1000; // sitting out longer than this frees the seat (and returns the chips)

function createLobby(ctx) {
  // ctx: { store(), coins(), log }
  const rooms = new Map();

  function makeRoom(def) {
    const settings = { ...(def.settings || {}), startingStack: def.buyIn || 1000 };
    const room = { ...def, code: def.id, table: GAMES[def.game].make(settings), clients: new Map(), watchers: new Map(), nextTimer: null, turnTimer: null, startTimer: null, phaseTimer: null };
    if (def.tourney) room.T = freshTourney();
    wireTable(room);
    rooms.set(def.id, room);
    return room;
  }
  for (const def of TABLES) makeRoom(def);

  // ----- private tables: a member opens one, friends join with its code -----
  const PRIVATE = {
    holdem: { capacity: 8, buyIn: 1000, minBuyIn: 200, settings: { smallBlind: 5, bigBlind: 10 }, label: "Hold'em" },
    blackjack: { capacity: 7, buyIn: 1000, minBuyIn: 100, settings: { bigBlind: 10 }, label: 'Blackjack' },
    roulette: { capacity: 8, buyIn: 1000, minBuyIn: 100, settings: { bigBlind: 5 }, label: 'Roulette' },
    durak: { capacity: 6, label: 'Durak' },
    flamingo: { capacity: 6, label: 'Flamingo' },
  };
  // Stakes the owner of a private table may choose (blind / minimum bet), and the
  // buy-in as a multiple of it. Validated here, whatever the browser sends.
  const PRIVATE_STAKES = {
    holdem: { stakes: [10, 20, 50, 100, 200, 500, 1000, 2000, 5000], buyIns: [20, 50, 100, 200], minBuyIn: 10 },
    blackjack: { stakes: [5, 10, 25, 50, 100, 250, 500, 1000], buyIns: [20, 50, 100, 200], minBuyIn: 5 },
    roulette: { stakes: [5, 10, 25, 50, 100, 250, 500], buyIns: [20, 50, 100, 200], minBuyIn: 5 },
  };
  function privateStakes(game, opts) {
    const P = PRIVATE[game];
    const R = PRIVATE_STAKES[game];
    if (!R) return { settings: P.settings, buyIn: P.buyIn, minBuyIn: P.minBuyIn };
    const stake = opts.stake === undefined ? P.settings.bigBlind : Number(opts.stake);
    const times = opts.buyIn === undefined ? P.buyIn / P.settings.bigBlind : Number(opts.buyIn) / stake;
    if (!R.stakes.includes(stake)) return { error: 'Pick blinds from the list' };
    if (!R.buyIns.includes(times)) return { error: 'Pick a buy-in from the list' };
    const settings = game === 'holdem' ? { smallBlind: stake / 2, bigBlind: stake } : { bigBlind: stake };
    return { settings, buyIn: stake * times, minBuyIn: stake * R.minBuyIn };
  }
  const PRIVATE_MAX = 30;
  const PRIVATE_IDLE = 10 * 60 * 1000;   // an empty private table closes after this
  const codeChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function createPrivate(userId, username, game, opts = {}) {
    const P = PRIVATE[game];
    if (!P) return { error: 'Pick a game' };
    const st = privateStakes(game, opts);
    if (st.error) return st;
    // one private table per member: reuse it (same game and stakes), else replace it while it is empty
    for (const r of rooms.values()) if (r.private && r.ownerId === userId) {
      const stake = (st.settings && st.settings.bigBlind) || null;
      const same = r.game === game && r.buyIn === st.buyIn && r.stake === stake;
      if (same) return { ok: true, id: r.id, reused: true };
      if (r.table.seats.some((s) => s && !s.isBot)) return { error: `You already have a private ${PRIVATE[r.game].label} table (${r.id}) — close it first by leaving it` };
      closeRoom(r);
    }
    if ([...rooms.values()].filter((r) => r.private).length >= PRIVATE_MAX) return { error: 'All private tables are taken right now — try again later' };
    let id;
    do { id = 'P-' + Array.from({ length: 5 }, () => codeChars[crypto.randomInt(codeChars.length)]).join(''); } while (rooms.has(id));
    const room = makeRoom({ id, name: `${P.label} · ${username}'s table`, game, capacity: P.capacity, buyIn: st.buyIn, minBuyIn: st.minBuyIn, settings: st.settings, stake: (st.settings && st.settings.bigBlind) || null, private: true, ownerId: userId, host: username });
    room.emptySince = Date.now();
    return { ok: true, id: room.id };
  }
  function closeRoom(room) {
    for (const t of ['nextTimer', 'turnTimer', 'startTimer', 'phaseTimer']) clearTimeout(room[t]);
    for (const ws of room.watchers.values()) send(ws, { t: 'left' });
    rooms.delete(room.id);
  }
  // Close private tables that have been empty for a while.
  setInterval(() => {
    for (const room of [...rooms.values()]) {
      if (!room.private) continue;
      const humans = room.table.seats.some((s) => s && !s.isBot);
      if (humans) room.emptySince = null;
      else if (!room.emptySince) room.emptySince = Date.now();
      else if (Date.now() - room.emptySince > PRIVATE_IDLE && !room.table.seats.some((s) => s && s.buyIn > 0)) closeRoom(room);
    }
  }, 30000).unref();

  function wireTable(room) {
    room.table.onEvent = (kind) => {
      broadcast(room, { t: 'sfx', name: kind });
      if (kind === 'win') recordResults(room);
    };
  }

  const usesChips = (room) => room.game !== 'durak' && room.game !== 'flamingo' && !room.tourney;

  // ================= SIT & GO TOURNAMENT =================
  // Members pay an entry (held like table chips), everyone starts with the same
  // tournament chips, blinds rise every few hands, the last player standing
  // wins. Prizes go to the best-placed members: 65 % / 35 % with 4+ members,
  // otherwise winner takes all. Bots may fill seats but pay and win nothing.
  const BLINDS = [[10, 20], [15, 30], [25, 50], [50, 100], [75, 150], [100, 200], [150, 300], [200, 400], [300, 600], [500, 1000]];
  function freshTourney() { return { state: 'open', level: 0, hands: 0, entrants: [], out: [], finishedAt: 0, result: null }; }
  function tourneyInfo(room) {
    if (!room.tourney) return null;
    const T = room.T, cfg = room.tourney;
    const members = T.state === 'open' ? room.table.seats.filter((s) => s && s.accountId).length : T.entrants.filter((e) => e.accountId).length;
    const pool = members * cfg.entry;
    return {
      state: T.state, entry: cfg.entry, stack: cfg.stack, level: T.level + 1, blinds: BLINDS[T.level],
      nextBlinds: BLINDS[Math.min(T.level + 1, BLINDS.length - 1)], handsToNext: cfg.handsPerLevel - (T.hands % cfg.handsPerLevel),
      pool, prizes: members >= 4 ? [Math.floor(pool * 0.65), pool - Math.floor(pool * 0.65)] : [pool],
      players: room.table.seats.filter(Boolean).length, out: T.out.map((o) => o.name), result: T.result,
    };
  }
  function startTourney(room) {
    const T = room.T, t = room.table;
    if (T.state !== 'open') return { error: 'The tournament is already running' };
    if (seatedCount(t) < 2) return { error: 'You need at least 2 players — invite a friend or a bot' };
    if (paused()) return { error: 'An update is coming — the tournament can start after it' };
    T.state = 'running'; T.level = 0; T.hands = 0; T.out = []; T.result = null;
    T.entrants = t.seats.filter(Boolean).map((s) => ({ id: s.id, name: s.name, accountId: s.accountId || null, isBot: !!s.isBot, entry: s.tEntry || 0, settled: false }));
    for (const s of t.seats) if (s) s.chips = room.tourney.stack;
    [t.settings.smallBlind, t.settings.bigBlind] = BLINDS[0];
    t.addLog(`— Sit & Go starts: ${T.entrants.length} players, ${room.tourney.stack} chips each, blinds ${BLINDS[0].join('/')} —`);
    broadcast(room, { t: 'sfx', name: 'deal' });
    if (t.canStart()) t.startHand();
    return { ok: true };
  }
  async function settleEntrant(room, e, prize) {
    if (!e || e.settled || !e.accountId) return;
    e.settled = true;
    try { await ctx.coins().cashOut(e.accountId, prize, e.entry); } catch (err) { console.error('tourney payout', err); }
  }
  // A player is out (busted, or left while it runs).
  async function eliminate(room, seat, why) {
    const T = room.T;
    T.out.unshift({ name: seat.name, accountId: seat.accountId || null, isBot: !!seat.isBot });
    room.table.addLog(`${seat.name} is out${why ? ` (${why})` : ''} — place ${room.T.entrants.length - T.out.length + 1}`);
  }
  async function afterTourneyHand(room) {
    const T = room.T, t = room.table, cfg = room.tourney;
    // busted players leave the table (humans keep watching)
    for (const s of t.seats.slice()) {
      if (s && s.chips <= 0) {
        await eliminate(room, s);
        const ws = room.clients.get(s.id);
        t.leave(s.id);
        if (ws) send(ws, { t: 'notice', msg: `You are out of the tournament — place ${T.entrants.length - T.out.length + 1}. You can keep watching.` });
      }
    }
    T.hands++;
    if (T.hands % cfg.handsPerLevel === 0 && T.level < BLINDS.length - 1) {
      T.level++;
      [t.settings.smallBlind, t.settings.bigBlind] = BLINDS[T.level];
      t.addLog(`Blinds go up: ${BLINDS[T.level].join(' / ')}`);
    }
    const left = t.seats.filter((s) => s && s.chips > 0);
    if (left.length <= 1) await finishTourney(room, left[0]);
  }
  async function finishTourney(room, winnerSeat) {
    const T = room.T, cfg = room.tourney, t = room.table;
    const order = [...(winnerSeat ? [{ name: winnerSeat.name, accountId: winnerSeat.accountId || null, isBot: !!winnerSeat.isBot }] : []), ...T.out];
    const members = T.entrants.filter((e) => e.accountId);
    const pool = members.length * cfg.entry;
    const shares = members.length >= 4 ? [0.65, 0.35] : [1];
    const placedMembers = order.filter((o) => o.accountId);
    const prizes = new Map();
    let paid = 0;
    shares.forEach((sh, k) => { const o = placedMembers[k]; if (!o) return; const amt = k === shares.length - 1 ? pool - paid : Math.floor(pool * sh); prizes.set(o.accountId, amt); paid += amt; });
    for (const e of members) {
      const prize = prizes.get(e.accountId) || 0;
      await settleEntrant(room, e, prize);
      ctx.store().recordHand(e.accountId, 'tourney', prize - e.entry, prize > e.entry, prize).catch((err) => console.error('record', err));
      if (prize > e.entry) ctx.coins().adjust(e.accountId, prize === Math.max(...prizes.values()) ? 100 : 50, 0, 'tourney').catch(() => {});
    }
    T.result = { order: order.map((o, i) => ({ place: i + 1, name: o.name, bot: o.isBot, prize: o.accountId ? prizes.get(o.accountId) || 0 : 0 })) };
    T.state = 'done';
    T.finishedAt = Date.now();
    t.stage = 'waiting';
    t.addLog(`🏆 ${order[0] ? order[0].name : 'Nobody'} wins the Sit & Go!`);
    broadcast(room, { t: 'notice', msg: `🏆 ${order[0] ? order[0].name : 'Nobody'} wins the Sit & Go!${prizes.size ? ' Prizes are in the winners\' accounts.' : ''}` });
    broadcast(room, { t: 'sfx', name: 'win' });
    // a fresh tournament opens in a moment; everyone left at the table is unseated
    setTimeout(() => {
      for (const s of t.seats.slice()) if (s) t.leave(s.id);
      [t.settings.smallBlind, t.settings.bigBlind] = BLINDS[0];
      room.T = freshTourney();
      for (const ws of room.clients.values()) send(ws, { t: 'left' });
      room.clients.clear();
      pushState(room);
    }, 20000);
  }
  const seatedCount = (t) => t.seats.filter(Boolean).length;

  function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
  function broadcast(room, msg) { for (const ws of [...room.clients.values(), ...room.watchers.values()]) send(ws, msg); }

  // What the lobby shows for each table.
  function tableSummary(room) {
    const seats = room.table.seats.filter(Boolean);
    const s = room.table.settings;
    return {
      id: room.id, name: room.name, game: room.game, capacity: room.capacity,
      humans: seats.filter((x) => !x.isBot).length,
      bots: seats.filter((x) => x.isBot).length,
      players: seats.map((x) => ({ name: x.name, bot: x.isBot, avatar: x.avatar || null })),
      playing: room.table.isPlaying(),
      highRoller: !!room.highRoller,
      private: !!room.private, host: room.host || null,
      accountsOnly: !!room.highRoller,
      buyIn: room.buyIn || 0,
      minBuyIn: room.minBuyIn || 0,
      minBankroll: room.minBankroll || 0,
      tourney: tourneyInfo(room),
      stakes: room.tourney ? `Sit & Go · entry ${room.tourney.entry}` : room.game === 'holdem' ? `Blinds ${s.smallBlind} / ${s.bigBlind}`
        : room.game === 'blackjack' || room.game === 'roulette' ? `Bets from ${s.bigBlind}` : '2–6 players',
    };
  }

  // Every move counts up, so "whose turn" is a new turn even when the same
  // player moves twice in a row (e.g. after a skip with two players).
  function turnInfo(room) {
    const t = room.table;
    if (!t.isPlaying() || t.toAct === -1 || !t.seats[t.toAct]) return null;
    const key = `${t.handNo}:${t.toAct}:${room.moveSeq || 0}`;
    if (!room.turn || room.turn.key !== key) room.turn = { key, seat: t.toAct, endsAt: Date.now() + TURN_TIMEOUT };
    return room.turn;
  }

  function pushState(room) {
    try {
      room.turn = turnInfo(room);
      scheduleTimers(room);
      const t = room.table;
      for (const [pid, ws] of [...room.clients, ...room.watchers]) {
        send(ws, { t: 'state', room: room.code, tableName: room.name, highRoller: !!room.highRoller, usesChips: usesChips(room), state: t.view(pid), watching: room.watchers.has(pid), maintenance: maintenanceInfo(), tourney: tourneyInfo(room), turn: room.turn ? { key: room.turn.key, seat: room.turn.seat, msLeft: Math.max(0, room.turn.endsAt - Date.now()) } : null });
      }
    } catch (e) {
      console.error('pushState error', e);
    }
  }

  // ----- maintenance: an announced update stops new hands at a set time -----
  const maint = { at: 0, draining: false };
  const paused = () => maint.draining || (maint.at && Date.now() >= maint.at);
  function maintenanceInfo() {
    if (!maint.at && !maint.draining) return null;
    return { msLeft: maint.draining ? 0 : Math.max(0, maint.at - Date.now()), paused: paused(), draining: maint.draining };
  }
  function announceAll() {
    for (const room of rooms.values()) pushState(room);
  }
  function setMaintenance(minutes) {
    maint.at = minutes > 0 ? Date.now() + minutes * 60000 : 0;
    clearTimeout(maint.timer);
    // when the time is up, refresh everyone so the "no new hands" notice shows
    if (maint.at) maint.timer = setTimeout(announceAll, maint.at - Date.now() + 50);
    announceAll();
    return maintenanceInfo();
  }
  // Roulette waiting for bets that nobody has placed counts as idle.
  const roomIdle = (r) => !r.table.isPlaying()
    || (r.game === 'roulette' && r.table.stage === 'betting' && !r.table.seats.some((s) => s && !s.isBot && s.bets && s.bets.length));
  const isIdle = () => [...rooms.values()].every(roomIdle);
  const playerCount = () => [...rooms.values()].reduce((a, r) => a + r.table.seats.filter((s) => s && !s.isBot).length, 0);
  // Server shutting down: no new hands; wait (up to maxMs) for running hands to finish.
  async function drain(maxMs) {
    maint.draining = true;
    announceAll();
    const until = Date.now() + maxMs;
    while (!isIdle() && Date.now() < until) await new Promise((r) => setTimeout(r, 250));
    return isIdle();
  }

  function scheduleTimers(room) {
    const t = room.table;
    // Deal automatically once enough players are seated (no host needed).
    if (t.stage === 'waiting' && !room.startTimer && hasHuman(room) && t.canStart() && !paused() && (!room.tourney || room.T.state === 'running')) {
      room.startTimer = setTimeout(() => {
        room.startTimer = null;
        if (t.stage === 'waiting' && hasHuman(room) && !paused()) { rebuyBots(t); if (t.canStart()) t.startHand(); }
        pushState(room);
      }, AUTO_START_DELAY);
    }
    // Auto-deal the next hand after a showdown.
    if (t.stage === 'showdown' && !room.nextTimer) {
      room.nextTimer = setTimeout(async () => {
        room.nextTimer = null;
        if (t.stage !== 'showdown') return;
        await removeAwayPlayers(room);
        if (room.tourney) {
          if (room.T.state === 'running') await afterTourneyHand(room);
          if (room.T.state !== 'running') { t.stage = 'waiting'; pushState(room); return; }
        }
        if (paused()) t.stage = 'waiting';
        else if (hasHuman(room)) { rebuyBots(t); if (t.canStart()) t.startHand(); else t.stage = 'waiting'; }
        else t.stage = 'waiting';
        pushState(room);
      }, t.game === 'durak' || t.game === 'flamingo' ? NEXT_HAND_DELAY + 2000 : NEXT_HAND_DELAY);
    }
    // Games with a clock (roulette): move on when the betting / spinning time is up.
    clearTimeout(room.phaseTimer);
    room.phaseTimer = null;
    if (t.tick && t.isPlaying() && t.deadline) {
      room.phaseTimer = setTimeout(() => {
        room.phaseTimer = null;
        if (t.tick(Date.now())) {
          // update announced: an empty betting round closes instead of reopening
          if (paused() && roomIdle(room) && t.stage === 'betting') { t.stage = 'waiting'; t.deadline = 0; for (const s of t.seats) if (s) s.bets = []; }
          pushState(room);
        }
        else scheduleTimers(room);
      }, Math.max(0, t.deadline - Date.now()) + 30);
    }
    // Bots act after a short "thinking" pause; disconnected humans auto-play safely.
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
    if (t.isPlaying() && t.toAct !== -1) {
      const p = t.seats[t.toAct];
      if (p && p.isBot) {
        const seat = t.toAct;
        const hand = t.handNo;
        const wait = BOT_THINK_MS[0] + Math.random() * (BOT_THINK_MS[1] - BOT_THINK_MS[0]);
        room.turnTimer = setTimeout(() => {
          room.turnTimer = null;
          if (t.toAct !== seat || t.handNo !== hand || !t.isPlaying()) return;
          let d;
          try { d = t.botAction ? t.botAction(seat) : bots.decide(t, seat); } catch (e) { console.error('bot error', e); d = t.defaultAction(seat); }
          const r = t.act(p.id, d.action, d.amount);
          if (r.error) { const f = t.defaultAction(seat); t.act(p.id, f.action, f.amount); }
          room.moveSeq = (room.moveSeq || 0) + 1;
          pushState(room);
        }, wait);
      } else if (p) {
        // Disconnected: play for them soon. Connected but idle: after the turn clock runs out.
        const key = room.turn && room.turn.key;
        const wait = !p.connected ? DISCONNECTED_TURN_TIMEOUT : Math.max(0, (room.turn ? room.turn.endsAt : Date.now() + TURN_TIMEOUT) - Date.now());
        room.turnTimer = setTimeout(() => {
          room.turnTimer = null;
          if (!t.isPlaying() || t.toAct === -1 || (room.turn && room.turn.key !== key)) return;
          const seat = t.seats[t.toAct];
          const d = t.defaultAction(t.toAct);
          const r = t.act(seat.id, d.action, d.amount);
          if (r && r.error && d.action !== 'pass') t.act(seat.id, 'pass');
          if (seat.connected) t.addLog(`${seat.name} ran out of time`);
          room.moveSeq = (room.moveSeq || 0) + 1;
          pushState(room);
        }, wait);
      }
    }
  }

  // Save each account's result, coin reward and the day's activity.
  function recordResults(room) {
    if (room.tourney) return; // tournament chips are not real: only the final result counts
    const t = room.table;
    const store = ctx.store();
    const coins = ctx.coins();
    store.recordActivity(dayString(Date.now()), room.game).catch((e) => console.error('activity error', e));
    for (const r of t.resultsForRecord()) {
      store.recordHand(r.accountId, r.mode, r.net, r.won, r.pot).catch((e) => console.error('record error', e));
      const amount = rewardFor(r);
      if (!amount) continue;
      coins.earn(r.accountId, amount, Date.now(), `win:${r.mode}`).then((res) => {
        const seat = room.table.seats.find((s) => s && s.accountId === r.accountId);
        const ws = seat && room.clients.get(seat.id);
        if (ws) send(ws, { t: 'coins', amount: res.amount, coins: res.coins, capped: !!res.capped, today: res.today, cap: res.cap });
      }).catch((e) => console.error('coin error', e));
    }
  }

  // Return a seat's chips to the owner's bankroll (accounts at chip tables only).
  async function cashOutSeat(room, seat) {
    if (!seat || !seat.accountId || !usesChips(room) || !(seat.buyIn > 0)) return;
    const back = Math.max(0, seat.chips || 0);
    const boughtIn = seat.buyIn;
    seat.buyIn = 0;
    try {
      await ctx.coins().cashOut(seat.accountId, back, boughtIn);
    } catch (e) {
      console.error('cash-out failed (refunded at next start)', e);
    }
  }

  // Remove a seat for any reason, settling stats and chips first.
  async function removeSeat(room, seatId, note) {
    const t = room.table;
    const i = t.seatOf(seatId);
    if (i === -1) return;
    const seat = t.seats[i];
    // Leaving mid-hand still counts. (Durak records it when its game ends.)
    const rec = t.leaveRecord ? t.leaveRecord(i) : null;
    if (rec) {
      ctx.store().recordHand(rec.accountId, rec.mode, rec.net, rec.won, rec.pot).catch((e) => console.error('record error', e));
    }
    const accountId = seat.accountId;
    if (rec) seat.accountId = null; // already recorded; don't count this hand twice
    if (note) t.addLog(note);
    if (room.tourney) {
      const T = room.T;
      if (T.state === 'open' && seat.tEntry && seat.accountId) await ctx.coins().cashOut(seat.accountId, seat.tEntry, seat.tEntry).catch((e) => console.error('refund', e));
      if (T.state === 'running') {
        await eliminate(room, seat, 'left');
        await settleEntrant(room, T.entrants.find((e) => e.id === seatId), 0);
        if (seat.accountId) ctx.store().recordHand(seat.accountId, 'tourney', -(seat.tEntry || 0), false, 0).catch(() => {});
      }
    }
    t.leave(seatId); // may fold/stand for them first
    if (room.tourney && room.T.state === 'running') {
      const left = t.seats.filter((x) => x && x.chips > 0);
      if (left.length <= 1 && !t.isPlaying()) await finishTourney(room, left[0]);
    }
    await cashOutSeat(room, { ...seat, accountId });
    const ws = room.clients.get(seatId);
    room.clients.delete(seatId);
    return ws;
  }

  // Free seats of people disconnected for a while (between hands only),
  // and clear out the bots once no real player is left.
  async function removeAwayPlayers(room) {
    const t = room.table;
    let changed = false;
    for (const s of t.seats.slice()) {
      if (s && !s.isBot && !s.connected && Date.now() - (s.awayAt || 0) > AWAY_LIMIT) {
        await removeSeat(room, s.id, `${s.name} left (disconnected)`);
        changed = true;
      } else if (s && !s.isBot && s.sitOut && !t.isPlaying() && Date.now() - (s.sitOutAt || 0) > SITOUT_LIMIT) {
        await removeSeat(room, s.id, `${s.name} left (sat out for 15 minutes)`);
        changed = true;
      }
    }
    if (!t.isPlaying() && !t.seats.some((s) => s && !s.isBot)) {
      for (const s of t.seats.slice()) if (s && s.isBot) { t.leave(s.id); changed = true; }
      if (changed) t.stage = 'waiting';
    }
    return changed;
  }

  setInterval(async () => {
    for (const room of rooms.values()) {
      try { if (await removeAwayPlayers(room)) pushState(room); } catch (e) { console.error('sweep error', e); }
    }
  }, 20000).unref();

  // Someone real who wants to play (sitting out doesn't count: bots don't play alone).
  function hasHuman(room) { return room.table.seats.some((s) => s && !s.isBot && s.connected && !s.sitOut); }

  function rebuyBots(t) {
    if ([...rooms.values()].some((r) => r.table === t && r.tourney)) return;
    for (const s of t.seats) {
      if (s && s.isBot && s.chips === 0) { s.chips = t.settings.startingStack; t.addLog(`${s.name} rebuys for ${s.chips}`); }
    }
  }

  function addBot(room) {
    const t = room.table;
    const name = bots.pickBotName(t);
    const idx = t.sit({ id: 'bot-' + crypto.randomUUID(), name, isBot: true, botStyle: bots.randomStyle() });
    if (idx === -1) return false;
    t.addLog(`🤖 ${name} sat down`);
    return true;
  }

  function removeBot(room) {
    const t = room.table;
    const botSeats = t.seats.map((s, i) => (s && s.isBot ? i : -1)).filter((i) => i !== -1);
    if (!botSeats.length) return false;
    const idle = botSeats.find((i) => !(t.isPlaying() && t.seats[i].inHand && !t.seats[i].folded));
    const i = idle !== undefined ? idle : botSeats[botSeats.length - 1];
    t.addLog(`🤖 ${t.seats[i].name} left`);
    t.leave(t.seats[i].id);
    return true;
  }

  // Buy chips for an account seat: from the bankroll, with an automatic
  // bankruptcy refill if they have nothing left.
  async function buyChips(room, userId) {
    const coins = ctx.coins();
    const r = await coins.buyIn(userId, room.buyIn, room.minBuyIn);
    if (!r.error) return r;
    const refill = await coins.claimBankrupt(userId);
    if (refill.error) return { error: r.error };
    const retry = await coins.buyIn(userId, room.buyIn, room.minBuyIn);
    return retry.error ? retry : { ...retry, refilled: refill.amount };
  }

  // ----- websocket connection -----
  function handleConnection(ws) {
    let room = null;
    let pid = null;
    let watching = false;   // owners can watch a table without a seat

    ws.on('message', async (raw) => {
      try {
        await handleMessage(raw);
      } catch (e) {
        console.error('message error', e);
        send(ws, { t: 'error', msg: 'Something went wrong — please try again' });
      }
    });

    async function handleMessage(raw) {
      let m;
      try { m = JSON.parse(raw); } catch { return; }

      // Owners only: watch a table without taking a seat (sees what any onlooker would).
      if (m.t === 'watch') {
        let user = null;
        if (m.session) { try { user = await ctx.store().getUserBySession(String(m.session)); } catch (e) { console.error('session lookup', e); } }
        if (!user || !ctx.owners || !ctx.owners.has(user.username.toLowerCase())) return send(ws, { t: 'error', msg: 'Only the owner can watch tables' });
        const target = rooms.get(String(m.room || '').toUpperCase().trim());
        if (!target) return send(ws, { t: 'error', msg: 'That table doesn\'t exist' });
        if (room && watching) room.watchers.delete(pid);
        room = target;
        pid = 'watch-' + crypto.randomUUID();
        watching = true;
        room.watchers.set(pid, ws);
        send(ws, { t: 'watching', room: room.code });
        pushState(room);
        return;
      }

      if (m.t === 'join') {
        if (watching) { room.watchers.delete(pid); watching = false; room = null; pid = null; }
        let user = null;
        if (m.session) {
          try { user = await ctx.store().getUserBySession(String(m.session)); } catch (e) { console.error('session lookup', e); }
        }
        const name = user ? user.username : String(m.name || 'Player').trim().replace(/[<>]/g, '').slice(0, 16) || 'Player';
        const code = String(m.room || '').toUpperCase().trim();
        const target = rooms.get(code);
        if (!target) return send(ws, { t: 'error', msg: 'That table doesn\'t exist — pick one from the lobby' });
        const table = target.table;
        // Rejoin a seat: by saved seat token, or because this account already sits here.
        const accountSeat = user ? table.seats.findIndex((s) => s && s.accountId === user.id) : -1;
        const tokenSeat = m.token ? table.seatOf(String(m.token)) : -1;
        const tokenOk = tokenSeat !== -1 && (!table.seats[tokenSeat].accountId || (user && table.seats[tokenSeat].accountId === user.id));
        if (accountSeat !== -1 || tokenOk) {
          room = target;
          pid = accountSeat !== -1 ? table.seats[accountSeat].id : String(m.token);
          const old = room.clients.get(pid);
          if (old && old !== ws) old.close();
          table.seats[table.seatOf(pid)].connected = true;
          table.seats[table.seatOf(pid)].awayAt = null;
        } else {
          if (target.accountsOnly || target.highRoller) {
            if (!user) return send(ws, { t: 'error', msg: '👑 High roller tables are for members — sign in or create an account' });
          }
          if (target.minBankroll) {
            const bal = await ctx.coins().balances(user.id);
            if (bal.chips < target.minBankroll) {
              return send(ws, { t: 'error', msg: `👑 You need ${target.minBankroll.toLocaleString()} chips in your bankroll for this table (you have ${bal.chips.toLocaleString()})` });
            }
          }
          if (target.tourney && target.T.state !== 'open') return send(ws, { t: 'error', msg: 'This tournament is already running — watch it or join the next one' });
          if (seatedCount(table) >= target.capacity) removeBot(target); // make room for a human
          if (seatedCount(table) >= target.capacity) return send(ws, { t: 'error', msg: 'This table is full — try the other one' });
          // Accounts bring chips from their bankroll; guests get a free table stack.
          let stack = null;
          let entry = 0;
          if (target.tourney) {
            const r = await ctx.coins().buyIn(user.id, target.tourney.entry, target.tourney.entry);
            if (r.error) return send(ws, { t: 'error', msg: `The entry is ${target.tourney.entry} chips — ${r.error}` });
            entry = r.amount;
          }
          if (user && usesChips(target)) {
            const r = await buyChips(target, user.id);
            if (r.error) return send(ws, { t: 'error', msg: r.error });
            stack = r.amount;
            if (r.refilled) send(ws, { t: 'notice', msg: `Your daily top-up: ${r.refilled.toLocaleString()} chips from the house.` });
          }
          const newPid = crypto.randomUUID();
          const look = user ? await ctx.coins().lookOf(user.id).catch(() => ({})) : {};
          if (seatedCount(table) >= target.capacity || table.sit({ id: newPid, name, accountId: user ? user.id : null }) === -1) {
            if (stack) await ctx.coins().cashOut(user.id, stack, stack);
            if (entry) await ctx.coins().cashOut(user.id, entry, entry);
            return send(ws, { t: 'error', msg: 'This table is full — try the other one' });
          }
          const seat = table.seats[table.seatOf(newPid)];
          if (stack !== null) { seat.chips = stack; seat.buyIn = stack; }
          if (entry) seat.tEntry = entry;
          seat.avatar = look.avatar || null;
          seat.badge = look.badge || null;
          seat.skin = look.skin || null;
          room = target;
          pid = newPid;
          table.addLog(`${name} joined`);
        }
        room.clients.set(pid, ws);
        if (user) ws.userId = user.id;
        send(ws, { t: 'joined', room: room.code, token: pid });
        pushState(room);
        return;
      }

      if (!room || !pid) return;
      if (watching) {
        if (m.t === 'leave') { room.watchers.delete(pid); room = null; pid = null; watching = false; send(ws, { t: 'left' }); }
        return; // onlookers cannot act, chat or add bots
      }
      const t = room.table;
      const me = t.seats[t.seatOf(pid)];
      if (!me) {
        // out of a tournament but still watching
        if (m.t === 'leave') { room.clients.delete(pid); room = null; pid = null; send(ws, { t: 'left' }); }
        return;
      }
      if (room.tourney && m.t === 'tstart') {
        const r = startTourney(room);
        if (r.error) send(ws, { t: 'error', msg: r.error });
        pushState(room);
        return;
      }
      if (room.tourney && room.T.state !== 'open' && (m.t === 'addBot' || m.t === 'removeBot')) return send(ws, { t: 'error', msg: 'Bots can only join before the tournament starts' });

      switch (m.t) {
        case 'action': {
          const r = t.act(pid, String(m.action || ''), m.amount);
          if (r.error) send(ws, { t: 'error', msg: r.error });
          else room.moveSeq = (room.moveSeq || 0) + 1;
          break;
        }
        case 'addBot':
          if (seatedCount(t) >= room.capacity || !addBot(room)) return send(ws, { t: 'error', msg: 'The table is full' });
          break;
        case 'removeBot':
          if (!removeBot(room)) return send(ws, { t: 'error', msg: 'No bots at the table' });
          break;
        case 'rebuy': {
          if (!usesChips(room) || me.chips > 0 || (me.inHand && t.isPlaying())) return;
          if (me.accountId) {
            const r = await buyChips(room, me.accountId);
            if (r.error) return send(ws, { t: 'error', msg: r.error });
            if (me.chips > 0 || !t.seats.includes(me)) { await ctx.coins().cashOut(me.accountId, r.amount, r.amount); return; }
            me.chips = r.amount;
            me.buyIn = (me.buyIn || 0) + r.amount;
            if (r.refilled) send(ws, { t: 'notice', msg: `Your daily top-up: ${r.refilled.toLocaleString()} chips from the house.` });
          } else {
            me.chips = t.settings.startingStack;
          }
          t.addLog(`${me.name} rebuys for ${me.chips}`);
          broadcast(room, { t: 'sfx', name: 'chips' });
          break;
        }
        case 'gesture': {
          // Only members who own the gesture; one every few seconds.
          if (!me.accountId || Date.now() - (me.lastGesture || 0) < GESTURE_COOLDOWN) return;
          const g = await ctx.coins().gestureOf(me.accountId, String(m.item || '')).catch(() => null);
          if (!g) return send(ws, { t: 'error', msg: 'You don\'t own that gesture — find it in the Shop' });
          me.lastGesture = Date.now();
          broadcast(room, { t: 'gesture', seat: t.seatOf(pid), name: me.name, text: g.preview });
          return;
        }
        // Sit out from the next hand on (keep the seat), or come back in.
        case 'sitout': {
          const me = t.seats[t.seatOf(pid)];
          if (!me || room.tourney) return;
          me.sitOut = !!m.on;
          me.sitOutAt = me.sitOut ? Date.now() : 0;
          t.addLog(me.sitOut ? `${me.name} sits out` : `${me.name} is back`);
          break;
        }
        case 'chat':
          // at most one message per second per player
          if (Date.now() - (me.lastChat || 0) < 1000) return;
          me.lastChat = Date.now();
          if (String(m.text || '').trim()) {
            t.addChat(t.seatOf(pid), me.name, String(m.text).trim());
            broadcast(room, { t: 'sfx', name: 'chat' });
          }
          break;
        case 'leave': {
          const r = room;
          await removeSeat(r, pid);
          pid = null;
          room = null;
          await removeAwayPlayers(r); // last human gone? clear the bots
          pushState(r);
          send(ws, { t: 'left' });
          return;
        }
        default:
          return;
      }
      pushState(room);
    }

    ws.on('close', () => {
      if (!room || !pid) return;
      if (watching) { room.watchers.delete(pid); return; }
      if (room.clients.get(pid) !== ws) return; // replaced by a newer connection
      room.clients.delete(pid);
      const i = room.table.seatOf(pid);
      if (i !== -1) { room.table.seats[i].connected = false; room.table.seats[i].awayAt = Date.now(); }
      pushState(room);
    });
  }

  // ----- leaving without the game connection (HTTP, also when the socket is gone) -----
  // Finds the seat by its seat token (guests and members) or by account, and frees it.
  async function leaveBy({ userId = null, token = null, table = null }) {
    let left = 0;
    for (const room of rooms.values()) {
      if (table && room.id !== String(table).toUpperCase()) continue;
      const t = room.table;
      const ids = [];
      if (token) {
        const i = t.seatOf(String(token));
        if (i !== -1 && (!t.seats[i].accountId || t.seats[i].accountId === userId)) ids.push(t.seats[i].id);
      }
      if (userId) for (const s of t.seats) if (s && s.accountId === userId && !ids.includes(s.id)) ids.push(s.id);
      for (const id of ids) {
        const ws = await removeSeat(room, id);
        if (ws) { send(ws, { t: 'left' }); ws.close(); }
        left++;
      }
      if (ids.length) { await removeAwayPlayers(room); pushState(room); }
    }
    return { ok: true, left };
  }

  // ----- used by the API -----
  // Where is this account sitting right now?
  function locate(userId) {
    for (const room of rooms.values()) {
      const s = room.table.seats.find((x) => x && x.accountId === userId);
      if (s) return { table: room.id, tableName: room.name, game: room.game, connected: !!s.connected };
    }
    return null;
  }

  // Update avatar/badge at any table after a shop change.
  function refreshLook(userId) {
    ctx.coins().lookOf(userId).then((look) => {
      for (const room of rooms.values()) {
        const seat = room.table.seats.find((s) => s && s.accountId === userId);
        if (seat) { seat.avatar = look.avatar; seat.badge = look.badge; seat.skin = look.skin || null; pushState(room); }
      }
    }).catch(() => {});
  }

  // Remove a banned player from every table.
  async function kick(userId, message) {
    for (const room of rooms.values()) {
      const seat = room.table.seats.find((s) => s && s.accountId === userId);
      if (!seat) continue;
      const ws = await removeSeat(room, seat.id, `${seat.name} was removed from the table`);
      if (ws) { send(ws, { t: 'kicked', msg: message }); ws.close(); }
      await removeAwayPlayers(room);
      pushState(room);
    }
  }

  // Server shutting down (e.g. a new deploy): give everyone their chips back.
  // A hand that is still running is called off: everyone gets back what they
  // had when it started (including what is already in the pot / on the layout).
  async function cashOutAll() {
    const jobs = [];
    for (const room of rooms.values()) {
      if (room.tourney) {
        // a tournament cannot survive a restart: everyone gets their entry back
        if (room.T.state === 'running') for (const e of room.T.entrants) jobs.push(settleEntrant(room, e, e.entry));
        else for (const s of room.table.seats) if (s && s.tEntry && s.accountId) { jobs.push(ctx.coins().cashOut(s.accountId, s.tEntry, s.tEntry)); s.tEntry = 0; }
        broadcast(room, { t: 'notice', msg: 'The server is restarting — the tournament is called off and every entry is refunded.' });
        continue;
      }
      const t = room.table;
      const running = t.isPlaying();
      broadcast(room, { t: 'notice', msg: 'The server is restarting for an update — your chips are safe in your bankroll, plus 1,000 bonus chips for the interruption. Rejoin in a moment.' });
      for (const s of t.seats) {
        if (!s) continue;
        const chips = running && s.inHand && Number.isFinite(s.startChips) && s.startChips > 0 ? s.startChips : s.chips;
        const copy = { ...s, chips };
        s.buyIn = 0;                      // never paid out twice
        jobs.push(cashOutSeat(room, copy));
      }
    }
    await Promise.all(jobs);
  }

  // Owner announcement: shown to everyone at a table (and in the lobby via /api/tables).
  let announcement = null;
  function announce(text, minutes = 10) {
    announcement = text ? { text: String(text).slice(0, 300), until: Date.now() + minutes * 60000, at: Date.now() } : null;
    if (announcement) for (const room of rooms.values()) broadcast(room, { t: 'announcement', text: announcement.text });
    return announcement;
  }
  const currentAnnouncement = () => (announcement && Date.now() < announcement.until ? { text: announcement.text, at: announcement.at } : null);

  // Members sitting at any table right now (for the update bonus).
  function seatedAccounts() {
    const ids = new Set();
    for (const room of rooms.values()) for (const s of room.table.seats) if (s && !s.isBot && s.accountId) ids.add(s.accountId);
    return [...ids];
  }

  function liveStats() {
    let humans = 0, botsN = 0, playing = 0;
    for (const room of rooms.values()) {
      const seats = room.table.seats.filter(Boolean);
      humans += seats.filter((s) => !s.isBot).length;
      botsN += seats.filter((s) => s.isBot).length;
      if (room.table.isPlaying()) playing++;
    }
    return { humans, bots: botsN, tablesPlaying: playing, tables: [...rooms.values()].map(tableSummary) };
  }

  return { rooms, tableSummary, handleConnection, locate, leaveBy, seatedAccounts, refreshLook, kick, cashOutAll, liveStats, GAMES, createPrivate, PRIVATE_GAMES: Object.keys(PRIVATE), PRIVATE_STAKES, announce, currentAnnouncement, setMaintenance, maintenanceInfo, drain, isIdle, playerCount };
}

module.exports = { createLobby, TABLES, GAMES };
