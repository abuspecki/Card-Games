// Gold Rush — a solo "how deep do you dare?" game against the house.
//
// You stake chips and pick a level. Each "dig" takes the miner one tunnel
// deeper: the multiplier grows, but the tunnel may cave in (stake lost).
// Cash out any time for stake × multiplier. Reaching the bottom cashes out.
//
// Fairness: the server decides every dig (crypto RNG); the multiplier after k
// safe tunnels is (1 − edge) / p^k, so the house edge is the same 3 % at every
// depth and level. The stake is held like table chips (bankroll -> in_play),
// so a crash or restart refunds it.
const crypto = require('crypto');

const EDGE = 0.03;
const LEVELS = {
  easy: { name: 'Easy', p: 0.92, depth: 20 },
  medium: { name: 'Medium', p: 0.84, depth: 15 },
  hard: { name: 'Hard', p: 0.72, depth: 10 },
  extreme: { name: 'Extreme', p: 0.55, depth: 8 },
};
const MIN_STAKE = 10;
const MAX_STAKE = 5000;

const multiplier = (level, k) => (k <= 0 ? 1 : Math.floor(((1 - EDGE) / Math.pow(LEVELS[level].p, k)) * 100) / 100);
const ladder = (level) => Array.from({ length: LEVELS[level].depth }, (_, i) => multiplier(level, i + 1));

function createGoldRush(ctx, opts = {}) {
  const rounds = new Map();            // userId -> { level, stake, step, startedAt }
  const locks = new Map();             // userId -> promise chain (one request at a time)
  const rand = opts.rand || (() => crypto.randomInt(0, 1e9) / 1e9);

  // Serialise every action of one user.
  function locked(userId, fn) {
    const prev = locks.get(userId) || Promise.resolve();
    const next = prev.then(fn, fn);
    locks.set(userId, next.catch(() => {}));
    return next;
  }

  const view = (r) => r && {
    level: r.level, stake: r.stake, step: r.step, depth: LEVELS[r.level].depth,
    multiplier: multiplier(r.level, r.step), cashout: Math.floor(r.stake * multiplier(r.level, r.step)),
    next: r.step < LEVELS[r.level].depth ? multiplier(r.level, r.step + 1) : null,
    risk: Math.round((1 - LEVELS[r.level].p) * 100),
  };

  function config() {
    return {
      edge: EDGE, minStake: MIN_STAKE, maxStake: MAX_STAKE,
      levels: Object.fromEntries(Object.entries(LEVELS).map(([k, l]) => [k, { name: l.name, depth: l.depth, risk: Math.round((1 - l.p) * 100), ladder: ladder(k) }])),
    };
  }

  async function record(userId, net, won, pot) {
    try { await ctx.store().recordHand(userId, 'goldrush', net, won, pot); } catch (e) { console.error('goldrush record', e); }
    if (won && net > 0 && ctx.reward) { try { await ctx.reward(userId, { mode: 'goldrush', net, won, pot }); } catch (e) { console.error('goldrush reward', e); } }
  }

  async function finish(userId, r, payout) {
    rounds.delete(userId);
    await ctx.coins().cashOut(userId, payout, r.stake);
    const net = payout - r.stake;
    await record(userId, net, net > 0, Math.max(0, net));
    return net;
  }

  return {
    config,
    state(userId) { return { round: view(rounds.get(userId)) || null, config: config() }; },

    start(userId, stake, level) {
      return locked(userId, async () => {
        if (rounds.has(userId)) return { error: 'Finish your current dig first' };
        if (!LEVELS[level]) return { error: 'Pick a level' };
        stake = Math.floor(Number(stake));
        if (!Number.isFinite(stake) || stake < MIN_STAKE) return { error: `The minimum stake is ${MIN_STAKE} chips` };
        if (stake > MAX_STAKE) return { error: `The maximum stake is ${MAX_STAKE.toLocaleString()} chips` };
        const r = await ctx.coins().buyIn(userId, stake, stake);
        if (r.error) return { error: r.error };
        rounds.set(userId, { level, stake, step: 0, startedAt: Date.now() });
        return { ok: true, round: view(rounds.get(userId)) };
      });
    },

    dig(userId) {
      return locked(userId, async () => {
        const r = rounds.get(userId);
        if (!r) return { error: 'Start a new dig first' };
        const L = LEVELS[r.level];
        if (rand() >= L.p) {
          // cave-in: the stake stays with the house
          rounds.delete(userId);
          await ctx.coins().cashOut(userId, 0, r.stake);
          await record(userId, -r.stake, false, 0);
          return { ok: true, collapsed: true, step: r.step + 1, lost: r.stake };
        }
        r.step++;
        if (r.step >= L.depth) {
          const payout = Math.floor(r.stake * multiplier(r.level, r.step));
          await finish(userId, r, payout);
          return { ok: true, bottom: true, step: r.step, multiplier: multiplier(r.level, r.step), payout };
        }
        return { ok: true, round: view(r) };
      });
    },

    cashout(userId) {
      return locked(userId, async () => {
        const r = rounds.get(userId);
        if (!r) return { error: 'Nothing to cash out' };
        if (r.step === 0) { rounds.delete(userId); await ctx.coins().cashOut(userId, r.stake, r.stake); return { ok: true, payout: r.stake, multiplier: 1, step: 0 }; }
        const payout = Math.floor(r.stake * multiplier(r.level, r.step));
        await finish(userId, r, payout);
        return { ok: true, payout, multiplier: multiplier(r.level, r.step), step: r.step };
      });
    },

    // Server shutting down: pay out what every running dig is worth right now.
    async cashOutAll() {
      for (const [userId, r] of [...rounds]) {
        const payout = r.step ? Math.floor(r.stake * multiplier(r.level, r.step)) : r.stake;
        try { await finish(userId, r, payout); } catch (e) { console.error('goldrush shutdown', e); }
      }
    },
    _rounds: rounds,
  };
}

module.exports = { createGoldRush, LEVELS, EDGE, multiplier, ladder };
