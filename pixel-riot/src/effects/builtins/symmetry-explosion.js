// SYMMETRY EXPLOSION — one activation stamps a small random motif and all of its
// 8-fold mirror images as persistent paint + shapes, each copy bursting as it lands.
import { brushT, flashK } from './_util.js';

export default {
  id: 'symmetry-explosion', name: 'SYMMETRY EXPLOSION', description: 'One activation creates a mirrored composition.',
  kind: 'local', life: 0.9, priority: 3, maxInstances: 4,
  defaults: { motif: 7, spread: 3, symmetry: 'radial8', stagger: 0.035 },
  spawn(inst, ctx) {
    const r = ctx.rng, p = inst.params, g = ctx.grid;
    const motif = [];
    for (let k = 0; k < p.motif; k++) motif.push([inst.gx + r.int(-p.spread, p.spread), inst.gy + r.int(-p.spread, p.spread), r.int(0, 7)]);
    const stamps = [];
    for (const [mx, my, shape] of motif) {
      if (!g.inBounds(mx, my)) continue;
      for (const [x, y] of ctx.space.mirrorPoints(g, mx, my, p.symmetry)) stamps.push([x, y, shape]);
    }
    inst.state = { stamps, n: 0, t0: brushT(ctx, inst) };
  },
  update(inst, dt, ctx) {
    const s = inst.state, g = ctx.grid, p = inst.params, fk = flashK(ctx);
    const target = Math.min(s.stamps.length, Math.floor(inst.age / p.stagger) * 8 + 8);
    while (s.n < target) {
      const [x, y, shape] = s.stamps[s.n++];
      const i = y * g.cols + x;
      g.paint[i] = s.t0 + (shape % 3) * 0.15;
      g.shape[i] = shape;
      g.ink[i] = Math.min(1, g.ink[i] + 0.6);
      g.flash[i] = Math.max(g.flash[i], 0.8 * fk);
      ctx.energy.inject(x + 0.5, y + 0.5, 0.5, 1);
    }
  },
};
