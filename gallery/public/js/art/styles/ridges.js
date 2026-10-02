import { TAU } from '../common.js';

export default {
  id: 'ridges',
  medium: 'Ridgeline',
  aspects: [[3 / 4, 3], [1, 3], [4 / 3, 2], [2 / 3, 2]],
  words: ['Signal', 'Pulse', 'Frequency', 'Topography', 'Strata', 'Sounding', 'Spectrum', 'Waveform'],
  make({ rng, pal, noise, A }) {
    const lines = rng.int(26, 54);
    const amp = rng.range(0.07, 0.17);
    const fx = rng.range(1.5, 4.2), fy = rng.range(0.08, 0.2);
    const bumpX = rng.range(0.3, 0.7) * A, bumpW = rng.range(0.18, 0.45) * A;
    const speed = rng.range(0.01, 0.05);
    const top = rng.range(0.08, 0.2), bottom = rng.range(0.88, 0.97);
    const mode = rng.pick(['ink', 'gradient', 'mono']);
    const c0 = rng.int(0, pal.n - 1), c1 = (c0 + rng.int(1, 4)) % pal.n;
    const w = rng.range(0.0022, 0.005);
    const samples = 170;
    return (ctx, A2, t) => {
      ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, A2, 1);
      ctx.lineJoin = 'round';
      ctx.lineWidth = w;
      for (let l = 0; l < lines; l++) {
        const f = l / (lines - 1);
        const y0 = top + (bottom - top) * f;
        ctx.beginPath();
        for (let i = 0; i <= samples; i++) {
          const x = (i / samples) * A2;
          const d = (x - bumpX) / bumpW;
          const bump = Math.exp(-d * d);
          const n = noise.fbm(x * fx, l * fy + t * speed * 3, 3) * 0.5 + 0.5;
          const y = y0 - amp * bump * n * (0.5 + f * 0.9);
          if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        // Each line hides the ones behind it.
        ctx.save();
        ctx.lineTo(A2, 1.2); ctx.lineTo(0, 1.2); ctx.closePath();
        ctx.fillStyle = pal.bg; ctx.fill();
        ctx.restore();
        ctx.strokeStyle = mode === 'ink' ? pal.ink(0.9) : mode === 'mono' ? pal.c(c0, 0.95) : pal.mix(c0, c1, f);
        ctx.stroke();
      }
    };
  },
};
