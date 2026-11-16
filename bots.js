// Computer players.
// A bot estimates its chance of winning by simulating random runouts against
// random opponent hands (it only knows its own cards and the board — no
// peeking), then compares that with the price of calling.
const { VARIANTS, bestHand, newDeck } = require('./poker');

const BOT_NAMES = [
  'Lucky Lou', 'River Rat', 'Chip Chomper', 'Bluffy', 'Nutty Nora',
  'Fold Fred', 'All-in Annie', 'Pocket Pete', 'Tilt Tina', 'Ace Ada',
];

const STYLES = {
  // aggression: how often it bets/raises; looseness: how light it calls
  tight: { aggression: 0.8, looseness: 0.85, bluff: 0.03 },
  normal: { aggression: 1.0, looseness: 1.0, bluff: 0.06 },
  wild: { aggression: 1.35, looseness: 1.2, bluff: 0.12 },
};

function pickBotName(table) {
  const used = new Set(table.seats.filter(Boolean).map((s) => s.name));
  const free = BOT_NAMES.filter((n) => !used.has(n));
  return free.length ? free[Math.floor(Math.random() * free.length)] : `Bot ${Math.floor(Math.random() * 900 + 100)}`;
}

function randomStyle() {
  const keys = Object.keys(STYLES);
  return keys[Math.floor(Math.random() * keys.length)];
}

// Monte Carlo equity: share of simulated hands this hole wins (ties split).
function equity(hole, board, variant, opponents, sims) {
  const known = new Set([...hole, ...board]);
  const rest = newDeck().filter((c) => !known.has(c));
  const holeSize = VARIANTS[variant].hole;
  const need = opponents * holeSize + (5 - board.length);
  let score = 0;
  for (let n = 0; n < sims; n++) {
    // Partial Fisher–Yates: only shuffle the cards we need.
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(Math.random() * (rest.length - i));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    let k = 0;
    const fullBoard = board.concat(rest.slice(k, k + 5 - board.length));
    k += 5 - board.length;
    const mine = bestHand(hole, fullBoard, variant).score;
    let best = 0;
    let ties = 0;
    let lost = false;
    for (let o = 0; o < opponents; o++) {
      const s = bestHand(rest.slice(k, k + holeSize), fullBoard, variant).score;
      k += holeSize;
      if (s > mine) { lost = true; break; }
      if (s === mine) ties++;
      best = Math.max(best, s);
    }
    if (!lost) score += 1 / (ties + 1);
  }
  return score / sims;
}

function decide(table, seatIdx) {
  const me = table.seats[seatIdx];
  const style = STYLES[me.botStyle] || STYLES.normal;
  const lim = table.limits(seatIdx);
  const pot = table.pot();
  const opponents = table.seats.filter((s, i) => s && i !== seatIdx && s.inHand && !s.folded).length;
  const sims = { holdem: 250, omaha: 120, omaha5: 80 }[table.variant] || 150;
  const eq = equity(me.hole, table.board, table.variant, Math.max(1, opponents), sims);
  // Strength relative to an average hand at this table (1.0 = average).
  const rel = eq * (opponents + 1);
  const potOdds = lim.toCall / (pot + lim.toCall || 1);
  const r = Math.random();

  // Don't get stuck in endless raise wars: max 2 raises per street.
  const streetKey = `${table.handNo}:${table.stage}`;
  if (me.botStreet !== streetKey) { me.botStreet = streetKey; me.botRaises = 0; }
  const canRaise = lim.canRaise && me.chips > lim.toCall && me.botRaises < 2;

  const raiseTo = (fraction) => {
    const to = table.currentBet + fraction * (pot + lim.toCall);
    return Math.round(Math.max(lim.minTo, Math.min(lim.maxTo, to)));
  };

  if (canRaise) {
    const monster = rel > 2.4 && eq > 0.6;
    const strong = rel > 1.7 * (2 - style.aggression) || (rel > 1.35 && r < 0.4 * style.aggression);
    const bluff = lim.toCall === 0 && r < style.bluff;
    if (monster && r < 0.25) { me.botRaises++; return { action: 'raise', amount: lim.maxTo }; }
    if (monster || strong || bluff) {
      me.botRaises++;
      return { action: 'raise', amount: raiseTo(0.4 + Math.random() * 0.6) };
    }
  }
  if (lim.toCall === 0) return { action: 'check' };
  // Call if the odds justify it (looser styles call a bit lighter).
  const cheap = lim.toCall <= table.settings.bigBlind && rel > 0.7;
  if (eq * style.looseness > potOdds * 1.05 || cheap) return { action: 'call' };
  return { action: 'fold' };
}

module.exports = { decide, pickBotName, randomStyle, equity };
