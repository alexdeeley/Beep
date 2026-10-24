// CHECKERBOARD WARP — a swipe drags a region of the grid along its path; the region's
// checker parity inverts and the cells spring back elastically.
import { brushT, ease, motionK } from './_util.js';

export default {
  id: 'checkerboard-warp', name: 'CHECKERBOARD WARP', description: 'A swipe bends and inverts a checkerboard region that springs back.',
  kind: 'local', life: 1.5, priority: 1, maxInstances: 8,
  defaults: { radius: 6, pull: 1.3 },
  spawn(inst, ctx) {
    const e = inst.event || {};
    const sp = Math.min(3, e.speed || 1);
    inst.state = { dx: Math.cos(e.direction || 0), dy: Math.sin(e.direction || 0), k: 0.5 + sp * 0.4, t0: brushT(ctx, inst) };
  },
  update(inst, dt, ctx) {
    const p = inst.params, s = inst.state, m = motionK(ctx);
    const sp = ease.spring(inst.t * 1.4, 8, 0.3);
    ctx.space.forRadius(ctx.grid, inst.fx, inst.fy, p.radius, (i, gx, gy, d) => {
      const fall = Math.pow(1 - d / (p.radius + 0.5), 2);
      ctx.comp.add('ox', i, s.dx * p.pull * s.k * sp * fall * m);
      ctx.comp.add('oy', i, s.dy * p.pull * s.k * sp * fall * m);
      const parity = (gx + gy) & 1;
      ctx.comp.add('bright', i, (parity ? 0.55 : -0.35) * fall * (1 - inst.t));
      if (parity) ctx.comp.setColor(i, s.t0 + 0.5, fall * (1 - inst.t), 1);
    });
  },
};
