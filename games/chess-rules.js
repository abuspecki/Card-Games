// Chess rules and a small computer player.
//
// A position: { b: Array(64) of '' | 'P','N','B','R','Q','K' (white) | 'p'… (black),
// turn: 'w' | 'b', castle: 'KQkq' subset, ep: square index or -1, half: half-move
// clock, full: move number }. Square 0 = a8, 7 = h8, 56 = a1, 63 = h1.
// Moves: { from, to, promo } with promo one of 'q','r','b','n' (or undefined).

const FILES = 'abcdefgh';
const sq = (name) => (8 - Number(name[1])) * 8 + FILES.indexOf(name[0]);
const nameOf = (i) => FILES[i % 8] + (8 - Math.floor(i / 8));
const isWhite = (p) => p && p === p.toUpperCase();
const colorOf = (p) => (!p ? null : isWhite(p) ? 'w' : 'b');
const rc = (i) => [Math.floor(i / 8), i % 8];
const at = (r, c) => (r < 0 || r > 7 || c < 0 || c > 7 ? -1 : r * 8 + c);

function start() {
  const back = 'rnbqkbnr';
  const b = new Array(64).fill('');
  for (let c = 0; c < 8; c++) {
    b[c] = back[c]; b[8 + c] = 'p';
    b[48 + c] = 'P'; b[56 + c] = back[c].toUpperCase();
  }
  return { b, turn: 'w', castle: 'KQkq', ep: -1, half: 0, full: 1 };
}

const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ROOK = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISHOP = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

// Is square i attacked by side `by`?
function attacked(b, i, by) {
  const [r, c] = rc(i);
  const own = (p) => p && colorOf(p) === by;
  const pawnDir = by === 'w' ? 1 : -1;            // a white pawn attacks from the row below
  for (const dc of [-1, 1]) {
    const j = at(r + pawnDir, c + dc);
    if (j !== -1 && own(b[j]) && b[j].toLowerCase() === 'p') return true;
  }
  for (const [dr, dc] of KNIGHT) { const j = at(r + dr, c + dc); if (j !== -1 && own(b[j]) && b[j].toLowerCase() === 'n') return true; }
  for (const [dr, dc] of KING) { const j = at(r + dr, c + dc); if (j !== -1 && own(b[j]) && b[j].toLowerCase() === 'k') return true; }
  for (const [dirs, kinds] of [[ROOK, 'rq'], [BISHOP, 'bq']]) {
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      while (at(rr, cc) !== -1) {
        const p = b[at(rr, cc)];
        if (p) { if (own(p) && kinds.includes(p.toLowerCase())) return true; break; }
        rr += dr; cc += dc;
      }
    }
  }
  return false;
}

const kingSquare = (b, side) => b.indexOf(side === 'w' ? 'K' : 'k');
const inCheck = (pos, side = pos.turn) => attacked(pos.b, kingSquare(pos.b, side), side === 'w' ? 'b' : 'w');

// Moves that follow the piece rules, before checking the own king.
function pseudo(pos) {
  const { b, turn } = pos;
  const out = [];
  const enemy = (p) => p && colorOf(p) !== turn;
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p || colorOf(p) !== turn) continue;
    const [r, c] = rc(i);
    const k = p.toLowerCase();
    if (k === 'p') {
      const dir = turn === 'w' ? -1 : 1;
      const startRow = turn === 'w' ? 6 : 1;
      const lastRow = turn === 'w' ? 0 : 7;
      const add = (to) => {
        if (Math.floor(to / 8) === lastRow) for (const promo of ['q', 'r', 'b', 'n']) out.push({ from: i, to, promo });
        else out.push({ from: i, to });
      };
      const one = at(r + dir, c);
      if (one !== -1 && !b[one]) {
        add(one);
        const two = at(r + 2 * dir, c);
        if (r === startRow && !b[two]) out.push({ from: i, to: two });
      }
      for (const dc of [-1, 1]) {
        const t = at(r + dir, c + dc);
        if (t === -1) continue;
        if (enemy(b[t])) add(t);
        else if (t === pos.ep) out.push({ from: i, to: t, ep: true });
      }
    } else if (k === 'n' || k === 'k') {
      for (const [dr, dc] of k === 'n' ? KNIGHT : KING) {
        const t = at(r + dr, c + dc);
        if (t !== -1 && (!b[t] || enemy(b[t]))) out.push({ from: i, to: t });
      }
      if (k === 'k') {
        const enemySide = turn === 'w' ? 'b' : 'w';
        const home = turn === 'w' ? 60 : 4;
        if (i === home && !attacked(b, home, enemySide)) {
          const [ks, qs] = turn === 'w' ? ['K', 'Q'] : ['k', 'q'];
          if (pos.castle.includes(ks) && !b[home + 1] && !b[home + 2] && b[home + 3] === (turn === 'w' ? 'R' : 'r')
            && !attacked(b, home + 1, enemySide) && !attacked(b, home + 2, enemySide)) out.push({ from: i, to: home + 2, castle: 'k' });
          if (pos.castle.includes(qs) && !b[home - 1] && !b[home - 2] && !b[home - 3] && b[home - 4] === (turn === 'w' ? 'R' : 'r')
            && !attacked(b, home - 1, enemySide) && !attacked(b, home - 2, enemySide)) out.push({ from: i, to: home - 2, castle: 'q' });
        }
      }
    } else {
      const dirs = k === 'r' ? ROOK : k === 'b' ? BISHOP : [...ROOK, ...BISHOP];
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc;
        while (at(rr, cc) !== -1) {
          const t = at(rr, cc);
          if (b[t]) { if (enemy(b[t])) out.push({ from: i, to: t }); break; }
          out.push({ from: i, to: t });
          rr += dr; cc += dc;
        }
      }
    }
  }
  return out;
}

// The position after a move (the move must be pseudo-legal).
function play(pos, m) {
  const b = pos.b.slice();
  const p = b[m.from];
  const captured = m.ep ? b[m.to + (pos.turn === 'w' ? 8 : -8)] : b[m.to];
  b[m.to] = m.promo ? (pos.turn === 'w' ? m.promo.toUpperCase() : m.promo) : p;
  b[m.from] = '';
  if (m.ep) b[m.to + (pos.turn === 'w' ? 8 : -8)] = '';
  if (m.castle) {
    const [rf, rt] = m.castle === 'k' ? [m.from + 3, m.from + 1] : [m.from - 4, m.from - 1];
    b[rt] = b[rf]; b[rf] = '';
  }
  let castle = pos.castle;
  const strip = (chars) => { for (const ch of chars) castle = castle.replace(ch, ''); };
  if (p === 'K') strip('KQ');
  if (p === 'k') strip('kq');
  for (const s of [m.from, m.to]) { if (s === 63) strip('K'); if (s === 56) strip('Q'); if (s === 7) strip('k'); if (s === 0) strip('q'); }
  const pawn = p.toLowerCase() === 'p';
  return {
    b, castle,
    turn: pos.turn === 'w' ? 'b' : 'w',
    ep: pawn && Math.abs(m.to - m.from) === 16 ? (m.from + m.to) / 2 : -1,
    half: pawn || captured ? 0 : pos.half + 1,
    full: pos.full + (pos.turn === 'b' ? 1 : 0),
    captured: captured || '',
  };
}

function legal(pos) {
  return pseudo(pos).filter((m) => !inCheck(play(pos, m), pos.turn));
}

// Neither side can mate: K v K, K+minor v K, K+B v K+B with bishops on the same colour.
function insufficient(b) {
  const rest = [];
  for (let i = 0; i < 64; i++) if (b[i] && b[i].toLowerCase() !== 'k') rest.push([b[i].toLowerCase(), i]);
  if (!rest.length) return true;
  if (rest.length === 1 && 'nb'.includes(rest[0][0])) return true;
  if (rest.every(([k]) => k === 'b')) {
    const colours = new Set(rest.map(([, i]) => (Math.floor(i / 8) + (i % 8)) % 2));
    return colours.size === 1;
  }
  return false;
}
// Can this side still give mate at all (for a loss on time)?
function canMate(b, side) {
  const mine = [];
  for (let i = 0; i < 64; i++) if (b[i] && colorOf(b[i]) === side && b[i].toLowerCase() !== 'k') mine.push(b[i].toLowerCase());
  if (!mine.length) return false;
  if (mine.length === 1 && 'nb'.includes(mine[0])) return false;
  return true;
}

const key = (pos) => pos.b.map((p) => p || '.').join('') + pos.turn + pos.castle + pos.ep;

// The move in algebraic notation (SAN), e.g. Nf3, exd5, O-O, e8=Q+
function san(pos, m, moves = legal(pos)) {
  const p = pos.b[m.from];
  const k = p.toLowerCase();
  let s;
  if (m.castle) s = m.castle === 'k' ? 'O-O' : 'O-O-O';
  else {
    const capture = !!pos.b[m.to] || m.ep;
    if (k === 'p') s = (capture ? FILES[m.from % 8] + 'x' : '') + nameOf(m.to) + (m.promo ? '=' + m.promo.toUpperCase() : '');
    else {
      const others = moves.filter((o) => o.to === m.to && o.from !== m.from && pos.b[o.from] === p);
      let dis = '';
      if (others.length) {
        if (others.every((o) => o.from % 8 !== m.from % 8)) dis = FILES[m.from % 8];
        else if (others.every((o) => Math.floor(o.from / 8) !== Math.floor(m.from / 8))) dis = String(8 - Math.floor(m.from / 8));
        else dis = nameOf(m.from);
      }
      s = k.toUpperCase() + dis + (capture ? 'x' : '') + nameOf(m.to);
    }
  }
  const next = play(pos, m);
  if (inCheck(next)) s += legal(next).length ? '+' : '#';
  return s;
}

// ---------------- computer player ----------------
const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
// piece-square bonuses from white's view (a8 … h1)
const PST = {
  p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
};
// Score from white's view, in centipawns.
function evaluate(b) {
  let s = 0;
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p) continue;
    const k = p.toLowerCase();
    if (isWhite(p)) s += VALUE[k] + PST[k][i];
    else s -= VALUE[k] + PST[k][(7 - Math.floor(i / 8)) * 8 + (i % 8)];
  }
  return s;
}

const MATE = 100000;
// Best move for the side to move. depth 1–3; `noise` makes weaker play less predictable.
function bestMove(pos, depth = 2, { noise = 0, budget = 60000 } = {}) {
  let nodes = 0;
  const order = (p, ms) => ms
    .map((m) => ({ m, s: (p.b[m.to] ? 10 * VALUE[p.b[m.to].toLowerCase()] - VALUE[p.b[m.from].toLowerCase()] : 0) + (m.promo === 'q' ? 800 : 0) }))
    .sort((a, b) => b.s - a.s).map((x) => x.m);
  const sign = (p) => (p.turn === 'w' ? 1 : -1);
  function quiesce(p, alpha, beta, d) {
    nodes++;
    const stand = sign(p) * evaluate(p.b);
    if (stand >= beta || d <= 0 || nodes > budget) return stand;
    if (stand > alpha) alpha = stand;
    for (const m of order(p, legal(p).filter((x) => p.b[x.to] || x.promo))) {
      const v = -quiesce(play(p, m), -beta, -alpha, d - 1);
      if (v >= beta) return v;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }
  function search(p, d, alpha, beta, ply) {
    nodes++;
    const ms = legal(p);
    if (!ms.length) return inCheck(p) ? -MATE + ply : 0;
    if (d === 0 || nodes > budget) return quiesce(p, alpha, beta, 4);
    let best = -Infinity;
    for (const m of order(p, ms)) {
      const v = -search(play(p, m), d - 1, -beta, -alpha, ply + 1);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }
  const moves = order(pos, legal(pos));
  if (!moves.length) return null;
  let best = moves[0], bestScore = -Infinity;
  for (const m of moves) {
    const v = -search(play(pos, m), depth - 1, -Infinity, Infinity, 1) + (noise ? (Math.random() - 0.5) * noise : 0);
    if (v > bestScore) { bestScore = v; best = m; }
  }
  return { move: best, score: bestScore, nodes };
}

module.exports = { start, legal, play, inCheck, insufficient, canMate, key, san, evaluate, bestMove, sq, nameOf, colorOf, MATE };
