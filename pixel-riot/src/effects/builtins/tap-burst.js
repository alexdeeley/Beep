// TAP BURST — a sharp geometric burst: energy spike, ray star, spinning square, sparks.
import { TAU, brushT, flashK, ease } from './_util.js';

export default {
  id: 'tap-burst', name: 'TAP BURST', description: 'Sharp geometric burst at the touch point.',
  kind: 'local', life: 0.5, priority: 2, maxInstances: 30,
  defaults: { radius: 2.2, energy: 1.1, rays: 8, sparks: 14, shape: 'hollow' },
  spawn(inst, ctx) {
    const p = inst.params; const k = (inst.event?.pressure ?? 0.5) * 0.6 + 0.7;
    inst.state.t0 = brushT(ctx, inst);
    inst.state.k = k;
    ctx.energy.inject(inst.fx, inst.fy, p.energy * k, p.radius);
    const i = inst.gy * ctx.grid.cols + inst.gx;
    ctx.grid.flash[i] = Math.max(ctx.grid.flash[i], 1 * flashK(ctx));
    ctx.particles.burst(inst.x, inst.y, Math.round(p.sparks * k), { speed: 0.55, life: 0.6, size: 0.008, t: inst.state.t0, drag: 4 });
  },
  update(inst, dt, ctx) {
    const r = 0.5 + ease.outCubic(inst.t) * inst.params.radius * 2.2;
    const fade = 1 - inst.t;
    ctx.space.forRing(ctx.grid, inst.fx, inst.fy, r, 1.4, (i) => {
      ctx.comp.add('bright', i, 0.55 * fade * inst.state.k);
      ctx.comp.add('scale', i, 0.25 * fade);
      ctx.comp.setColor(i, inst.state.t0 + 0.12, fade, 2);
    });
  },
  draw(inst, g) {
    const t = inst.t, s = inst.state, p = inst.params;
    const len = 0.02 + ease.outCubic(t) * 0.1 * s.k;
    for (let k = 0; k < p.rays; k++) {
      const a = (k / p.rays) * TAU + t * 0.6;
      const r0 = len * 0.35;
      g.line(inst.x + Math.cos(a) * r0 / g.width * g.unit, inst.y + Math.sin(a) * r0 / g.height * g.unit,
        inst.x + Math.cos(a) * len / g.width * g.unit, inst.y + Math.sin(a) * len / g.height * g.unit,
        { t: s.t0, b: 1, alpha: 1 - t, width: 0.004 * (1 - t) + 0.001 });
    }
    g.shape(p.shape, inst.x, inst.y, 0.03 + t * 0.07, { t: s.t0 + 0.5, b: 1, alpha: (1 - t) * 0.9, rot: t * 2.2, stroke: true, lineWidth: 0.003 });
  },
};
