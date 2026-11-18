// The weekly ranking: chips won this week in poker against real people,
// Blackjack and Roulette (the same games as the overall leaderboard).
// A week runs Monday 00:00 to Monday 00:00 (UTC). When a new week starts,
// the best three of the last week get coins — once, even across restarts.
const DAY = 86400000;
const WEEKLY_MODES = ['friends', 'blackjack', 'roulette'];
const PRIZES = [500, 300, 150];        // coins for places 1, 2, 3
const MIN_HANDS = 10;                  // at least this many hands to win a prize

// Monday of the week (UTC) as YYYY-MM-DD — the week's key.
function weekKey(t = Date.now()) {
  const d = new Date(t);
  const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY;
  return new Date(monday).toISOString().slice(0, 10);
}
const weekEnd = (key) => Date.parse(key + 'T00:00:00Z') + 7 * DAY;
const prevWeek = (t = Date.now()) => weekKey(Date.parse(weekKey(t) + 'T00:00:00Z') - DAY);

// Who wins a prize: the top three with enough hands and chips won.
const prizeWinners = (rows) => rows.filter((r) => r.hands >= MIN_HANDS && r.net > 0).slice(0, PRIZES.length)
  .map((r, i) => ({ ...r, place: i + 1, prize: PRIZES[i] }));

function createWeekly(ctx) {
  const store = () => ctx.store();

  async function onResult(userId, mode, net, won, now = Date.now()) {
    if (!WEEKLY_MODES.includes(mode) || !store().recordWeekly) return;
    try { await store().recordWeekly(weekKey(now), userId, net, won); } catch (e) { console.error('weekly record', e.message); }
  }

  async function view(userId, now = Date.now()) {
    const week = weekKey(now);
    const rows = await store().weeklyBoard(week, 20);
    const last = prevWeek(now);
    return {
      week, endsAt: weekEnd(week), prizes: PRIZES, minHands: MIN_HANDS,
      rows: rows.map(({ user_id, ...r }, i) => ({ ...r, place: i + 1 })),
      me: userId ? await store().weeklyOf(week, userId) : null,
      last: { week: last, winners: prizeWinners(await store().weeklyBoard(last, 50)).map(({ user_id, ...r }) => r) },
    };
  }

  // Pay last week's prizes (once).
  async function payout(now = Date.now()) {
    const last = prevWeek(now);
    if (!(await store().claimOnce(`weekly-prize-${last}`))) return null;
    const winners = prizeWinners(await store().weeklyBoard(last, 50));
    for (const w of winners) {
      try { await ctx.coins().adjust(w.user_id, w.prize, 0, `weekly:${w.place}`); } catch (e) { console.error('weekly prize', e.message); }
    }
    if (winners.length) {
      const medals = ['🥇', '🥈', '🥉'];
      const text = `🏆 Winners of the week: ${winners.map((w) => `${medals[w.place - 1]} ${w.username} (+${w.prize} coins)`).join(' · ')}`;
      if (ctx.lobby && ctx.lobby.announce) ctx.lobby.announce(text, 12 * 60);
      try { await store().logAdmin('house', `weekly prizes ${last}: ${winners.map((w) => `${w.place}. ${w.username} ${w.prize}`).join(', ')}`); } catch { /* ignore */ }
      console.log(`[weekly] ${text}`);
    }
    return winners;
  }

  function start() {
    const tick = () => payout().catch((e) => console.error('weekly payout', e.message));
    setTimeout(tick, 30 * 1000).unref();
    setInterval(tick, 30 * 60 * 1000).unref();
  }

  return { onResult, view, payout, start };
}

module.exports = { createWeekly, weekKey, weekEnd, prevWeek, prizeWinners, WEEKLY_MODES, PRIZES, MIN_HANDS };
