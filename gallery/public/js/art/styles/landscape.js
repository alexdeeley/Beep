import { TAU, background, lerp } from '../common.js';

export default {
  id: 'landscape',
  medium: 'Layered ridges',
  aspects: [[3 / 2, 4], [16 / 9, 3], [4 / 3, 2], [1, 1]],
  words: ['Ridge', 'Horizon', 'Dusk', 'Valley', 'Foothills', 'Passage', 'Highland', 'Dawn', 'Range'],
  make({ rng, pal, noise, A }) {
    const layers = rng.int(4, 7);
    const horizon = rng.range(0.34, 0.62);
    // Far ridges take the palette's lightest colours, near ones its darkest.
    const byLight = pal.list.map((c, i) => [c.l, i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
    const ridges = [];
    for (let k = 0; k < layers; k++) {
      const f = k / (layers - 1);
      ridges.push({
        y: lerp(horizon, 0.96, Math.pow(f, 0.9)),
        amp: lerp(0.05, 0.2, f) * rng.range(0.7, 1.3),
        freq: lerp(1.2, 3.2, rng.float()) * (1 + f * 0.3),
        speed: lerp(0.0015, 0.014, f),
        seed: rng.range(0, 100),
        ci: byLight[Math.min(byLight.length - 1, Math.floor(f * byLight.length))],
        sharp: rng.range(0.6, 1.5),
        haze: (1 - f) * rng.range(0.45, 0.8),
      });
    }
    const sun = { x: rng.range(0.2, A - 0.2), y: rng.range(horizon - 0.32, horizon - 0.06), r: rng.range(0.05, 0.12), ci: rng.int(0, pal.n - 1) };
    const skyA = rng.int(0, pal.n - 1);
    const stars = pal.dark ? Array.from({ length: 70 }, () => ({ x: rng.range(0, A), y: rng.range(0, horizon), r: rng.range(0.0006, 0.002), p: rng.float() * TAU })) : [];
    return (ctx, A2, t) => {
      const sky = ctx.createLinearGradient(0, 0, 0, horizon + 0.1);
      sky.addColorStop(0, pal.bg);
      sky.addColorStop(1, pal.mix(skyA, skyA + 1, 0.5, 0.55));
      ctx.fillStyle = pal.bg2; ctx.fillRect(0, 0, A2, 1);
      ctx.fillStyle = sky; ctx.fillRect(0, 0, A2, 1);
      for (const s of stars) {
        ctx.fillStyle = pal.ink(0.35 + 0.5 * Math.abs(Math.sin(t * 0.8 + s.p)));
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
      }
      const sy = sun.y + Math.sin(t * 0.05) * 0.02;
      const halo = ctx.createRadialGradient(sun.x, sy, 0, sun.x, sy, sun.r * 4.5);
      halo.addColorStop(0, pal.c(sun.ci, 0.55)); halo.addColorStop(1, pal.c(sun.ci, 0));
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(sun.x, sy, sun.r * 4.5, 0, TAU); ctx.fill();
      ctx.fillStyle = pal.c(sun.ci); ctx.beginPath(); ctx.arc(sun.x, sy, sun.r, 0, TAU); ctx.fill();

      const step = 0.012;
      for (const r of ridges) {
        ctx.fillStyle = pal.c(r.ci);
        ctx.beginPath();
        ctx.moveTo(0, 1.02);
        for (let x = 0; x <= A2 + step; x += step) {
          const n = noise.fbm(x * r.freq + r.seed + t * r.speed * r.freq * 4, r.seed * 0.37, 4);
          ctx.lineTo(x, r.y - (Math.abs(n) * r.sharp + n * 0.4) * r.amp);
        }
        ctx.lineTo(A2 + step, 1.02);
        ctx.closePath();
        ctx.fill();
        // Mist: the farther the ridge, the more of the sky's colour hangs on it.
        if (r.haze > 0.02) {
          const mist = ctx.createLinearGradient(0, r.y - r.amp, 0, r.y + 0.3);
          mist.addColorStop(0, pal.mix(skyA, skyA + 1, 0.5, r.haze));
          mist.addColorStop(1, pal.mix(skyA, skyA + 1, 0.5, 0));
          ctx.fillStyle = mist;
          ctx.fill();
        }
      }
    };
  },
};
