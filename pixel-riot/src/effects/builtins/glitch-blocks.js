// GLITCH BLOCKS — rectangular slabs near the touch jump sideways by whole cells in
// discrete steps, split their colour, then snap home. Bounded: <= `blocks` slabs.
import { brushT, motionK } from './_util.js';

export default {
  id: 'glitch-blocks', name: 'GLITCH BLOCKS', description: 'Cells briefly shift or split according to bounded rules.',
  kind: 'local', life: 0.75, priority: 2, maxInstances: 5,
  defaults: { blocks: 5, spread: 7, maxShift: 3, stepTime: 0.09 },
  spawn(inst, ctx) {
    const p = inst.params, r = ctx.rng, g = ctx.grid;
    const blocks = [];
    for (let k = 0; k < p.blocks; k++) {
      const w = r.int(2, 7), h = r.int(1, 3);
      blocks.push({ x: Math.round(inst.gx + r.range(-p.spread, p.spread) - w / 2), y: Math.round(inst.gy + r.range(-p.spread, p.spread)), w, h, seed: r.next() });
    }
    inst.state = { blocks, t0: brushT(ctx, inst), g };
  },
  update(inst, dt, ctx) {
    const p = inst.params, g = ctx.grid, m = motionK(ctx);
    const step = Math.floor(inst.age / p.stepTime);
    for (const b of inst.state.blocks) {
      const h = Math.sin((step + 1) * 12.9898 + b.seed * 78.233) * 43758.5453;
      const r = h - Math.floor(h);
      const shift = r < 0.35 ? 0 : Math.round((r - 0.5) * 2 * p.maxShift);
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
        if (!g.inBounds(x, y)) continue;
        const i = y * g.cols + x;
        ctx.comp.add('ox', i, shift * m);
        ctx.comp.add('bright', i, 0.35 + (r > 0.8 ? 0.4 : 0));
        ctx.comp.setColor(i, inst.state.t0 + (shift > 0 ? 0.33 : 0.66), 0.9, 2);
      }
    }
  },
};
