// MIRROR FIELD — the activation is repeated at its symmetric positions, with a slight
// stagger, so every gesture becomes a symmetric composition.
import { brushT, flashK } from './_util.js';

export default {
  id: 'mirror-field', name: 'MIRROR FIELD', description: 'Changes propagate symmetrically across the canvas.',
  kind: 'local', life: 0.7, priority: 1, maxInstances: 24,
  defaults: { symmetry: null, energy: 0.8, radius: 1.6, stagger: 0.05, paint: true },
  spawn(inst, ctx) {
    const mode = inst.params.symmetry || ctx.look.symmetry || 'quad';
    const pts = ctx.space.mirrorPoints(ctx.grid, inst.gx, inst.gy, mode === 'none' ? 'quad' : mode).slice(1);
    inst.state = { pts, fired: 0, t0: brushT(ctx, inst) };
  },
  update(inst, dt, ctx) {
    const s = inst.state, p = inst.params, g = ctx.grid;
    while (s.fired < s.pts.length && inst.age >= (s.fired + 1) * p.stagger) {
      const [gx, gy] = s.pts[s.fired++];
      ctx.energy.inject(gx + 0.5, gy + 0.5, p.energy, p.radius);
      const i = gy * g.cols + gx;
      g.flash[i] = Math.max(g.flash[i], 0.7 * flashK(ctx));
      if (p.paint) g.paint[i] = s.t0 + s.fired * 0.04;
    }
    const fade = 1 - inst.t;
    for (let k = 0; k < s.fired; k++) {
      const [gx, gy] = s.pts[k];
      ctx.space.forRadius(g, gx + 0.5, gy + 0.5, 1.6, (i) => { ctx.comp.add('bright', i, 0.3 * fade); ctx.comp.setColor(i, s.t0 + k * 0.04, fade, 1); });
    }
  },
  draw(inst, g) {
    const s = inst.state;
    for (let k = 0; k < s.fired; k++) {
      const [gx, gy] = s.pts[k];
      g.shape('diamond', (gx + 0.5) / g.cols, (gy + 0.5) / g.rows, 0.02 + inst.t * 0.05, { t: s.t0 + k * 0.04, b: 1, alpha: 1 - inst.t, stroke: true, lineWidth: 0.002 });
    }
  },
};
