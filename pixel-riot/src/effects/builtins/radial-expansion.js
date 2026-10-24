// RADIAL EXPANSION — a two-finger spread pushes the whole field outward from the centroid
// in a widening square shockwave. Keyed so continuous pinches keep feeding it.
import { brushT, ease, motionK } from './_util.js';

export default {
  id: 'radial-expansion', name: 'RADIAL EXPANSION', description: 'The field expands radially from a point (two-finger spread).',
  kind: 'local', life: 1.3, priority: 2, maxInstances: 4,
  defaults: { scale: 1.4, speed: 22, push: 0.9 },
  spawn(inst, ctx) { inst.state = { t0: brushT(ctx, inst), k: Math.min(2.5, Math.max(0.5, (inst.params.scale || 1.4) - 0.3)) }; },
  retrigger(inst, params) { if (params.scale) inst.state.k = Math.min(2.5, Math.max(inst.state.k, params.scale - 0.3)); inst.age = Math.min(inst.age, 0.3); },
  update(inst, dt, ctx) {
    const p = inst.params, s = inst.state, g = ctx.grid, m = motionK(ctx);
    const r = ease.outCubic(inst.t) * p.speed * s.k;
    const fade = 1 - inst.t;
    // Square (Chebyshev) wavefront.
    const R = Math.ceil(r + 2);
    for (let gy = Math.max(0, Math.floor(inst.fy - R)); gy <= Math.min(g.rows - 1, inst.fy + R); gy++) {
      for (let gx = Math.max(0, Math.floor(inst.fx - R)); gx <= Math.min(g.cols - 1, inst.fx + R); gx++) {
        const dx = gx + 0.5 - inst.fx, dy = gy + 0.5 - inst.fy;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        if (d > r + 1.5) continue;
        const i = gy * g.cols + gx;
        const band = Math.max(0, 1 - Math.abs(d - r) / 1.8);
        const inside = d < r ? 0.25 : 0;
        const dl = Math.hypot(dx, dy) || 1;
        ctx.comp.add('ox', i, (dx / dl) * p.push * (band + inside) * fade * m);
        ctx.comp.add('oy', i, (dy / dl) * p.push * (band + inside) * fade * m);
        ctx.comp.add('bright', i, band * 0.8 * fade);
        if (band > 0) ctx.comp.setColor(i, s.t0 + d * 0.02, band * fade, 2);
      }
    }
  },
};
