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
  { id: 'BLACKJACK-1', name: 'Blackjack · Table 1', game: 'blackjack', capacity: 7, buyIn: 1000, minBuyIn: 100, settings: { bigBlind: 10 } },
  { id: 'BLACKJACK-2', name: 'Blackjack · High Roller', game: 'blackjack', capacity: 7, highRoller: true, buyIn: 5000, minBuyIn: 1000, settings: { bigBlind: 50 } },
  { id: 'DURAK-1', name: 'Durak · Table 1', game: 'durak', capacity: 6 },
  { id: 'DURAK-2', name: 'Durak · High Roller', game: 'durak', capacity: 6, highRoller: true, minBankroll: 10000 },
  { id: 'ROULETTE-1', name: 'Roulette · Table 1', game: 'roulette', capacity: 8, buyIn: 1000, minBuyIn: 100, settings: { bigBlind: 5 } },
  { id: 'FLAMINGO-1', name: 'Flamingo · Table 1', game: 'flamingo', capacity: 6 },
  { id: 'ROULETTE-2', name: 'Roulette · High Roller', game: 'roulette', capacity: 8, highRoller: true, buyIn: 5000, minBuyIn: 1000, settings: { bigBlind: 25 } },
];

const NEXT_HAND_DELAY = 6000;
const DISCONNECTED_TURN_TIMEOUT = 8000;
const TURN_TIMEOUT = Number(process.env.TURN_TIMEOUT_MS) || 40000;            // a seated player who does nothing this long gets a safe default move
const BOT_THINK_MS = [700, 1800];
const AUTO_START_DELAY = 3000;          // deal this long after enough players sit down
const AWAY_LIMIT = 3 * 60 * 1000;       // disconnected players lose their seat after this

function createLobby(ctx) {
  // ctx: { store(), coins(), log }
  const rooms = new Map();

  for (const def of TABLES) {
    const settings = { ...(def.settings || {}), startingStack: def.buyIn || 1000 };
    const room = { ...def, code: def.id, table: GAMES[def.game].make(settings), clients: new Map(), nextTimer: null, turnTimer: null, startTimer: null, phaseTimer: null };
    wireTable(room);
    rooms.set(def.id, room);
  }

  function wireTable(room) {
    room.table.onEvent = (kind) => {
      broadcast(room, { t: 'sfx', name: kind });
      if (kind === 'win') recordResults(room);
    };
  }

  const usesChips = (room) => room.game !== 'durak' && room.game !== 'flamingo';
  const seatedCount = (t) => t.seats.filter(Boolean).length;

  function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); }
  function broadcast(room, msg) { for (const ws of room.clients.values()) send(ws, msg); }

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
      accountsOnly: !!room.highRoller,
      buyIn: room.buyIn || 0,
      minBuyIn: room.minBuyIn || 0,
      minBankroll: room.minBankroll || 0,
      stakes: room.game === 'holdem' ? `Blinds ${s.smallBlind} / ${s.bigBlind}`
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
      for (const [pid, ws] of room.clients) {
        send(ws, { t: 'state', room: room.code, tableName: room.name, highRoller: !!room.highRoller, usesChips: usesChips(room), state: t.view(pid), turn: room.turn ? { key: room.turn.key, seat: room.turn.seat, msLeft: Math.max(0, room.turn.endsAt - Date.now()) } : null });
      }
    } catch (e) {
      console.error('pushState error', e);
    }
  }

  function scheduleTimers(room) {
    const t = room.table;
    // Deal automatically once enough players are seated (no host needed).
    if (t.stage === 'waiting' && !room.startTimer && hasHuman(room) && t.canStart()) {
      room.startTimer = setTimeout(() => {
        room.startTimer = null;
        if (t.stage === 'waiting' && hasHuman(room)) { rebuyBots(t); if (t.canStart()) t.startHand(); }
        pushState(room);
      }, AUTO_START_DELAY);
    }
    // Auto-deal the next hand after a showdown.
    if (t.stage === 'showdown' && !room.nextTimer) {
      room.nextTimer = setTimeout(async () => {
        room.nextTimer = null;
        if (t.stage !== 'showdown') return;
        await removeAwayPlayers(room);
        if (hasHuman(room)) { rebuyBots(t); if (t.canStart()) t.startHand(); else t.stage = 'waiting'; }
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
        if (t.tick(Date.now())) pushState(room);
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
    const t = room.table;
    const store = ctx.store();
    const coins = ctx.coins();
    store.recordActivity(dayString(Date.now()), room.game).catch((e) => console.error('activity error', e));
    for (const r of t.resultsForRecord()) {
      store.recordHand(r.accountId, r.mode, r.net, r.won, r.pot).catch((e) => console.error('record error', e));
      const amount = rewardFor(r);
      if (!amount) continue;
      coins.earn(r.accountId, amount).then((res) => {
        const seat = room.table.seats.find((s) => s && s.accountId === r.accountId);
        const ws = seat && room.clients.get(seat.id);
        if (ws) send(ws, { t: 'coins', amount: res.amount, coins: res.coins, capped: !!res.capped });
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
    t.leave(seatId); // may fold/stand for them first
    await cashOutSeat(room, { ...seat, accountId });
    const ws = room.clients.get(seatId);
    room.clients.delete(seatId);
    return ws;
  }

  // Free seats of people disconnected for a while (between hands only),
  // and clear out the bots once no real player is left.
  async function removeAwayPlayers(room) {
    const t = room.table;
    if (t.isPlaying()) return false;
    let changed = false;
    for (const s of t.seats.slice()) {
      if (s && !s.isBot && !s.connected && Date.now() - (s.awayAt || 0) > AWAY_LIMIT) {
        await removeSeat(room, s.id, `${s.name} left (disconnected)`);
        changed = true;
      }
    }
    if (!t.seats.some((s) => s && !s.isBot)) {
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

  function hasHuman(room) { return room.table.seats.some((s) => s && !s.isBot && s.connected); }

  function rebuyBots(t) {
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

      if (m.t === 'join') {
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
          if (seatedCount(table) >= target.capacity) removeBot(target); // make room for a human
          if (seatedCount(table) >= target.capacity) return send(ws, { t: 'error', msg: 'This table is full — try the other one' });
          // Accounts bring chips from their bankroll; guests get a free table stack.
          let stack = null;
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
            return send(ws, { t: 'error', msg: 'This table is full — try the other one' });
          }
          const seat = table.seats[table.seatOf(newPid)];
          if (stack !== null) { seat.chips = stack; seat.buyIn = stack; }
          seat.avatar = look.avatar || null;
          seat.badge = look.badge || null;
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
      const t = room.table;
      const me = t.seats[t.seatOf(pid)];
      if (!me) return;

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
        case 'chat':
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
      if (room.clients.get(pid) !== ws) return; // replaced by a newer connection
      room.clients.delete(pid);
      const i = room.table.seatOf(pid);
      if (i !== -1) { room.table.seats[i].connected = false; room.table.seats[i].awayAt = Date.now(); }
      pushState(room);
    });
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
        if (seat) { seat.avatar = look.avatar; seat.badge = look.badge; pushState(room); }
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
  async function cashOutAll() {
    const jobs = [];
    for (const room of rooms.values()) for (const s of room.table.seats) if (s) jobs.push(cashOutSeat(room, s));
    await Promise.all(jobs);
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

  return { rooms, tableSummary, handleConnection, locate, refreshLook, kick, cashOutAll, liveStats, GAMES };
}

module.exports = { createLobby, TABLES, GAMES };
