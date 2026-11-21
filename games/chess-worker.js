// Runs the chess computer player off the main thread, so a long think never
// holds up the other tables. Message in: { id, pos, depth, noise, budget }.
const { parentPort } = require('worker_threads');
const R = require('./chess-rules');
parentPort.on('message', ({ id, pos, depth, noise, budget }) => {
  let out = null;
  try {
    const r = R.bestMove(pos, depth, { noise, budget });
    out = r ? { from: r.move.from, to: r.move.to, promo: r.move.promo || '' } : null;
  } catch (e) { out = null; }
  parentPort.postMessage({ id, move: out });
});
