// Calculates win chances in the background so the table never stutters.
importScripts('/engine.js');

const SIMS = { holdem: 3000, omaha: 1200, omaha5: 800 };

self.onmessage = (e) => {
  const { id, hole, board, variant, opponents } = e.data;
  const { simulateOdds, bestHand } = self.PokerEngine;
  const odds = simulateOdds(hole, board, variant, Math.max(1, opponents), SIMS[variant] || 1000);
  const current = board.length >= 3 ? bestHand(hole, board, variant) : null;
  self.postMessage({ id, ...odds, currentCat: current ? current.cat : null });
};
