// INFINITE CORRIDOR — perspective-like nested rectangles stream toward the touch point,
// lighting the cells along each rectangle's perimeter as it passes.
import { brushT } from './_util.js';

export default {
  id: 'infinite-corridor', name: 'INFINITE CORRIDOR', description: 'Nested rectangles recede toward a vanishing point.',
  kind: 'local', life: 2.6, priority: 0, maxInstances: 3,
  defaults: { frames: 7, speed: 0.55, strength: 0.6 },
  spawn(inst, ctx) { inst.state = { t0: brushT(ctx, inst) }; },
  // z in (0,1]: 1 = screen edge, -> 0 at the vanishing point.
  _rect(inst, z) {
    return [inst.x * (1 - z), inst.y * (1 - z), inst.x + (1 - inst.x) * z, inst.y + (1 - inst.y) * z];
  },
  update(inst, dt, ctx) {
    const p = inst.params, g = ctx.grid; const fade = Math.sin(Math.PI * inst.t);
    for (let k = 0; k < p.frames; k++) {
      const z = 1 - (((inst.age * p.speed) + k / p.frames) % 1);
      const zz = z * z;
      const [x0, y0, x1, y1] = this._rect(inst, zz);
      const gx0 = Math.floor(x0 * g.cols), gx1 = Math.min(g.cols - 1, Math.floor(x1 * g.cols));
      const gy0 = Math.floor(y0 * g.rows), gy1 = Math.min(g.rows - 1, Math.floor(y1 * g.rows));
      const b = p.strength * fade * (0.35 + zz);
      for (let x = gx0; x <= gx1; x++) { ctx.comp.add('bright', gy0 * g.cols + x, b); ctx.comp.add('bright', gy1 * g.cols + x, b); }
      for (let y = gy0 + 1; y < gy1; y++) { ctx.comp.add('bright', y * g.cols + gx0, b); ctx.comp.add('bright', y * g.cols + gx1, b); }
    }
  },
  draw(inst, g) {
    const p = inst.params; const fade = Math.sin(Math.PI * inst.t);
    for (let k = 0; k < p.frames; k++) {
      const z = 1 - (((inst.age * p.speed) + k / p.frames) % 1);
      const zz = z * z;
      const [x0, y0, x1, y1] = this._rect(inst, zz);
      const o = { t: inst.state.t0 + k * 0.06, b: 1, alpha: fade * 0.5 * zz, width: 0.0012 + zz * 0.003 };
      g.line(x0, y0, x1, y0, o); g.line(x1, y0, x1, y1, o); g.line(x1, y1, x0, y1, o); g.line(x0, y1, x0, y0, o);
    }
  },
};
