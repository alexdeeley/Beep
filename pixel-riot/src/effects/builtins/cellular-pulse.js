// CELLULAR PULSE — a chain reaction: neighbours respond with delayed pulses that branch
// outward under the instrument's chain settings (radius, delay, decay, bias, symmetry...).
import { brushT, flashK } from './_util.js';

export default {
  id: 'cellular-pulse', name: 'CELLULAR PULSE', description: 'Neighbouring cells respond with delayed, branching pulses.',
  kind: 'local', life: 4, priority: 0, maxInstances: 8,
  defaults: { level: 1, energy: 0.55, chain: null },
  spawn(inst, ctx) {
    const t0 = brushT(ctx, inst) + 0.2;
    const e = inst.event;
    const bias = e && e.speed > 0.3 ? [Math.cos(e.direction), Math.sin(e.direction)] : null;
    const params = { ...(inst.params.chain || {}) };
    if (bias && params.biasStrength == null) { params.bias = bias; params.biasStrength = 0.6; }
    const g = ctx.grid; const fk = flashK(ctx);
    inst.state.chain = ctx.chain.start({
      gx: inst.gx, gy: inst.gy, level: inst.params.level * (1 + (e?.level || 0)), params, owner: inst.owner, colorT: t0,
      onActivate: (gx, gy, level, depth, chain) => {
        const i = gy * g.cols + gx;
        ctx.energy.inject(gx + 0.5, gy + 0.5, inst.params.energy * level, 0.6);
        g.flash[i] = Math.max(g.flash[i], 0.55 * level * fk);
        const ci = chain.p.colorInherit;
        if (ci > 0) { const cur = g.paint[i] < 0 ? t0 + depth * 0.03 : g.paint[i]; g.paint[i] = cur + (t0 + depth * 0.03 - cur) * ci; }
      },
    });
  },
  update(inst) { return !inst.state.chain.stopped; },
  cancel(inst, ctx) { ctx.chain.stop(inst.state.chain); },
};
