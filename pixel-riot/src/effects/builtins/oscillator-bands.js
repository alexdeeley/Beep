// OSCILLATOR BANDS — horizontal bands of cells oscillate at harmonically related
// frequencies (1:2:3:4...), like a bank of oscillators. Global ambient effect;
// retriggering it (e.g. from a gesture) adds a burst of amplitude.

export default {
  id: 'oscillator-bands', name: 'OSCILLATOR BANDS', description: 'Bands of cells oscillate at related frequencies.',
  kind: 'global', priority: -1, maxInstances: 1,
  defaults: { bands: 6, base: 0.35, strength: 0.28, scale: 0.18, vertical: false },
  spawn(inst) { inst.state = { boost: 0, ph: 0 }; },
  retrigger(inst) { inst.state.boost = 1; },
  update(inst, dt, ctx) {
    const p = inst.params, s = inst.state, g = ctx.grid;
    s.boost *= Math.exp(-dt * 1.2);
    s.ph += dt * (ctx.a11y.reducedMotion ? 0.4 : 1);
    const amp = p.strength * (1 + s.boost * 2);
    const N = p.vertical ? g.cols : g.rows, M = p.vertical ? g.rows : g.cols;
    for (let a = 0; a < N; a++) {
      const band = Math.floor((a / N) * p.bands);
      const w = Math.sin(s.ph * Math.PI * 2 * p.base * (band + 1));
      for (let b = 0; b < M; b++) {
        const i = p.vertical ? b * g.cols + a : a * g.cols + b;
        const travel = Math.sin(s.ph * 1.3 + (b / M) * Math.PI * 2 * (band + 1));
        ctx.comp.add('bright', i, amp * w * 0.5 * (1 + travel) * 0.5);
        ctx.comp.add('scale', i, p.scale * w * travel);
      }
    }
  },
};
