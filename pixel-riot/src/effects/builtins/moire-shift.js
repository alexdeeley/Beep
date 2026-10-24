// MOIRÉ SHIFT — two fine line gratings at slightly different angles interfere; their beat
// pattern also modulates the cell brightness. Global (ambient) or timed (params.life).
import { TAU } from './_util.js';

export default {
  id: 'moire-shift', name: 'MOIRÉ SHIFT', description: 'Overlapping gratings generate interference that ripples the grid.',
  kind: 'global', priority: -1, maxInstances: 1,
  defaults: { lines: 46, delta: 0.045, speed: 0.12, strength: 0.32, alpha: 0.16, duration: 0 },
  spawn(inst) { inst.state = { a: 0, kick: 0 }; },
  retrigger(inst, params) { inst.state.kick = 1; if (params.delta != null) inst.params.delta = params.delta; },
  update(inst, dt, ctx) {
    const p = inst.params, s = inst.state, g = ctx.grid;
    if (p.duration > 0 && inst.age > p.duration) return false;
    s.kick *= Math.exp(-dt * 1.5);
    s.a += dt * p.speed * (1 + s.kick * 4) * (ctx.a11y.reducedMotion ? 0.3 : 1);
    const d = p.delta * (1 + s.kick);
    const f = p.lines * 0.5;
    const c1 = Math.cos(s.a), s1 = Math.sin(s.a), c2 = Math.cos(s.a + d), s2 = Math.sin(s.a + d);
    const k = Math.min(g.cols, g.rows);
    for (let gy = 0; gy < g.rows; gy++) for (let gx = 0; gx < g.cols; gx++) {
      const u = (gx - g.cols / 2) / k, v = (gy - g.rows / 2) / k;
      const m = Math.cos((u * c1 + v * s1) * f * TAU / 4) * Math.cos((u * c2 + v * s2) * f * TAU / 4);
      ctx.comp.add('bright', gy * g.cols + gx, m * p.strength);
    }
  },
  draw(inst, g) {
    const p = inst.params, s = inst.state;
    if (p.alpha <= 0) return;
    const R = 0.75;
    for (const [ang, tt] of [[s.a, 0], [s.a + p.delta * (1 + s.kick), 0.5]]) {
      const ca = Math.cos(ang), sa = Math.sin(ang);
      for (let k = -p.lines; k <= p.lines; k++) {
        const o = (k / p.lines) * R;
        const cx = 0.5 + (-sa * o * g.unit) / g.width, cy = 0.5 + (ca * o * g.unit) / g.height;
        const ex = (ca * R * g.unit) / g.width, ey = (sa * R * g.unit) / g.height;
        g.line(cx - ex, cy - ey, cx + ex, cy + ey, { t: tt, b: 0.8, alpha: p.alpha * (0.6 + s.kick * 0.4), width: 0.0016 });
      }
    }
  },
};
