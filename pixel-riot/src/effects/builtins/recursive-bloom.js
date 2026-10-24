// RECURSIVE BLOOM — a shape spawns four half-size children at its corners, recursively,
// each generation appearing a beat later.
import { brushT, ease } from './_util.js';

export default {
  id: 'recursive-bloom', name: 'RECURSIVE BLOOM', description: 'Shapes create smaller nested shapes that bloom outward.',
  kind: 'local', life: 1.8, priority: 1, maxInstances: 5,
  defaults: { depth: 4, size: 0.16, shape: 'nested', stagger: 0.12 },
  spawn(inst, ctx) {
    const nodes = [];
    const rec = (x, y, s, d) => { nodes.push([x, y, s, d]); if (d < inst.params.depth) for (const [qx, qy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) rec(x + qx * s * 0.75, y + qy * s * 0.75, s / 2, d + 1); };
    rec(0, 0, inst.params.size, 0);
    inst.state = { nodes, t0: brushT(ctx, inst) };
    ctx.energy.inject(inst.fx, inst.fy, 0.6, 2);
  },
  update(inst, dt, ctx) {
    const s = inst.state, g = ctx.grid, p = inst.params;
    for (const [x, y, sz, d] of s.nodes) {
      const tt = (inst.age - d * p.stagger) / (inst.life * 0.6);
      if (tt <= 0 || tt > 1.6) continue;
      // Light the cell under each node.
      const nx = inst.x + x * (Math.min(g.cols, g.rows) / g.cols);
      const ny = inst.y + y * (Math.min(g.cols, g.rows) / g.rows);
      if (nx < 0 || ny < 0 || nx >= 1 || ny >= 1) continue;
      const i = Math.floor(ny * g.rows) * g.cols + Math.floor(nx * g.cols);
      ctx.comp.add('bright', i, 0.6 * ease.bell(tt / 1.6));
      ctx.comp.setColor(i, s.t0 + d * 0.11, 0.8, 1);
    }
  },
  draw(inst, g) {
    const s = inst.state, p = inst.params;
    for (const [x, y, sz, d] of s.nodes) {
      const tt = (inst.age - d * p.stagger) / (inst.life * 0.6);
      if (tt <= 0) continue;
      const grow = ease.outCubic(Math.min(1, tt));
      const alpha = Math.max(0, 1 - inst.t) * (1 - d * 0.12);
      g.shape(p.shape, inst.x + (x * g.unit) / g.width, inst.y + (y * g.unit) / g.height, sz * grow, { t: s.t0 + d * 0.11, b: 1, alpha, rot: d * 0.4 * grow, stroke: true, lineWidth: 0.0025 });
    }
  },
};
