// RIPPLE FIELD — concentric waves propagating outward, pushing cells as they pass.
import { brushT, motionK } from './_util.js';

export default {
  id: 'ripple-field', name: 'RIPPLE FIELD', description: 'Concentric waves propagate outward from the touch.',
  kind: 'local', life: 1.8, priority: 0, maxInstances: 16,
  defaults: { rings: 3, speed: 16, width: 1.4, strength: 0.6, gap: 0.14, push: 0.3 },
  spawn(inst, ctx) { inst.state.t0 = brushT(ctx, inst); inst.state.k = 1 + Math.min(1.5, inst.event?.level ?? 0) + Math.min(1, (inst.event?.speed || 0) * 0.3); },
  update(inst, dt, ctx) {
    const p = inst.params, s = inst.state; const m = motionK(ctx);
    for (let k = 0; k < p.rings; k++) {
      const age = inst.age - k * p.gap; if (age <= 0) continue;
      const r = age * p.speed * Math.sqrt(s.k);
      const fade = Math.max(0, 1 - inst.t) * (1 - k * 0.22);
      ctx.space.forRing(ctx.grid, inst.fx, inst.fy, r, p.width, (i, gx, gy, d) => {
        const dx = (gx + 0.5 - inst.fx) / (d || 1), dy = (gy + 0.5 - inst.fy) / (d || 1);
        ctx.comp.add('bright', i, p.strength * fade * s.k * 0.7);
        ctx.comp.add('scale', i, 0.2 * fade);
        ctx.comp.add('ox', i, dx * p.push * fade * m);
        ctx.comp.add('oy', i, dy * p.push * fade * m);
        ctx.comp.add('hue', i, 0.05 * k);
      });
    }
  },
  draw(inst, g) {
    const p = inst.params, s = inst.state;
    for (let k = 0; k < p.rings; k++) {
      const age = inst.age - k * p.gap; if (age <= 0) continue;
      const r = (age * p.speed * Math.sqrt(s.k)) / Math.min(g.cols, g.rows);
      g.ring(inst.x, inst.y, r, { t: s.t0 + k * 0.08, b: 0.9, alpha: (1 - inst.t) * 0.35, width: 0.0025 });
    }
  },
};
