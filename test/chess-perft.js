// Perft: count every move sequence to a given depth and compare with the known
// numbers (catches any mistake in castling, en passant, promotion, pins, checks).
const assert = require('assert');
const R = require('../games/chess-rules');
function fen(f) {
  const [board, turn, castle, ep, half, full] = f.split(' ');
  const b = [];
  for (const ch of board.replace(/\//g, '')) { if (/\d/.test(ch)) for (let k = 0; k < Number(ch); k++) b.push(''); else b.push(ch); }
  return { b, turn, castle: castle === '-' ? '' : castle, ep: ep === '-' ? -1 : R.sq(ep), half: Number(half || 0), full: Number(full || 1) };
}
function perft(pos, d) { if (d === 0) return 1; let n = 0; for (const m of R.legal(pos)) n += d === 1 ? 1 : perft(R.play(pos, m), d - 1); return n; }
const cases = [
  ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902]],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],     // "Kiwipete"
  ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],                           // en passant and pins
  ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],            // promotions
];
for (const [f, counts] of cases) counts.forEach((n, i) => assert.strictEqual(perft(fen(f), i + 1), n, `${f} depth ${i + 1}`));
module.exports = { fen, perft };
console.log('chess perft ok');
