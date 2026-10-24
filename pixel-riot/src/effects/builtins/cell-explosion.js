// CELL EXPLOSION — blocks around the touch split into four quarters that fly apart on a
// damped spring and settle back into place.
import { brushT, ease, motionK } from './_util.js';

export default {
  id: 'cell-explosion', name: 'CELL EXPLOSION', description: 'Blocks divide into smaller pieces that scatter and settle.',
  kind: 'local', life: 1.4, priority: 3, maxInstances: 6,
  defaults: { radius: 3.2, force: 1.2 },
  spawn(inst, ctx) {
    const cells = [];
    ctx.space.forRadius(ctx.grid, inst.fx, inst.fy, inst.params.radius, (i, gx, gy, d) => { if (cells.length < 80) cells.push([i, gx, gy, d]); });
    inst.state = { cells, t0: brushT(ctx, inst) };
    ctx.energy.inject(inst.fx, inst.fy, 0.8, inst.params.radius);
    ctx.particles.burst(inst.x, inst.y, 10, { speed: 0.9, life: 0.7, size: 0.006, t: inst.state.t0 + 0.3, shape: 'streak', drag: 3 });
  },
  update(inst, dt, ctx) {
    // Hide the original blocks while their pieces are in flight.
    const hide = 1 - ease.out(inst.t);
    for (const [i] of inst.state.cells) ctx.comp.add('bright', i, -0.9 * hide);
  },
  draw(inst, g, ctx) {
    const s = inst.state, p = inst.params, m = motionK(ctx);
    const sp = ease.spring(inst.t * 1.6, 7, 0.35);
    const disp = Math.abs(sp) * p.force * m;
    const cw = 1 / g.cols, ch = 1 / g.rows;
    const piece = Math.min(g.width / g.cols, g.height / g.rows) / g.unit * 0.42;
    for (const [i, gx, gy, d] of s.cells) {
      const cx = (gx + 0.5) * cw, cy = (gy + 0.5) * ch;
      const dx = gx + 0.5 - inst.fx, dy = gy + 0.5 - inst.fy; const dl = Math.hypot(dx, dy) || 1;
      const outx = dx / dl, outy = dy / dl;
      const k = (1 - d / (p.radius + 1)) * disp;
      for (let q = 0; q < 4; q++) {
        const qx = q & 1 ? 1 : -1, qy = q & 2 ? 1 : -1;
        const px = cx + (qx * 0.25 + (outx + qx * 0.5) * k) * cw;
        const py = cy + (qy * 0.25 + (outy + qy * 0.5) * k) * ch;
        g.shape('square', px, py, piece * (1 - inst.t * 0.3), { t: s.t0 + d * 0.03, b: 0.95 - inst.t * 0.4, alpha: 1 - inst.t * 0.5, rot: k * qx * 1.5 });
      }
    }
  },
};
