import { TAU, background } from '../common.js';

export default {
  id: 'constellation',
  medium: 'Point network',
  words: ['Constellation', 'Network', 'Lattice', 'Fireflies', 'Starfield', 'Synapse', 'Cluster', 'Nebula'],
  make({ rng, pal, A }) {
    const n = Math.round(rng.int(50, 105) * Math.max(1, Math.sqrt(A)));
    const maxD = rng.range(0.13, 0.24);
    const pts = [];
    for (let i = 0; i < n; i++) {
      pts.push({
        x: rng.range(0, A), y: rng.range(0, 1),
        ax: rng.range(0.005, 0.05), ay: rng.range(0.005, 0.05),
        fx: rng.range(0.02, 0.12), fy: rng.range(0.02, 0.12),
        px: rng.float() * TAU, py: rng.float() * TAU,
        r: rng.chance(0.12) ? rng.range(0.008, 0.02) : rng.range(0.002, 0.006),
        ci: rng.int(0, pal.n - 1),
      });
    }
    const levels = Array.from({ length: 8 }, (_, i) => pal.ink((i + 1) / 8 * 0.85));
    const angle = rng.range(0, Math.PI);
    const xs = new Float32Array(n), ys = new Float32Array(n);
    const buckets = Array.from({ length: 8 }, () => []);
    const maxD2 = maxD * maxD;
    return (ctx, A2, t) => {
      background(ctx, A2, pal, angle);
      for (let i = 0; i < n; i++) {
        const p = pts[i];
        xs[i] = p.x + Math.sin(TAU * p.fx * t + p.px) * p.ax;
        ys[i] = p.y + Math.cos(TAU * p.fy * t + p.py) * p.ay;
      }
      ctx.lineWidth = 0.0014;
      ctx.lineCap = 'round';
      // One pass over the pairs, sorted into eight brightness batches, so the
      // stroke style changes eight times a frame, not thousands.
      for (const b of buckets) b.length = 0;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = xs[i] - xs[j], dy = ys[i] - ys[j];
          const d2 = dx * dx + dy * dy;
          if (d2 > maxD2) continue;
          const a = Math.pow(1 - Math.sqrt(d2) / maxD, 1.4);
          buckets[Math.min(7, Math.floor(a * 8))].push(i, j);
        }
      }
      for (let lv = 0; lv < 8; lv++) {
        const seg = buckets[lv];
        if (!seg.length) continue;
        ctx.strokeStyle = levels[lv];
        ctx.beginPath();
        for (let k = 0; k < seg.length; k += 2) {
          ctx.moveTo(xs[seg[k]], ys[seg[k]]); ctx.lineTo(xs[seg[k + 1]], ys[seg[k + 1]]);
        }
        ctx.stroke();
      }
      for (let i = 0; i < n; i++) {
        const p = pts[i];
        if (p.r > 0.007) {
          const g = ctx.createRadialGradient(xs[i], ys[i], 0, xs[i], ys[i], p.r * 4);
          g.addColorStop(0, pal.c(p.ci, 0.95));
          g.addColorStop(0.3, pal.c(p.ci, 0.3));
          g.addColorStop(1, pal.c(p.ci, 0));
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(xs[i], ys[i], p.r * 4, 0, TAU); ctx.fill();
        }
        ctx.fillStyle = pal.c(p.ci);
        ctx.beginPath(); ctx.arc(xs[i], ys[i], p.r, 0, TAU); ctx.fill();
      }
    };
  },
};
