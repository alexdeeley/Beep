// SPIRAL DRAW — rotating arms unwind from the origin, painting persistent cells as they
// sweep. Direction follows circle gestures (clockwise flag).
import { brushT, TAU } from './_util.js';

export default {
  id: 'spiral-draw', name: 'SPIRAL DRAW', description: 'Gestures generate rotating spiral arrangements.',
  kind: 'local', life: 2.2, priority: 1, maxInstances: 4,
  defaults: { arms: 3, turns: 1.6, reach: 14, ink: 0.4, paint: true },
  spawn(inst, ctx) {
    const cw = inst.event?.clockwise ?? true;
    const av = inst.event?.angularVelocity || 6;
    inst.state = { dir: cw ? 1 : -1, t0: brushT(ctx, inst), reachK: Math.min(1.6, 0.6 + av * 0.08), last: new Map() };
  },
  _pt(inst, arm, u) {
    const p = inst.params, s = inst.state;
    const a = s.dir * (u * p.turns * TAU + (arm / p.arms) * TAU + inst.age * 1.2);
    const r = u * p.reach * s.reachK;
    return [inst.fx + Math.cos(a) * r, inst.fy + Math.sin(a) * r];
  },
  update(inst, dt, ctx) {
    const p = inst.params, s = inst.state, g = ctx.grid;
    const u = Math.min(1, inst.t * 1.3);
    for (let arm = 0; arm < p.arms; arm++) {
      const [fx, fy] = this._pt(inst, arm, u);
      const gx = Math.floor(fx), gy = Math.floor(fy);
      const key = arm;
      const prev = s.last.get(key);
      if (prev) ctx.space.forLine(g, prev[0], prev[1], gx, gy, (i) => {
        if (inst.t < 0.77) { g.ink[i] = Math.min(1, g.ink[i] + p.ink); if (p.paint) g.paint[i] = s.t0 + arm / p.arms * 0.3; }
        ctx.energy.inject((i % g.cols) + 0.5, ((i / g.cols) | 0) + 0.5, 0.35, 0.6);
      });
      s.last.set(key, [Math.max(0, Math.min(g.cols - 1, gx)), Math.max(0, Math.min(g.rows - 1, gy))]);
    }
  },
  draw(inst, g) {
    const p = inst.params, s = inst.state; const u1 = Math.min(1, inst.t * 1.3);
    const alpha = 1 - inst.t;
    for (let arm = 0; arm < p.arms; arm++) {
      let [px, py] = this._pt(inst, arm, 0);
      const N = 24;
      for (let k = 1; k <= N; k++) {
        const [fx, fy] = this._pt(inst, arm, (k / N) * u1);
        g.line(px / g.cols, py / g.rows, fx / g.cols, fy / g.rows, { t: s.t0 + arm * 0.1, b: 1, alpha: alpha * (k / N), width: 0.002 });
        px = fx; py = fy;
      }
    }
  },
};
