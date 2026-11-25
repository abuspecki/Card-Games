/* =========================================================
   Pool physics, shared by the server (which decides) and the
   browser (which replays the same shot to animate it).
   Plain numbers only and a fixed time step, so the same shot from
   the same position gives exactly the same result on both sides.

   The cloth is 200 × 100 units, (0,0) top-left, measured to the
   cushion noses; the head string is at x = 50, the foot spot at
   (150, 50). Balls: 0 = cue, 1–7 solids, 8 = black, 9–15 stripes.

   What makes it feel real:
   · a ball first SLIDES, then ROLLS. Each ball keeps its velocity v
     and its "roll" r (the speed its spin would roll it at). Sliding
     friction pulls v and r together; once they match the ball rolls
     and only slows gently. A centre hit slides into the object ball
     and stops (stun), a high hit follows through, a low hit draws back.
   · side spin (english) changes the angle off a cushion.
   · cushions lose speed and spin; pockets have jaws — a ball that is
     slightly off can rattle out.
   ========================================================= */
(function () {
  const W = 200, H = 100, R = 2.4;
  const DT = 1 / 600;            // s per step
  const SLIDE = 150;             // units/s²: sliding friction (cloth)
  const ROLL = 24;               // units/s²: rolling resistance
  const SPIN_DECAY = 9;          // units/s²: side spin dies away
  const STOP = 0.5;              // a rolling ball slower than this stops
  const BALL_E = 0.95;           // ball-ball restitution
  const RAIL_E = 0.74;           // cushion restitution
  const MAX_T = 30;              // s: a shot never runs longer
  const HEAD_X = 50, FOOT = { x: 150, y: 50 };
  const MIN_SPEED = 25, MAX_SPEED = 560;

  // ----- the table: cushion lines with pocket jaws, and the pocket holes -----
  const CM = 6.6;                // corner mouth: cushions stop this far from the corner
  const SM = 5.6;                // side mouth half-width
  const segs = [];
  const seg = (ax, ay, bx, by) => segs.push([ax, ay, bx, by]);
  // long rails (top / bottom), each split by the side pocket
  for (const y of [0, H]) { seg(CM, y, 100 - SM, y); seg(100 + SM, y, W - CM, y); }
  // short rails (left / right)
  for (const x of [0, W]) seg(x, CM, x, H - CM);
  // corner jaws: from the cushion end, angled into the pocket
  const out = 3.6, inward = 3.2;
  for (const [cx, cy, sx, sy] of [[0, 0, 1, 1], [W, 0, -1, 1], [0, H, 1, -1], [W, H, -1, -1]]) {
    seg(cx + sx * CM, cy, cx + sx * (CM - inward), cy - sy * out);         // along the long rail
    seg(cx, cy + sy * CM, cx - sx * out, cy + sy * (CM - inward));         // along the short rail
  }
  // side jaws: they narrow a little towards the hole
  for (const [y, sy] of [[0, 1], [H, -1]]) {
    seg(100 - SM, y, 100 - SM + 1.4, y - sy * 3.6);
    seg(100 + SM, y, 100 + SM - 1.4, y - sy * 3.6);
  }
  const POCKETS = [
    { x: -1.8, y: -1.8, r: 5.0 }, { x: 100, y: -3.4, r: 4.6 }, { x: W + 1.8, y: -1.8, r: 5.0 },
    { x: -1.8, y: H + 1.8, r: 5.0 }, { x: 100, y: H + 3.4, r: 4.6 }, { x: W + 1.8, y: H + 1.8, r: 5.0 },
  ];

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const speedOf = (power) => MIN_SPEED + clamp(power, 0, 1) * (MAX_SPEED - MIN_SPEED);

  // A fresh rack: 1 at the apex, 8 in the middle, a solid and a stripe in the back corners.
  function rack(rand = Math.random) {
    const solids = [2, 3, 4, 5, 6, 7], stripes = [9, 10, 11, 12, 13, 14, 15];
    const pick = (arr) => arr.splice(Math.floor(rand() * arr.length), 1)[0];
    const backSolid = pick(solids), backStripe = pick(stripes);
    const rest = [...solids, ...stripes];
    const balls = [{ n: 0, x: HEAD_X - 10, y: 50, down: false }];
    for (let k = 0; k < 5; k++) for (let j = 0; j <= k; j++) {
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
   * balls: [{ n, x, y, down }]
   * shot: { angle (radians), power (0–1), spin: { x: side −1…1, y: follow(+)/draw(−) −1…1 } }
   * record: also return frames ({ t, p: [[n, x, y], …] }) every 1/60 s for the animation.
   * Returns { balls, events: { first, rail, pocketed: [{ n, pocket, t }], cueDown, hits: [t…], cushions: [t…] }, duration, frames }.
   */
  function simulate(start, shot, { record = false } = {}) {
    const balls = start.map((b) => ({ n: b.n, x: b.x, y: b.y, vx: 0, vy: 0, rx: 0, ry: 0, s: 0, down: !!b.down, rolling: true }));
    const cue = balls.find((b) => b.n === 0);
    const v = speedOf(shot.power);
    const dx = Math.cos(shot.angle), dy = Math.sin(shot.angle);
    let sx = clamp(Number(shot.spin && shot.spin.x) || 0, -1, 1), sy = clamp(Number(shot.spin && shot.spin.y) || 0, -1, 1);
    const sl = Math.hypot(sx, sy);
    if (sl > 1) { sx /= sl; sy /= sl; }
    cue.vx = dx * v; cue.vy = dy * v;
    cue.rx = dx * v * 1.25 * sy; cue.ry = dy * v * 1.25 * sy;    // high = follow, low = draw, centre = stun
    cue.s = -v * 0.55 * sx;                                       // side spin (right english = clockwise)
    cue.rolling = false;
    const ev = { first: null, rail: false, pocketed: [], cueDown: false, hits: [], cushions: [] };
    const frames = [];
    const snap = (t) => frames.push({ t, p: balls.filter((b) => !b.down).map((b) => [b.n, Math.round(b.x * 100) / 100, Math.round(b.y * 100) / 100]) });
    const pocket = (b, pi, t) => {
      b.down = true; b.vx = b.vy = b.rx = b.ry = b.s = 0;
      ev.pocketed.push({ n: b.n, pocket: pi, t });
      if (b.n === 0) ev.cueDown = true;
    };
    let t = 0, step = 0;
    const every = Math.round(1 / 60 / DT);
    if (record) snap(0);
    while (t < MAX_T) {
      let moving = false;
      for (const b of balls) {
        if (b.down) continue;
        // ----- friction: slide towards rolling, then roll -----
        if (!b.rolling) {
          const px = b.vx - b.rx, py = b.vy - b.ry, slip = Math.hypot(px, py);
          if (slip < 0.8) b.rolling = true;
          else {
            const ux = px / slip, uy = py / slip, d = SLIDE * DT;
            const nvx = b.vx - ux * d, nvy = b.vy - uy * d, nrx = b.rx + ux * d * 2.5, nry = b.ry + uy * d * 2.5;
            if ((nvx - nrx) * px + (nvy - nry) * py <= 0) {
              // the slip would reverse: it rolls now, at (5v + 2r) / 7
              b.vx = (5 * b.vx + 2 * b.rx) / 7; b.vy = (5 * b.vy + 2 * b.ry) / 7; b.rolling = true;
            } else { b.vx = nvx; b.vy = nvy; b.rx = nrx; b.ry = nry; }
          }
        }
        if (b.rolling) {
          const sp = Math.hypot(b.vx, b.vy);
          if (sp < STOP) { b.vx = b.vy = 0; }
          else { const k = Math.max(0, sp - ROLL * DT) / sp; b.vx *= k; b.vy *= k; }
          b.rx = b.vx; b.ry = b.vy;
        }
        if (b.s) b.s = Math.sign(b.s) * Math.max(0, Math.abs(b.s) - SPIN_DECAY * DT);
        if (b.vx === 0 && b.vy === 0 && b.rolling) continue;
        moving = true;
        b.x += b.vx * DT; b.y += b.vy * DT;
        // ----- pockets -----
        let gone = false;
        for (let pi = 0; pi < POCKETS.length; pi++) {
          const p = POCKETS[pi];
          if ((b.x - p.x) ** 2 + (b.y - p.y) ** 2 < p.r * p.r) { pocket(b, pi, t); gone = true; break; }
        }
        if (gone) continue;
        if (b.x < -9 || b.x > W + 9 || b.y < -9 || b.y > H + 9) {      // never lost: into the nearest pocket
          let best = 0, bd = Infinity;
          POCKETS.forEach((p, pi) => { const d = (b.x - p.x) ** 2 + (b.y - p.y) ** 2; if (d < bd) { bd = d; best = pi; } });
          pocket(b, best, t); continue;
        }
        // ----- cushions and jaws -----
        for (const [ax, ay, bx, by] of segs) {
          const ex = bx - ax, ey = by - ay, len2 = ex * ex + ey * ey;
          let u = ((b.x - ax) * ex + (b.y - ay) * ey) / len2;
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          const cx = ax + ex * u, cy = ay + ey * u;
          const ox = b.x - cx, oy = b.y - cy, d2 = ox * ox + oy * oy;
          if (d2 >= R * R || d2 === 0) continue;
          const d = Math.sqrt(d2), nx = ox / d, ny = oy / d;       // from the cushion to the ball
          const vn = b.vx * nx + b.vy * ny;
          b.x = cx + nx * R; b.y = cy + ny * R;
          if (vn >= 0) continue;
          const tx = -ny, ty = nx;                                   // along the cushion
          const vt = b.vx * tx + b.vy * ty;
          const e = RAIL_E - Math.min(0.12, -vn / 2500);              // harder hits bounce a little less
          const english = clamp(b.s * 0.32, -Math.abs(vn) * 0.6, Math.abs(vn) * 0.6);
          const nvt = vt * 0.96 + english;
          b.vx = nx * (-vn * e) + tx * nvt; b.vy = ny * (-vn * e) + ty * nvt;
          // the spin keeps turning the old way: the ball slides off the cushion and settles into its new roll
          const rn = b.rx * nx + b.ry * ny, rt = b.rx * tx + b.ry * ty;
          b.rx = nx * rn * 0.5 + tx * rt * 0.9; b.ry = ny * rn * 0.5 + ty * rt * 0.9;
          b.s *= 0.5;
          b.rolling = false;
          if (ev.first !== null) ev.rail = true;
          if (-vn > 8) ev.cushions.push(t);
        }
      }
      // ----- ball against ball -----
      for (let i = 0; i < balls.length; i++) {
        const a = balls[i];
        if (a.down) continue;
        for (let j = i + 1; j < balls.length; j++) {
          const b = balls[j];
          if (b.down) continue;
          const ddx = b.x - a.x, ddy = b.y - a.y;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 >= 4 * R * R || d2 === 0) continue;
          const d = Math.sqrt(d2), nx = ddx / d, ny = ddy / d;
          const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
          if (rel > 0) {
            const imp = rel * (1 + BALL_E) / 2;
            a.vx -= imp * nx; a.vy -= imp * ny;
            b.vx += imp * nx; b.vy += imp * ny;
            a.rolling = false; b.rolling = false;     // the spin stays: follow, draw or stun play out now
            moving = true;
            if (imp > 6) ev.hits.push(t);
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

  const Pool = { W, H, R, POCKETS, SEGMENTS: segs, HEAD_X, FOOT, rack, simulate, canPlace, firstContact, speedOf, MIN_SPEED, MAX_SPEED, ROLL };
  if (typeof module !== 'undefined' && module.exports) module.exports = Pool;
  else globalThis.PoolPhysics = Pool;
})();
