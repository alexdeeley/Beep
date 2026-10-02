import { TAU, background } from '../common.js';

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

export default {
  id: 'spiro',
  medium: 'Spirograph',
  aspects: [[1, 6], [4 / 5, 1], [5 / 4, 1]],
  words: ['Spirograph', 'Loop', 'Harmonic', 'Epicycle', 'Guilloche', 'Orbit', 'Bloom', 'Coil'],
  make({ rng, pal, A }) {
    const K = rng.int(3, 7);
    const curves = [];
    for (let k = 0; k < K; k++) {
      const R = rng.int(5, 11);
      let r = rng.int(2, R - 1);
      if (r === R) r = R - 1;
      const g = gcd(R, r);
      curves.push({
        R, r, turns: r / g, scale: 0.4 * (1 - k * 0.1) * rng.range(0.85, 1.05),
        d: rng.range(0.4, 1.7), dAmp: rng.range(0.05, 0.25), dF: rng.range(0.02, 0.08), dP: rng.float() * TAU,
        spin: rng.sign() * rng.range(0.004, 0.03), ci: rng.int(0, pal.n - 1),
        w: rng.range(0.0025, 0.007), alpha: rng.range(0.55, 0.95),
      });
    }
    const cx = A / 2, cy = 0.5;
    const angle = rng.range(0, Math.PI);
    const pts = 520;
    return (ctx, A2, t) => {
      background(ctx, A2, pal, angle);
      ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = pal.dark ? 'lighter' : 'source-over';
      for (const c of curves) {
        const d = (c.d + Math.sin(TAU * c.dF * t + c.dP) * c.dAmp) * c.r;
        const span = TAU * c.turns;
        const norm = (c.R - c.r) + d;
        ctx.strokeStyle = pal.c(c.ci, c.alpha);
        ctx.lineWidth = c.w;
        ctx.beginPath();
        for (let i = 0; i <= pts; i++) {
          const a = (i / pts) * span;
          const x = (c.R - c.r) * Math.cos(a) + d * Math.cos(((c.R - c.r) / c.r) * a);
          const y = (c.R - c.r) * Math.sin(a) - d * Math.sin(((c.R - c.r) / c.r) * a);
          const rot = c.spin * t * TAU, cs = Math.cos(rot), sn = Math.sin(rot);
          const px = cx + ((x * cs - y * sn) / norm) * c.scale, py = cy + ((x * sn + y * cs) / norm) * c.scale;
          if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    };
  },
};
