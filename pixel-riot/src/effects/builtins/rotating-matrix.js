// ROTATING MATRIX — a local disc of blocks orbits and spins around a point, then springs
// back. Keyed instances follow continuous rotation input (two-finger rotate).
import { brushT, ease, motionK } from './_util.js';

export default {
  id: 'rotating-matrix', name: 'ROTATING MATRIX', description: 'Local blocks rotate around a point and settle back.',
  kind: 'local', life: 1.6, priority: 1, maxInstances: 6,
  defaults: { radius: 5, angle: 1.4, spin: 1.6 },
  spawn(inst, ctx) {
    inst.state = { t0: brushT(ctx, inst), angle: inst.params.angle * (inst.event?.clockwise === false ? -1 : 1) };
    if (inst.event?.rotation != null) inst.state.angle = inst.event.rotation * 2;
  },
  retrigger(inst, params) {
    inst.age = Math.min(inst.age, 0.15);
    if (inst.params.follow != null) inst.state.angle = inst.params.follow * 2;
    if (params.x != null) { inst.x = params.x; inst.y = params.y; }
  },
  update(inst, dt, ctx) {
    const p = inst.params, s = inst.state, g = ctx.grid, m = motionK(ctx);
    // Rotation amount: rises quickly then springs back to rest.
    const amt = inst.age < 0.2 ? ease.out(inst.age / 0.2) : ease.spring((inst.age - 0.2) / (inst.life - 0.2) * 1.5, 6, 0.4);
    const a = s.angle * amt * m;
    const ca = Math.cos(a), sa = Math.sin(a);
    const fx = inst.x * g.cols, fy = inst.y * g.rows;
    ctx.space.forRadius(g, fx, fy, p.radius, (i, gx, gy, d) => {
      const fall = 1 - d / (p.radius + 0.5);
      const rx = gx + 0.5 - fx, ry = gy + 0.5 - fy;
      const nx = rx * ca - ry * sa, ny = rx * sa + ry * ca;
      ctx.comp.add('ox', i, (nx - rx) * fall);
      ctx.comp.add('oy', i, (ny - ry) * fall);
      ctx.comp.add('rot', i, a * p.spin * fall);
      ctx.comp.add('bright', i, 0.25 * fall * Math.abs(amt));
      ctx.comp.setColor(i, s.t0 + d * 0.02, fall * 0.6 * Math.abs(amt), 0);
    });
  },
};
