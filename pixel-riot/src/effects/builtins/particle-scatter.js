// PARTICLE SCATTER — energised cells near the origin emit particles along their current
// or radially, throughout the effect's short life.
import { brushT } from './_util.js';

export default {
  id: 'particle-scatter', name: 'PARTICLE SCATTER', description: 'Activated cells emit particles.',
  kind: 'local', life: 0.35, priority: 0, maxInstances: 20,
  defaults: { radius: 3, rate: 90, speed: 0.5, shape: 'streak' },
  spawn(inst, ctx) { inst.state = { acc: 0, t0: brushT(ctx, inst) }; },
  update(inst, dt, ctx) {
    const p = inst.params, s = inst.state, g = ctx.grid;
    s.acc += dt * p.rate;
    let n = Math.floor(s.acc); s.acc -= n;
    let guard = 0;
    while (n > 0 && guard++ < 40) {
      const a = ctx.rng.next() * Math.PI * 2, r = ctx.rng.next() * p.radius;
      const gx = Math.floor(inst.fx + Math.cos(a) * r), gy = Math.floor(inst.fy + Math.sin(a) * r);
      if (!g.inBounds(gx, gy)) continue;
      const i = gy * g.cols + gx; const e = g.energy[i];
      if (e < 0.08) continue;
      n--;
      const vx = g.vx[i] || Math.cos(a) * p.speed, vy = g.vy[i] || Math.sin(a) * p.speed;
      ctx.particles.emit({ x: (gx + 0.5) / g.cols, y: (gy + 0.5) / g.rows, vx: vx * 0.6 + Math.cos(a) * p.speed * e, vy: vy * 0.6 + Math.sin(a) * p.speed * e, life: 0.5 + e * 0.4, size: 0.006 + e * 0.004, t: s.t0 + e * 0.2, shape: p.shape, drag: 2.2 });
    }
  },
};
