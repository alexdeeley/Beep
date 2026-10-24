// CHARGE FIELD — long-press energy buildup. Keyed per gesture: every 'hold:charge' event
// retriggers it with the new level; a retrigger with { released: true } discharges the
// stored energy as a shockwave (ripple + burst + chain pulse).
import { brushT, TAU, flashK } from './_util.js';

export default {
  id: 'charge-field', name: 'CHARGE FIELD', description: 'Long press builds an energy field that is released on lift.',
  kind: 'local', life: 8, priority: 4, maxInstances: 6,
  defaults: { level: 0, maxRadius: 7, released: false },
  spawn(inst, ctx) { inst.state = { level: inst.params.level || 0, t0: brushT(ctx, inst), spin: 0 }; if (inst.params.released) this._release(inst, ctx); },
  retrigger(inst, params, ctx) {
    if (params.level != null) inst.state.level = Math.max(inst.state.level, params.level);
    if (params.x != null) { inst.x = params.x; inst.y = params.y; inst.fx = params.x * ctx.grid.cols; inst.fy = params.y * ctx.grid.rows; }
    if (params.released) this._release(inst, ctx);
    if (params.cancelled) inst.state.dead = true;
  },
  _release(inst, ctx) {
    const L = 0.3 + inst.state.level;
    ctx.energy.inject(inst.fx, inst.fy, 1.5 * L, 2 + inst.state.level * inst.params.maxRadius * 0.6);
    ctx.particles.burst(inst.x, inst.y, Math.round(20 + 50 * inst.state.level), { speed: 0.4 + L * 0.9, life: 1.1, size: 0.009, t: inst.state.t0, shape: 'streak', drag: 1.8 });
    ctx.spawn('ripple-field', { rings: 4, speed: 14 + L * 10, strength: 0.6 + L * 0.4, t: inst.state.t0 }, { x: inst.x, y: inst.y, event: { level: inst.state.level, speed: 0 } });
    if (inst.state.level > 0.45) ctx.spawn('cellular-pulse', { level: L, t: inst.state.t0 + 0.3 }, { x: inst.x, y: inst.y });
    ctx.comp.global.shakeX += (ctx.rng.next() - 0.5) * 14 * L;
    ctx.emit('effect:discharge', { x: inst.x, y: inst.y, level: inst.state.level });
    inst.state.dead = true;
  },
  update(inst, dt, ctx) {
    const s = inst.state, p = inst.params;
    if (s.dead) return false;
    s.spin += dt * (2 + s.level * 10);
    const R = 1 + s.level * p.maxRadius;
    const pulse = 0.5 + 0.5 * Math.sin(s.spin * 2);
    ctx.space.forRadius(ctx.grid, inst.fx, inst.fy, R, (i, gx, gy, d) => {
      const f = 1 - d / (R + 0.5);
      ctx.comp.add('bright', i, (0.15 + 0.45 * s.level) * f * (0.6 + 0.4 * pulse));
      ctx.comp.add('scale', i, -0.25 * s.level * f);   // cells contract as energy gathers
      ctx.comp.setColor(i, s.t0 + s.level * 0.3, f * s.level, 2);
    });
    const ci = inst.gy * ctx.grid.cols + inst.gx;
    ctx.comp.max('flash', ci, (0.3 + 0.5 * s.level) * pulse * flashK(ctx));
    ctx.comp.global.shakeX += (ctx.rng.next() - 0.5) * s.level * s.level * 3;
    ctx.comp.global.shakeY += (ctx.rng.next() - 0.5) * s.level * s.level * 3;
  },
  draw(inst, g) {
    const s = inst.state; if (s.dead) return;
    const R = (1 + s.level * inst.params.maxRadius) / Math.min(g.cols, g.rows);
    for (let k = 0; k < 3; k++) {
      const ph = ((s.spin * 0.25 + k / 3) % 1);
      g.ring(inst.x, inst.y, R * (1 - ph), { t: s.t0 + k * 0.1, b: 1, alpha: ph * (0.3 + s.level * 0.6), width: 0.002 + s.level * 0.003 });
    }
    g.shape('starburst', inst.x, inst.y, 0.02 + s.level * 0.05, { t: s.t0 + 0.5, b: 1, alpha: 0.5 + s.level * 0.5, rot: s.spin % TAU });
  },
};
