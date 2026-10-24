// ENERGY TRAIL — drags leave fading geometric trails AND a persistent ink mark, and set the
// local current (vx, vy) that the DRIFT energy behaviour follows.
import { brushT } from './_util.js';

export default {
  id: 'energy-trail', name: 'ENERGY TRAIL', description: 'Swipes leave fading geometric trails and persistent ink.',
  kind: 'local', life: 0.9, priority: 0, maxInstances: 90,
  defaults: { energy: 0.7, ink: 0.35, radius: 0.9, paint: true, shape: 'square' },
  spawn(inst, ctx) {
    const e = inst.event || {}; const g = ctx.grid; const p = inst.params;
    const cells = e.cells && e.cells.length ? e.cells : [{ i: inst.gy * g.cols + inst.gx, gx: inst.gx, gy: inst.gy }];
    const t0 = brushT(ctx, inst);
    const sp = Math.min(3, e.speed || 0.5);
    const pres = e.pressure ?? 0.5;
    for (const c of cells) {
      if (c.i >= g.count) continue;
      ctx.energy.inject(c.gx + 0.5, c.gy + 0.5, p.energy * (0.6 + sp * 0.25) * (0.6 + pres * 0.8), p.radius);
      g.ink[c.i] = Math.min(1, g.ink[c.i] + p.ink);
      g.vx[c.i] = (e.velocityX || 0); g.vy[c.i] = (e.velocityY || 0);
      if (p.paint) g.paint[c.i] = t0;
    }
    inst.state = { x0: inst.x - (e.velocityX || 0) * 0.016 * g.rows / g.cols, y0: inst.y - (e.velocityY || 0) * 0.016, t0, w: 0.003 + sp * 0.003 };
  },
  update() {},
  draw(inst, g) {
    const s = inst.state; const a = 1 - inst.t;
    g.line(s.x0, s.y0, inst.x, inst.y, { t: s.t0, b: 1, alpha: a * 0.8, width: s.w * a + 0.001 });
    if (inst.params.shape) g.shape(inst.params.shape, inst.x, inst.y, 0.012 * a, { t: s.t0 + 0.5, b: 1, alpha: a * 0.6, rot: inst.age * 4, stroke: true, lineWidth: 0.0015 });
  },
};
