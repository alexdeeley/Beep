import { TAU, background } from '../common.js';

export default {
  id: 'kaleido',
  medium: 'Radial symmetry',
  aspects: [[1, 6], [4 / 3, 1], [3 / 4, 1]],
  words: ['Mandala', 'Bloom', 'Kaleidoscope', 'Rosette', 'Reflection', 'Facets', 'Turning', 'Lotus'],
  make({ rng, pal, A }) {
    const n = rng.pick([4, 5, 6, 6, 8, 8, 10, 12]);
    const wedge = TAU / n;
    const motifs = [];
    const count = rng.int(8, 15);
    for (let i = 0; i < count; i++) {
      motifs.push({
        kind: rng.weighted([['circle', 3], ['petal', 4], ['line', 2], ['tri', 2]]),
        r: rng.range(0.04, 0.5), a: rng.range(0.02, 0.48) * wedge,
        size: rng.range(0.015, 0.09), ci: rng.int(0, pal.n - 1), alpha: rng.range(0.45, 0.9),
        fr: rng.range(0.03, 0.12), fa: rng.range(0.03, 0.12), pr: rng.float() * TAU, pa: rng.float() * TAU,
        dr: rng.range(0.01, 0.07), da: rng.range(0.02, 0.14) * wedge,
      });
    }
    const spin = rng.sign() * rng.range(0.004, 0.02);
    const angle = rng.range(0, Math.PI);
    return (ctx, A2, t) => {
      background(ctx, A2, pal, angle);
      ctx.save();
      ctx.translate(A2 / 2, 0.5);
      ctx.rotate(spin * t * TAU);
      ctx.globalCompositeOperation = pal.dark ? 'lighter' : 'source-over';
      const pos = motifs.map((m) => {
        const r = m.r + Math.sin(TAU * m.fr * t + m.pr) * m.dr;
        const a = m.a + Math.sin(TAU * m.fa * t + m.pa) * m.da;
        return [r * Math.cos(a), r * Math.sin(a), a];
      });
      for (let i = 0; i < n; i++) {
        for (const mirror of [false, true]) {
          ctx.save();
          ctx.rotate(i * wedge);
          if (mirror) ctx.scale(1, -1);
          motifs.forEach((m, k) => {
            const [x, y, a] = pos[k];
            ctx.fillStyle = ctx.strokeStyle = pal.c(m.ci, m.alpha);
            ctx.beginPath();
            if (m.kind === 'circle') ctx.arc(x, y, m.size * 0.7, 0, TAU);
            else if (m.kind === 'petal') ctx.ellipse(x, y, m.size * 1.7, m.size * 0.55, a, 0, TAU);
            else if (m.kind === 'tri') {
              ctx.moveTo(x + Math.cos(a) * m.size * 1.4, y + Math.sin(a) * m.size * 1.4);
              ctx.lineTo(x + Math.cos(a + 2.4) * m.size, y + Math.sin(a + 2.4) * m.size);
              ctx.lineTo(x + Math.cos(a - 2.4) * m.size, y + Math.sin(a - 2.4) * m.size);
              ctx.closePath();
            } else {
              ctx.lineWidth = m.size * 0.18; ctx.lineCap = 'round';
              ctx.moveTo(x - Math.cos(a) * m.size * 1.6, y - Math.sin(a) * m.size * 1.6);
              ctx.lineTo(x + Math.cos(a) * m.size * 1.6, y + Math.sin(a) * m.size * 1.6);
              ctx.stroke(); return;
            }
            ctx.fill();
          });
          ctx.restore();
        }
      }
      ctx.restore();
    };
  },
};
