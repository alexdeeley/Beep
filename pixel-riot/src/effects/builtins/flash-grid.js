// FLASH GRID — controlled flashes march row by row through a region (a scanner).
// Rate-limited: at most one row change every `step` seconds (>= 1/12 s), and reduced-flash
// mode turns flashes into soft glows.
import { brushT, flashK } from './_util.js';

export default {
  id: 'flash-grid', name: 'FLASH GRID', description: 'Brief, controlled flashes travel through a region.',
  kind: 'local', life: 0.9, priority: 2, maxInstances: 4,
  defaults: { half: 5, step: 0.085, every: 2 },
  spawn(inst, ctx) { inst.state = { t0: brushT(ctx, inst) + 0.5 }; },
  update(inst, dt, ctx) {
    const p = inst.params, g = ctx.grid;
    const step = Math.max(1 / 12, p.step);
    const row = Math.floor(inst.age / step) - p.half;
    const fy = inst.gy + row;
    if (fy < 0 || fy >= g.rows || row > p.half) return;
    const fk = flashK(ctx);
    for (let gx = Math.max(0, inst.gx - p.half); gx <= Math.min(g.cols - 1, inst.gx + p.half); gx++) {
      if ((gx + fy) % p.every) continue;
      const i = fy * g.cols + gx;
      ctx.comp.max('flash', i, 0.9 * fk);
      ctx.comp.setColor(i, inst.state.t0, 1, 3);
    }
  },
};
