// DIRECTIONAL SWEEP — a straight wavefront launched in the gesture's direction of travel.
// params.reverse flips it (used by reverse-drag mappings).
import { brushT, gestureDir, motionK } from './_util.js';

export default {
  id: 'directional-sweep', name: 'DIRECTIONAL SWEEP', description: 'A wavefront travels across the grid in the swipe direction.',
  kind: 'local', life: 1.4, priority: 1, maxInstances: 8,
  defaults: { speed: 40, width: 2.2, strength: 0.8, spin: 0.9, reach: 120 },
  spawn(inst, ctx) {
    const [dx, dy, a] = gestureDir(inst);
    inst.state = { dx, dy, a, t0: brushT(ctx, inst) + 0.1, k: 0.7 + Math.min(1.5, (inst.event?.speed || 1) * 0.35) };
  },
  update(inst, dt, ctx) {
    const p = inst.params, s = inst.state, g = ctx.grid, m = motionK(ctx);
    const front = inst.age * p.speed * s.k;
    const fade = 1 - inst.t;
    // Visit the band of cells whose projection onto the direction is near `front`.
    for (let gy = 0; gy < g.rows; gy++) {
      for (let gx = 0; gx < g.cols; gx++) {
        const rx = gx + 0.5 - inst.fx, ry = gy + 0.5 - inst.fy;
        const along = rx * s.dx + ry * s.dy;
        const dd = Math.abs(along - front);
        if (dd > p.width) continue;
        const across = Math.abs(rx * -s.dy + ry * s.dx);
        if (across > p.reach * 0.5) continue;
        const f = (1 - dd / p.width) * fade;
        const i = gy * g.cols + gx;
        ctx.comp.add('bright', i, p.strength * f);
        ctx.comp.add('ox', i, s.dx * 0.45 * f * m);
        ctx.comp.add('oy', i, s.dy * 0.45 * f * m);
        ctx.comp.add('rot', i, p.spin * f);
        ctx.comp.setColor(i, s.t0 + along * 0.01, f * 0.8, 1);
      }
    }
  },
};
