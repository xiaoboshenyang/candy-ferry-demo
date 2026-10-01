// “停稳再切”求解器：每次都等糖果静止后才切一根，穷举所有选择。
// 适老主口径——题目必须在不抢时机的前提下可解；也用它算“乱切成功率”（每个静止点均匀随机选一根）。
const P = typeof module === 'object' && module.exports ? require('./physics.js') : globalThis.RopePhysics;

const SETTLE_SPEED = 6, SETTLE_STEPS = 30, MAX_WAIT = Math.round(60 / P.STEP);

// 推进到静止或结束；返回 'won' | 'lost' | 'settled' | 'stuck'
function settle(w) {
  let calm = 0;
  for (let i = 0; i < MAX_WAIT; i++) {
    P.step(w);
    if (w.status !== 'playing') return w.status;
    const v = Math.hypot(w.candy.vx, w.candy.vy);
    calm = v < SETTLE_SPEED ? calm + 1 : 0;
    if (calm >= SETTLE_STEPS && P.activeRopes(w).length) return 'settled';
  }
  return 'stuck';
}

function staticSolveWorld(initial, maxDepth = 8) {
  let nodes = 0;
  function rec(w, depth) {
    nodes++;
    const s = settle(w);
    if (s === 'won') return { p: 1, min: 0, path: [], steps: [], solvedAt: w.t, complete: true };
    if (s !== 'settled' || depth >= maxDepth) return { p: 0, min: Infinity, path: null, reason: s === 'lost' ? w.reason : s, complete: s === 'lost' };
    const opts = P.activeRopes(w).map(r => {
      const nxt = P.clone(w);
      const t = +nxt.t.toFixed(3);
      P.cut(nxt, r.id);
      const sub = rec(nxt, depth + 1);
      return { ...sub, rope: r.id, t };
    });
    const p = opts.reduce((a, o) => a + o.p, 0) / opts.length;
    const good = opts.filter(o => o.path).sort((a, b) => a.min - b.min);
    const best = good[0];
    return {
      p, complete: opts.every(o => o.complete), min: best ? best.min + 1 : Infinity,
      path: best ? [{ rope: best.rope, t: best.t }].concat(best.path) : null,
      // 解法路径上每一步：有几个选项、其中几个必死（关键决策 = 有必死选项的一步）
      steps: best ? [{ choices: opts.length, dead: opts.filter(o => o.complete && o.p === 0).length }].concat(best.steps) : null,
      choices: opts.length, deadChoices: opts.filter(o => o.complete && o.p === 0).length,
      tree: opts.map(o => ({ rope: o.rope, p: +o.p.toFixed(3), reason: o.reason, complete: o.complete })),
      solvedAt: best?.solvedAt
    };
  }
  const r = rec(P.clone(initial), 0);
  return { solvable: !!r.path, complete: r.complete, minCuts: r.path ? r.min : null, pRandom: +r.p.toFixed(4), path: r.path, solveSeconds: r.solvedAt, keyDecisions: r.steps ? r.steps.filter(x => x.dead > 0).length : 0, steps: r.steps, rootChoices: r.choices, rootDead: r.deadChoices, rootTree: r.tree, nodes };
}

const staticSolve = (level, maxDepth = 8) => staticSolveWorld(P.createWorld(level), maxDepth);
const api = { settle, staticSolve, staticSolveWorld };
if (typeof module === 'object' && module.exports) module.exports = api;
else globalThis.RopeSolver = api;

