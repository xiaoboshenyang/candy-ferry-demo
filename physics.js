// 割绳子母题 demo 共用物理：页面试玩与离线求解器跑同一份代码，固定步长保证同一操作得到同一结果。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RopePhysics = factory();
})(this, function () {
  'use strict';
  const W = 1280, H = 728, GRAVITY = 1030, STEP = 1 / 120, CANDY_R = 18, SPIKE_HALF = 11;
  const STAR_R = 16;
  const foxMask = typeof module === 'object' && module.exports
    ? require('./goal-contact.js') : globalThis.BowlContact;
  if (!foxMask) throw Error('Fox contact mask is required before physics.js');
  // 阻尼偏大：摆动几秒内明显衰减，玩家总可以“等它停下来再切”。
  const DAMPING = 0.998;

  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    return dist(px, py, ax + t * dx, ay + t * dy);
  }

  function createWorld(level) {
    const [cx, cy] = level.candy;
    return {
      t: 0, steps: 0, status: 'playing', reason: '',
      candy: { x: cx, y: cy, vx: 0, vy: 0, r: CANDY_R },
      // 固定绳：不写长度即初始拉直；写长度且大于距离即为松绳。
      ropes: level.ropes.map(([x, y, len], i) => ({
        id: String.fromCharCode(65 + i), x, y, len: len || dist(cx, cy, x, y), active: true, circle: false
      })),
      // 自动挂绳圈：糖果中心进入圈内时自动挂上一根绳，长度为进入时的距离。
      circles: (level.circles || []).map(([x, y, r], i) => ({ id: '圈' + (i + 1), x, y, r, used: false })),
      spikes: level.spikes || [],
      goal: level.goal,
      stars: (level.stars || []).map(([x, y], i) => ({ id: i, x, y, collected: false }))
    };
  }

  function clone(w) {
    return {
      t: w.t, steps: w.steps, status: w.status, reason: w.reason,
      candy: { ...w.candy },
      ropes: w.ropes.map(r => ({ ...r })),
      circles: w.circles.map(c => ({ ...c })),
      spikes: w.spikes, goal: w.goal, stars: w.stars.map(s => ({ ...s }))
    };
  }

  function step(w) {
    if (w.status !== 'playing') return;
    const c = w.candy, dt = STEP, previous = {x: w.candy.x, y: w.candy.y};
    c.vy += GRAVITY * dt;
    c.x += c.vx * dt; c.y += c.vy * dt;
    c.vx *= DAMPING; c.vy *= DAMPING;
    for (let pass = 0; pass < 4; pass++) {
      for (const r of w.ropes) {
        if (!r.active) continue;
        const dx = c.x - r.x, dy = c.y - r.y, len = Math.hypot(dx, dy);
        if (len > r.len) {
          const nx = dx / len, ny = dy / len;
          c.x = r.x + nx * r.len; c.y = r.y + ny * r.len;
          const out = c.vx * nx + c.vy * ny;
          if (out > 0) { c.vx -= out * nx; c.vy -= out * ny; }
        }
      }
    }
    for (const k of w.circles) {
      if (k.used) continue;
      const d = dist(c.x, c.y, k.x, k.y);
      if (d <= k.r) {
        k.used = true;
        w.ropes.push({ id: k.id, x: k.x, y: k.y, len: Math.max(d, 12), active: true, circle: true });
      }
    }
    w.t += dt; w.steps++;
    for (const [ax, ay, bx, by] of w.spikes) {
      if (segDist(c.x, c.y, ax, ay, bx, by) < c.r + SPIKE_HALF) { w.status = 'lost'; w.reason = 'spike'; return; }
    }
    for (const s of w.stars) {
      if (!s.collected && dist(c.x, c.y, s.x, s.y) <= c.r + STAR_R) s.collected = true;
    }
    if (foxMask.hit(c, w.goal, previous)) {
      w.status = 'won'; return;
    }
    if (c.y > H || c.x < 0 || c.x > W) { w.status = 'lost'; w.reason = 'fall'; }
  }

  function cut(w, id) {
    const r = w.ropes.find(x => x.id === id && x.active);
    if (r) r.active = false;
    return !!r;
  }

  const activeRopes = w => w.ropes.filter(r => r.active);

  return { W, H, STEP, CANDY_R, SPIKE_HALF, STAR_R, dist, segDist, createWorld, clone, step, cut, activeRopes };
});
