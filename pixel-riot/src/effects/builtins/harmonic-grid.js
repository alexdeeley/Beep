// HARMONIC GRID — repeating lattices (every 2nd, 3rd, 4th... row/column) pulse on the
// musical clock's beats and subdivisions. Global ambient effect, beat-synced to the same
// clock the audio engine schedules against.
import { flashK } from './_util.js';

export default {
  id: 'harmonic-grid', name: 'HARMONIC GRID', description: 'Repeating structures pulse with the rhythmic clock.',
  kind: 'global', priority: -1, maxInstances: 1,
  defaults: { strength: 0.5, harmonics: [2, 3, 4, 6] },
  spawn(inst) { inst.state = { accent: 0 }; },
  retrigger(inst) { inst.state.accent = 1; },
  update(inst, dt, ctx) {
    const p = inst.params, g = ctx.grid, s = inst.state;
    s.accent *= Math.exp(-dt * 3);
    const pos = ctx.clock.beatPosition();
    const fk = flashK(ctx);
    p.harmonics.forEach((h, k) => {
      // Each harmonic pulses h times per bar (4 beats), with a sharp attack and decay.
      const ph = (pos / 4) * h; const frac = ph - Math.floor(ph);
      const env = Math.exp(-frac * 7) * p.strength * (1 + s.accent) * fk;
      if (env < 0.02) return;
      const which = Math.floor(ph) % 2;
      const vertical = k % 2 === 0;
      const N = vertical ? g.cols : g.rows;
      for (let a = (which + k) % h; a < N; a += h) {
        if (vertical) for (let y = 0; y < g.rows; y++) ctx.comp.add('bright', y * g.cols + a, env * 0.5);
        else for (let x = 0; x < g.cols; x++) ctx.comp.add('bright', a * g.cols + x, env * 0.5);
      }
    });
  },
};
