/* =========================================================
   Pool physics, shared by the server (which decides) and the
   browser (which replays the same shot to animate it).
   Plain numbers only and a fixed time step, so the same shot from
   the same position gives exactly the same result on both sides.

   The cloth is 200 × 100 units, (0,0) top-left; the head string is
   at x = 50, the foot spot at (150, 50). Balls: 0 = cue, 1–7 solids,
   8 = the black, 9–15 stripes.
   ========================================================= */
(function () {
  const W = 200, H = 100, R = 2.4;
  const CORNER_R = 5.4, SIDE_R = 4.6;          // pocket capture radius
  const POCKETS = [
    { x: 0, y: 0, r: CORNER_R }, { x: 100, y: -1.6, r: SIDE_R }, { x: 200, y: 0, r: CORNER_R },
    { x: 0, y: 100, r: CORNER_R }, { x: 100, y: 101.6, r: SIDE_R }, { x: 200, y: 100, r: CORNER_R },
  ];
  const DT = 1 / 600;            // s per step
  const FRICTION = 52;           // units/s² of slowing on the cloth
  const STOP = 0.6;              // below this speed a ball stops
  const BALL_E = 0.94;           // ball-ball restitution
  const RAIL_E = 0.76;           // cushion restitution
  const MAX_T = 25;              // s: a shot never runs longer
  const HEAD_X = 50, FOOT = { x: 150, y: 50 };
  const MIN_SPEED = 30, MAX_SPEED = 400;

  const speedOf = (power) => MIN_SPEED + Math.max(0, Math.min(1, power)) * (MAX_SPEED - MIN_SPEED);

  // Near a pocket the cushion opens: the ball may go on into the pocket.
  function inMouth(x, y) {
    if ((x < CORNER_R + 1 || x > W - CORNER_R - 1) && (y < CORNER_R + 1 || y > H - CORNER_R - 1)) return true;
    if ((y < SIDE_R || y > H - SIDE_R) && Math.abs(x - 100) < SIDE_R) return true;
    return false;
  }

  // A fresh rack: 1 at the apex, 8 in the middle, a solid and a stripe in the back corners.
  function rack(rand = Math.random) {
    const solids = [2, 3, 4, 5, 6, 7], stripes = [9, 10, 11, 12, 13, 14, 15];
    const pick = (arr) => arr.splice(Math.floor(rand() * arr.length), 1)[0];
    const backSolid = pick(solids), backStripe = pick(stripes);
    const rest = [...solids, ...stripes];
    const order = [];
    for (let k = 0; k < 5; k++) for (let j = 0; j <= k; j++) order.push([k, j]);
    const balls = [{ n: 0, x: HEAD_X - 10, y: 50, down: false }];
    for (const [k, j] of order) {
      let n;
      if (k === 0) n = 1;
      else if (k === 2 && j === 1) n = 8;
      else if (k === 4 && j === 0) n = rand() < 0.5 ? backSolid : backStripe;
      else if (k === 4 && j === 4) n = balls.some((b) => b.n === backSolid) ? backStripe : backSolid;
      else n = pick(rest);
      balls.push({ n, x: FOOT.x + k * R * Math.sqrt(3) * 1.002, y: FOOT.y + (j - k / 2) * 2 * R * 1.002, down: false });
    }
    return balls.sort((a, b) => a.n - b.n);
  }

  // Can the cue ball be put here (on the cloth, not touching another ball)?
  function canPlace(balls, x, y, kitchen) {
    if (!(x >= R && x <= W - R && y >= R && y <= H - R)) return false;
    if (kitchen && x > HEAD_X) return false;
    return balls.every((b) => b.n === 0 || b.down || (b.x - x) ** 2 + (b.y - y) ** 2 >= (2 * R + 0.05) ** 2);
  }

  /**
   * Play a shot to the end.
   * balls: [{ n, x, y, down }]   shot: { angle (radians), power (0–1) }
   * record: also return frames ({ t, p: [[n, x, y], …] }) every 1/60 s for the animation.
   * Returns { balls, events: { first, rail, pocketed: [{ n, pocket }], cueDown }, duration, frames }.
   */
  function simulate(start, shot, { record = false } = {}) {
    const balls = start.map((b) => ({ n: b.n, x: b.x, y: b.y, vx: 0, vy: 0, down: !!b.down }));
    const cue = balls.find((b) => b.n === 0);
    const v = speedOf(shot.power);
    cue.vx = Math.cos(shot.angle) * v;
    cue.vy = Math.sin(shot.angle) * v;
    const ev = { first: null, rail: false, pocketed: [], cueDown: false, firstRail: false };
    const frames = [];
    const snap = (t) => frames.push({ t, p: balls.filter((b) => !b.down).map((b) => [b.n, Math.round(b.x * 100) / 100, Math.round(b.y * 100) / 100]) });
    let t = 0, step = 0;
    const every = Math.round(1 / 60 / DT);
    if (record) snap(0);
    while (t < MAX_T) {
      let moving = false;
      for (const b of balls) {
        if (b.down) continue;
        const sp = Math.hypot(b.vx, b.vy);
        if (sp === 0) continue;
        if (sp < STOP) { b.vx = 0; b.vy = 0; continue; }
        moving = true;
        const k = Math.max(0, sp - FRICTION * DT) / sp;
        b.vx *= k; b.vy *= k;
        b.x += b.vx * DT; b.y += b.vy * DT;
        // pockets
        for (let pi = 0; pi < POCKETS.length; pi++) {
          const p = POCKETS[pi];
          if ((b.x - p.x) ** 2 + (b.y - p.y) ** 2 < p.r * p.r) {
            b.down = true; b.vx = 0; b.vy = 0;
            ev.pocketed.push({ n: b.n, pocket: pi, t });
            if (b.n === 0) ev.cueDown = true;
            break;
          }
        }
        if (b.down) continue;
        // cushions (open at the pocket mouths)
        if (!inMouth(b.x, b.y)) {
          let hit = false;
          if (b.x < R) { b.x = R; b.vx = -b.vx * RAIL_E; hit = true; }
          else if (b.x > W - R) { b.x = W - R; b.vx = -b.vx * RAIL_E; hit = true; }
          if (b.y < R) { b.y = R; b.vy = -b.vy * RAIL_E; hit = true; }
          else if (b.y > H - R) { b.y = H - R; b.vy = -b.vy * RAIL_E; hit = true; }
          if (hit && ev.first !== null) ev.rail = true;
        } else if (b.x < -R || b.x > W + R || b.y < -R - 2 || b.y > H + R + 2) {
          // through the mouth: into the nearest pocket
          let best = 0, bd = Infinity;
          POCKETS.forEach((p, pi) => { const d = (b.x - p.x) ** 2 + (b.y - p.y) ** 2; if (d < bd) { bd = d; best = pi; } });
          b.down = true; b.vx = 0; b.vy = 0;
          ev.pocketed.push({ n: b.n, pocket: best, t });
          if (b.n === 0) ev.cueDown = true;
        }
      }
      // ball against ball
      for (let i = 0; i < balls.length; i++) {
        const a = balls[i];
        if (a.down) continue;
        for (let j = i + 1; j < balls.length; j++) {
          const b = balls[j];
          if (b.down) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= 4 * R * R || d2 === 0) continue;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
          const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
          if (rel > 0) {
            const imp = rel * (1 + BALL_E) / 2;
            a.vx -= imp * nx; a.vy -= imp * ny;
            b.vx += imp * nx; b.vy += imp * ny;
            moving = true;
            if (ev.first === null && (a.n === 0 || b.n === 0)) ev.first = a.n === 0 ? b.n : a.n;
          }
          const push = (2 * R - d) / 2;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
        }
      }
      t += DT; step++;
      if (record && step % every === 0) snap(t);
      if (!moving) break;
    }
    if (record) snap(t);
    return {
      balls: balls.map((b) => ({ n: b.n, x: Math.round(b.x * 1000) / 1000, y: Math.round(b.y * 1000) / 1000, down: b.down })),
      events: ev, duration: t, frames,
    };
  }

  // Where the cue ball would first touch a ball along a line (for the aiming guide and the bot).
  function firstContact(balls, from, angle) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    let best = null;
    for (const b of balls) {
      if (b.down || b.n === 0) continue;
      const fx = b.x - from.x, fy = b.y - from.y;
      const along = fx * dx + fy * dy;
      if (along <= 0) continue;
      const perp2 = fx * fx + fy * fy - along * along;
      if (perp2 >= 4 * R * R) continue;
      const dist = along - Math.sqrt(4 * R * R - perp2);
      if (!best || dist < best.dist) best = { ball: b, dist, x: from.x + dx * dist, y: from.y + dy * dist };
    }
    return best;
  }

  const Pool = { W, H, R, POCKETS, HEAD_X, FOOT, rack, simulate, canPlace, firstContact, speedOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = Pool;
  else globalThis.PoolPhysics = Pool;
})();
