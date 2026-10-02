import { TAU, background } from '../common.js';

export default {
  id: 'rings',
  medium: 'Orbital rings',
  aspects: [[1, 5], [4 / 3, 2], [3 / 4, 1], [5 / 4, 2]],
  words: ['Orbit', 'Echo', 'Ripple', 'Halo', 'Eclipse', 'Resonance', 'Cycle', 'Aperture', 'Totem'],
  make({ rng, pal, A }) {
    const cx = A * rng.range(0.38, 0.62), cy = rng.range(0.4, 0.6);
    const rmax = Math.hypot(Math.max(cx, A - cx), Math.max(cy, 1 - cy)) * rng.range(0.82, 1);
    const count = rng.int(10, 24), r0 = rng.range(0.035, 0.09);
    const spread = rng.range(0.85, 1.35);
    const cap = rng.chance(0.6) ? 'round' : 'butt';
    const guides = rng.chance(0.7);
    const rings = [];
    for (let i = 0; i < count; i++) {
      const r = r0 + (rmax - r0) * Math.pow(i / (count - 1), spread);
      const thick = rng.chance(0.3);
      const arcs = [];
      const k = rng.int(1, 4);
      const w = rng.range(0.004, thick ? 0.034 : 0.014);
      const speed = rng.sign() * rng.range(0.012, 0.09) / (0.4 + r);
      for (let j = 0; j < k; j++) {
        arcs.push({ a: rng.float() * TAU, sweep: rng.range(0.35, 3.6) / Math.sqrt(k), ci: rng.int(0, pal.n - 1), w: w * rng.range(0.7, 1.2) });
      }
      const dot = rng.chance(0.38) ? { a: rng.float() * TAU, r: rng.range(0.008, 0.022), ci: rng.int(0, pal.n - 1) } : null;
      rings.push({ r, arcs, speed, dot });
    }
    const sunC = rng.int(0, pal.n - 1);
    const angle = rng.range(0, Math.PI);

    return (ctx, A2, t) => {
      background(ctx, A2, pal, angle);
      if (guides) {
        ctx.strokeStyle = pal.ink(0.08);
        ctx.lineWidth = 0.0012;
        for (const ring of rings) { ctx.beginPath(); ctx.arc(cx, cy, ring.r, 0, TAU); ctx.stroke(); }
      }
      ctx.lineCap = cap;
      for (const ring of rings) {
        const rot = ring.speed * t * TAU;
        for (const a of ring.arcs) {
          ctx.strokeStyle = pal.c(a.ci, 0.92);
          ctx.lineWidth = a.w;
          ctx.beginPath();
          ctx.arc(cx, cy, ring.r, a.a + rot, a.a + rot + a.sweep);
          ctx.stroke();
        }
        if (ring.dot) {
          const ang = ring.dot.a + rot * 1.6;
          ctx.fillStyle = pal.c(ring.dot.ci);
          ctx.beginPath();
          ctx.arc(cx + Math.cos(ang) * ring.r, cy + Math.sin(ang) * ring.r, ring.dot.r, 0, TAU);
          ctx.fill();
        }
      }
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r0 * 1.1);
      g.addColorStop(0, pal.c(sunC));
      g.addColorStop(1, pal.c(sunC, 0.9));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r0 * 0.8, 0, TAU);
      ctx.fill();
    };
  },
};
