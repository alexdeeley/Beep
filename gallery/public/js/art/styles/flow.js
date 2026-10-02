import { TAU, clamp, easeOut, background } from '../common.js';

export default {
  id: 'flow',
  medium: 'Flow field',
  words: ['Current', 'Drift', 'Tide', 'Wind', 'Streams', 'Meander', 'Eddy', 'Breeze', 'Murmur'],
  make({ rng, pal, noise, A }) {
    const scale = rng.range(0.9, 2.8);
    const swirl = rng.range(1.2, 3.4);
    const base = rng.float() * TAU;
    const warp = rng.range(0, 0.7);
    const field = (x, y) =>
      base + noise.fbm(x * scale + 10, y * scale + 10, 3) * TAU * swirl * 0.5 + warp * noise(x * scale * 3, y * scale * 3) * 3;

    const count = Math.round(rng.int(260, 460) * Math.max(1, A * 0.8));
    const steps = rng.int(70, 150), h = rng.range(0.004, 0.008);
    const regionScale = rng.range(0.8, 2);
    const lines = [];
    for (let i = 0; i < count; i++) {
      let x = rng.range(-0.05, A + 0.05), y = rng.range(-0.05, 1.05);
      const ci = Math.min(pal.n - 1, Math.floor((noise(x * regionScale, y * regionScale) * 0.5 + 0.5) * pal.n));
      const pts = [x, y];
      for (let s = 0; s < steps; s++) {
        const a = field(x, y);
        x += Math.cos(a) * h; y += Math.sin(a) * h;
        pts.push(x, y);
        if (x < -0.2 || x > A + 0.2 || y < -0.2 || y > 1.2) break;
      }
      if (pts.length < 14) continue;
      const alpha = rng.range(0.45, 0.9);
      lines.push({
        pts,
        // three brightness levels to shimmer between, made once, not per frame
        styles: [pal.c(rng.chance(0.85) ? ci : ci + 2, alpha * 0.7), pal.c(ci, alpha), pal.c(ci, Math.min(1, alpha * 1.25))],
        w: rng.range(0.0018, 0.0052),
        delay: rng.float() * 0.55,
        phase: rng.float() * TAU,
      });
    }
    const angle = rng.range(0.4, 2.6);

    return (ctx, A2, t) => {
      background(ctx, A2, pal, angle);
      const grow = clamp(t / 9);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const l of lines) {
        const p = easeOut(clamp((grow - l.delay * 0.6) / 0.4));
        const n = Math.floor(p * (l.pts.length / 2));
        if (n < 2) continue;
        ctx.strokeStyle = l.styles[1 + Math.round(Math.sin(t * 0.7 + l.phase) * 0.7 * (grow > 0.95 ? 1 : 0))];
        ctx.lineWidth = l.w;
        ctx.beginPath();
        ctx.moveTo(l.pts[0], l.pts[1]);
        for (let i = 1; i < n; i++) ctx.lineTo(l.pts[i * 2], l.pts[i * 2 + 1]);
        ctx.stroke();
      }
    };
  },
};
