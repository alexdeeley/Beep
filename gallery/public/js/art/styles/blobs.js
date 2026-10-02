import { TAU, background } from '../common.js';

export default {
  id: 'blobs',
  medium: 'Soft light',
  words: ['Glow', 'Bloom', 'Haze', 'Lumen', 'Reverie', 'Aura', 'Vapour', 'Daydream', 'Sundown'],
  make({ rng, pal, A }) {
    const n = rng.int(5, 9);
    const blobs = [];
    for (let i = 0; i < n; i++) {
      blobs.push({
        x: rng.range(0.05, A - 0.05), y: rng.range(0.05, 0.95),
        ax: rng.range(0.04, 0.22), ay: rng.range(0.04, 0.22),
        fx: rng.range(0.015, 0.06), fy: rng.range(0.015, 0.06),
        px: rng.float() * TAU, py: rng.float() * TAU,
        r: rng.range(0.28, 0.7), ci: rng.int(0, pal.n - 1), a: rng.range(0.55, 0.95),
      });
    }
    const discs = [];
    for (let i = 0, k = rng.int(1, 3); i < k; i++) {
      discs.push({
        x: rng.range(0.15, A - 0.15), y: rng.range(0.15, 0.85), r: rng.range(0.05, 0.16),
        ax: rng.range(0.01, 0.05), fx: rng.range(0.02, 0.05), p: rng.float() * TAU,
        ci: rng.int(0, pal.n - 1),
      });
    }
    const angle = rng.range(0, Math.PI);
    return (ctx, A2, t) => {
      background(ctx, A2, pal, angle);
      ctx.save();
      ctx.globalCompositeOperation = pal.dark ? 'lighter' : 'multiply';
      for (const b of blobs) {
        const x = b.x + Math.sin(TAU * b.fx * t + b.px) * b.ax;
        const y = b.y + Math.cos(TAU * b.fy * t + b.py) * b.ay;
        const g = ctx.createRadialGradient(x, y, 0, x, y, b.r);
        g.addColorStop(0, pal.c(b.ci, b.a));
        g.addColorStop(0.55, pal.c(b.ci, b.a * 0.35));
        g.addColorStop(1, pal.c(b.ci, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, A2, 1);
      }
      ctx.restore();
      for (const d of discs) {
        const x = d.x + Math.sin(TAU * d.fx * t + d.p) * d.ax, y = d.y + Math.cos(TAU * d.fx * t + d.p) * d.ax;
        ctx.fillStyle = pal.c(d.ci, 0.88);
        ctx.beginPath(); ctx.arc(x, y, d.r, 0, TAU); ctx.fill();
      }
    };
  },
};
