// COLOR CASCADE — a front of colour sweeps outward and permanently repaints the cells it
// crosses, stepping through the palette with distance. Undoable artwork change.
import { brushT } from './_util.js';

export default {
  id: 'color-cascade', name: 'COLOR CASCADE', description: 'Neighbouring cells transition through the palette and keep the new colour.',
  kind: 'local', life: 1.3, priority: 3, maxInstances: 10,
  defaults: { radius: 9, step: 0.035, persist: true, paintStrength: 1 },
  spawn(inst, ctx) {
    const sp = inst.event?.speed || 0;
    inst.state.t0 = brushT(ctx, inst) + 0.25;
    inst.state.R = inst.params.radius * (0.7 + Math.min(1.6, sp * 0.4));
    inst.state.done = 0;
  },
  update(inst, dt, ctx) {
    const p = inst.params, s = inst.state, g = ctx.grid;
    const r = inst.t * s.R;
    ctx.space.forRing(ctx.grid, inst.fx, inst.fy, r, 1.6, (i, gx, gy, d) => {
      const t = s.t0 + d * p.step;
      ctx.comp.setColor(i, t, 1, 4);
      ctx.comp.add('bright', i, 0.35 * (1 - inst.t));
      if (p.persist) {
        const cur = g.paint[i];
        g.paint[i] = cur < 0 ? t : cur + (t - cur) * p.paintStrength;
      }
    });
  },
};
