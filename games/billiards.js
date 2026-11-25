// 8-ball pool for chips.
//
// Two players play for the table's stake (settings.bigBlind); the winner takes it
// from the loser's table chips. The server plays every shot with the shared physics
// (public/js/billiards-physics.js) and applies the rules; the browsers replay the
// same shot to animate it, so they show exactly what the server decided.
//
// Rules (simplified 8-ball): the breaker places the cue ball behind the head string.
// The table is open until a player pockets a ball after the break: that ball's group
// (solids 1–7 or stripes 9–15) becomes theirs. A shot is legal when the cue ball first
// touches one of your balls (on an open table: any ball but the 8; with your group
// cleared: the 8), and afterwards a ball is pocketed or touches a cushion, and the cue
// ball stays on the table. You keep shooting while you legally pocket your own balls.
// A foul gives the opponent ball in hand (the cue ball anywhere). The 8: pocket it
// legally after clearing your group to win; pocketing it any earlier, or with a foul,
// loses. (The 8 on the break is put back on the foot spot.)
const { BaseTable } = require('./base');
const Pool = require('../public/js/billiards-physics.js');

const SOLIDS = [1, 2, 3, 4, 5, 6, 7];
const STRIPES = [9, 10, 11, 12, 13, 14, 15];
const LEVEL_STYLE = { 1: 'wild', 2: 'normal', 3: 'tight' };
const BOT_LEVEL = { wild: 1, normal: 2, tight: 3 };
const AIM_NOISE = { 1: 0.035, 2: 0.012, 3: 0.004 };       // radians of wobble when the bot aims

class Billiards extends BaseTable {
  constructor(opts = {}) {
    super(opts);
    this.game = 'billiards';
    this.maxSeats = 2;
    this.seats = new Array(2).fill(null);
    this.breaker = 1;
    this.reset();
  }

  stake() { return this.settings.bigBlind; }
  minBet() { return this.stake(); }
  reset() {
    this.balls = Pool.rack();
    this.groups = [null, null];     // per seat: 'solids' | 'stripes'
    this.ballInHand = false;
    this.kitchen = false;           // ball in hand behind the head string (the break)
    this.isBreak = false;
    this.shot = null;               // the last shot, for the browsers to replay
    this.shotNo = 0;
    this.busyUntil = 0;             // the balls are still rolling (on screen) until then
    this.nextToAct = -1;
    this.note = '';
  }

  isPlaying() { return this.stage === 'playing'; }
  players() { return this.seats.filter((s) => s && !s.sitOut); }
  canStart() { return !this.isPlaying() && this.players().length === 2 && this.players().every((s) => s.chips >= this.stake()); }
  opp(i) { return 1 - i; }

  startHand() {
    if (!this.canStart()) return false;
    this.handNo++;
    this.reset();
    this.breaker = this.handNo === 1 ? Math.floor(Math.random() * 2) : 1 - this.breaker;
    this.results = null;
    for (const s of this.seats) if (s) { s.inHand = true; s.startChips = s.chips; s.lastAction = null; }
    this.stage = 'playing';
    this.toAct = this.breaker;
    this.ballInHand = true; this.kitchen = true; this.isBreak = true;
    this.note = `${this.seats[this.breaker].name} breaks`;
    this.addLog(`— Game ${this.handNo}: ${this.seats[this.breaker].name} breaks · stake ${this.stake()} —`);
    this.onEvent('deal');
    return true;
  }

  // ----- groups -----
  groupBalls(g) { return g === 'solids' ? SOLIDS : g === 'stripes' ? STRIPES : []; }
  groupOf(n) { return SOLIDS.includes(n) ? 'solids' : STRIPES.includes(n) ? 'stripes' : null; }
  left(g) { return this.groupBalls(g).filter((n) => !this.ball(n).down).length; }
  ball(n) { return this.balls.find((b) => b.n === n); }
  onEight(i) { return !!this.groups[i] && this.left(this.groups[i]) === 0; }
  // which balls this player may hit first
  targets(i) {
    if (this.onEight(i)) return [8];
    if (this.groups[i]) return this.groupBalls(this.groups[i]).filter((n) => !this.ball(n).down);
    return [...SOLIDS, ...STRIPES].filter((n) => !this.ball(n).down);
  }

  // ----- the clock between shots: wait for the balls to stop on screen -----
  get deadline() { return this.isPlaying() && this.busyUntil ? this.busyUntil : 0; }
  tick(now = Date.now()) {
    if (!this.busyUntil || now < this.busyUntil) return false;
    this.busyUntil = 0;
    if (this.isPlaying()) { this.toAct = this.nextToAct; this.nextToAct = -1; }
    return true;
  }

  // action: shoot (amount = { angle, power, cue: [x, y] when you have ball in hand }) · timeout · resign
  act(id, action, amount, now = Date.now()) {
    const i = this.seatOf(id);
    if (i === -1 || !this.isPlaying()) return { error: 'Not your turn' };
    if (action === 'resign') { this.finish(this.opp(i), `${this.seats[i].name} concedes`); return { ok: true }; }
    if (i !== this.toAct || this.busyUntil) return { error: 'Not your turn' };
    const s = this.seats[i];
    if (action === 'timeout') {
      s.lastAction = 'Out of time';
      this.addLog(`${s.name} ran out of time — ball in hand for ${this.seats[this.opp(i)].name}`);
      this.foul(i, 'out of time');
      this.toAct = this.opp(i);
      return { ok: true };
    }
    if (action !== 'shoot') return { error: 'Unknown action' };
    const a = amount || {};
    const angle = Number(a.angle), power = Number(a.power);
    if (!Number.isFinite(angle) || !Number.isFinite(power) || power < 0 || power > 1) return { error: 'Aim and choose a strength' };
    const cue = this.ball(0);
    if (this.ballInHand && Array.isArray(a.cue)) {
      const [x, y] = a.cue.map(Number);
      if (!Pool.canPlace(this.balls, x, y, this.kitchen)) return { error: this.kitchen ? 'Place the cue ball behind the line, free of other balls' : 'Place the cue ball on a free spot' };
      cue.x = x; cue.y = y; cue.down = false;
    }
    if (cue.down) return { error: 'Place the cue ball first' };
    const before = this.balls.map((b) => ({ ...b }));
    // what counted as legal is decided by the table as it was before the shot
    const rules = { targets: this.targets(i), onEight: this.onEight(i) };
    const spin = { x: Math.max(-1, Math.min(1, Number(a.spin && a.spin.x) || 0)), y: Math.max(-1, Math.min(1, Number(a.spin && a.spin.y) || 0)) };
    const r = Pool.simulate(before, { angle, power, spin });
    this.shotNo++;
    this.shot = { no: this.shotNo, seat: i, before, angle, power, spin };
    this.balls = r.balls;
    this.judge(i, r.events, rules);
    // the next player waits until the balls stop on screen
    if (this.isPlaying()) {
      this.nextToAct = this.toAct;
      this.toAct = -1;
      this.busyUntil = now + Math.round(r.duration * 1000) + 600;
    }
    this.onEvent(r.events.pocketed.length ? 'pot' : 'cue');
    return { ok: true };
  }

  judge(i, ev, rules) {
    const s = this.seats[i];
    const o = this.opp(i);
    const wasBreak = this.isBreak;
    this.isBreak = false;
    this.ballInHand = false; this.kitchen = false;
    const potted = ev.pocketed.map((p) => p.n).filter((n) => n !== 0);
    const eight = potted.includes(8);
    const onEight = rules.onEight;
    // was the shot legal?
    let foul = null;
    if (ev.cueDown) foul = 'the cue ball went in';
    else if (ev.first === null) foul = 'no ball was hit';
    else if (!wasBreak && !rules.targets.includes(ev.first)) foul = ev.first === 8 ? 'the 8 was hit first' : 'the wrong ball was hit first';
    else if (!wasBreak && !ev.rail && !potted.length) foul = 'no ball reached a cushion';

    // the 8-ball decides the game
    if (eight) {
      if (wasBreak && !ev.cueDown) {
        // put the 8 back on the foot spot (or as close behind it as is free)
        const b8 = this.ball(8);
        let x = Pool.FOOT.x;
        while (!Pool.canPlace(this.balls.filter((b) => b.n !== 8), x, Pool.FOOT.y, false) && x < Pool.W - Pool.R) x += 0.5;
        b8.x = x; b8.y = Pool.FOOT.y; b8.down = false;
        this.addLog('The 8 went in on the break — it goes back on the foot spot');
      } else if (onEight && !foul) { this.finish(i, `${s.name} pockets the 8`); return; }
      else { this.finish(o, onEight ? `${s.name} pockets the 8 with a foul` : `${s.name} pockets the 8 too early`); return; }
    }
    const mineDown = potted.filter((n) => n !== 8 && (!this.groups[i] || this.groupOf(n) === this.groups[i]));
    // an open table: the first ball pocketed legally after the break decides the groups
    if (!foul && !wasBreak && !this.groups[i] && mineDown.length) {
      const g = this.groupOf(mineDown[0]);
      this.groups[i] = g; this.groups[o] = g === 'solids' ? 'stripes' : 'solids';
      this.addLog(`${s.name} plays the ${g}, ${this.seats[o].name} the ${this.groups[o]}`);
    }
    if (foul) {
      s.lastAction = 'Foul';
      this.addLog(`Foul by ${s.name}: ${foul} — ball in hand for ${this.seats[o].name}`);
      this.note = `Foul: ${foul}`;
      this.foul(i, foul);
      this.toAct = o;
      return;
    }
    if (potted.length) this.addLog(`${s.name} pockets ${potted.join(', ')}`);
    const keep = wasBreak ? potted.length > 0 : mineDown.length > 0;
    s.lastAction = keep ? (potted.length ? `Pockets ${potted.join(', ')}` : 'Shoots') : potted.length ? `Pockets ${potted.join(', ')}` : 'Misses';
    this.note = keep ? `${s.name} shoots again` : '';
    this.toAct = keep ? i : o;
  }

  foul(i) {
    const cue = this.ball(0);
    this.ballInHand = true; this.kitchen = false;
    if (cue.down) { cue.down = false; cue.x = Pool.HEAD_X; cue.y = 50; }
  }

  finish(winner, reason) {
    const loser = this.seats[this.opp(winner)];
    const paid = Math.min(this.stake(), loser.chips);
    loser.chips -= paid;
    this.seats[winner].chips += paid;
    this.results = { winners: [{ seat: winner, amount: paid, hand: reason }], reason, stake: this.stake(), shown: true };
    this.addLog(`${this.seats[winner].name} wins ${paid} — ${reason}`);
    this.stage = 'showdown';
    this.toAct = -1; this.nextToAct = -1;
    // let the last shot finish rolling on screen before the result shows
    this.onEvent('win');
  }

  leave(id) {
    const i = this.seatOf(id);
    if (i === -1) return;
    if (this.isPlaying()) this.finish(this.opp(i), `${this.seats[i].name} left the table`);
    this.seats[i] = null;
  }
  defaultAction() { return { action: 'timeout' }; }
  resultsForRecord() {
    if (!this.results) return [];
    const w = this.results.winners[0].seat;
    return this.seats.map((s, i) => (s && s.accountId && s.inHand
      ? { accountId: s.accountId, mode: 'billiards', net: s.chips - s.startChips, won: i === w, pot: i === w ? this.results.winners[0].amount : 0 } : null)).filter(Boolean);
  }
  leaveRecord() { return null; }

  // ----- the computer player: pick the easiest pot, aim with a little wobble -----
  botLevel(s) { return BOT_LEVEL[s.botStyle] || 2; }
  botAction(i) {
    const level = this.botLevel(this.seats[i]);
    let cuePos = null;
    if (this.ballInHand) {
      // try a few spots for the cue ball and keep the one with the best shot
      let best = null;
      for (let k = 0; k < 40; k++) {
        const x = this.kitchen ? 8 + Math.random() * 40 : 6 + Math.random() * 188, y = 6 + Math.random() * 88;
        if (!Pool.canPlace(this.balls, x, y, this.kitchen)) continue;
        const plan = this.plan(i, { x, y }, level);
        if (plan && (!best || plan.score > best.score)) best = { ...plan, cue: [x, y] };
      }
      if (best) cuePos = best.cue;
      else { const c = this.kitchen ? [40, 50] : [50, 50]; if (Pool.canPlace(this.balls, c[0], c[1], this.kitchen)) cuePos = c; }
    }
    const cue = cuePos ? { x: cuePos[0], y: cuePos[1] } : this.ball(0);
    if (this.isBreak) return { action: 'shoot', amount: { angle: Math.atan2(Pool.FOOT.y - cue.y + (Math.random() - 0.5) * 2, Pool.FOOT.x - cue.x), power: 0.92 + Math.random() * 0.08, cue: cuePos } };
    const plan = this.plan(i, cue, level) || this.safety(i, cue);
    const angle = plan.angle + (Math.random() - 0.5) * 2 * AIM_NOISE[level];
    // stronger bots use a little follow or draw to keep the cue ball in play
    const spin = level === 3 ? { x: 0, y: Math.random() < 0.5 ? 0.35 : -0.3 } : { x: 0, y: 0 };
    return { action: 'shoot', amount: { angle, power: Math.min(1, plan.power * (1 + (Math.random() - 0.5) * (level === 1 ? 0.3 : 0.12))), spin, cue: cuePos || undefined } };
  }
  // the best pot from this cue position: ghost-ball aiming, clear paths, a gentle cut
  plan(i, cue, level) {
    const R = Pool.R;
    const others = this.balls.filter((b) => !b.down && b.n !== 0);
    const clear = (ax, ay, bx, by, skip) => others.every((b) => {
      if (skip.includes(b.n)) return true;
      const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
      const t = ((b.x - ax) * dx + (b.y - ay) * dy) / (len * len);
      if (t < 0 || t > 1) return true;
      return Math.hypot(ax + dx * t - b.x, ay + dy * t - b.y) > 2 * R + 0.3;
    });
    let best = null;
    for (const n of this.targets(i)) {
      const b = this.ball(n);
      for (const p of Pool.POCKETS) {
        const px = p.x - b.x, py = p.y - b.y, pd = Math.hypot(px, py);
        const gx = b.x - (px / pd) * 2 * R, gy = b.y - (py / pd) * 2 * R;          // the ghost ball
        const cx = gx - cue.x, cy = gy - cue.y, cd = Math.hypot(cx, cy);
        if (cd < 0.5) continue;
        const cut = Math.acos(Math.max(-1, Math.min(1, (cx * px + cy * py) / (cd * pd))));
        if (cut > (level === 1 ? 1.0 : 1.25)) continue;
        if (!clear(cue.x, cue.y, gx, gy, [n]) || !clear(b.x, b.y, p.x, p.y, [n])) continue;
        const score = -cut * 60 - cd * 0.3 - pd * 0.4;
        // strength: the object ball must roll to the pocket (and a little more), the cue ball must get there
        const vObj = Math.sqrt(2 * Pool.ROLL * (pd + 18)) * 1.4;
        const vHit = vObj / Math.max(0.35, Math.cos(cut));
        const speed = Math.sqrt(vHit * vHit + 2 * 150 * cd);
        const power = Math.max(0.08, Math.min(1, (speed - Pool.MIN_SPEED) / (Pool.MAX_SPEED - Pool.MIN_SPEED)));
        if (!best || score > best.score) best = { score, angle: Math.atan2(cy, cx), power };
      }
    }
    return best;
  }
  // nothing to pot: hit one of your balls firmly so it reaches a cushion
  safety(i, cue) {
    const t = this.targets(i).map((n) => this.ball(n)).sort((a, b) => Math.hypot(a.x - cue.x, a.y - cue.y) - Math.hypot(b.x - cue.x, b.y - cue.y))[0];
    if (!t) return { angle: Math.random() * Math.PI * 2, power: 0.5 };
    return { angle: Math.atan2(t.y - cue.y, t.x - cue.x), power: 0.55 };
  }

  view(viewerId) {
    const v = this.baseView(viewerId);
    const me = v.mySeat;
    v.stake = this.stake();
    v.minBet = this.stake();
    v.balls = this.balls;
    v.groups = this.groups;
    v.ballInHand = this.ballInHand && this.toAct !== -1;
    v.kitchen = this.kitchen;
    v.isBreak = this.isBreak;
    v.shot = this.shot;
    v.note = this.note;
    v.targets = me !== -1 && me === this.toAct ? this.targets(me) : [];
    v.rolling = this.busyUntil ? Math.max(0, this.busyUntil - Date.now()) : 0;
    v.seats = this.seats.map((s, i) => s && { ...this.baseSeatView(s), group: this.groups[i], left: this.groups[i] ? this.left(this.groups[i]) : null, onEight: this.onEight(i), botLevel: s.isBot ? this.botLevel(s) : null });
    return v;
  }
}

module.exports = { Billiards, LEVEL_STYLE };
