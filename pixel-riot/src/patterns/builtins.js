// Built-in pattern generators. All write values 0..1 into `out` (one per cell).
// Coordinates: u, v are centred and aspect-corrected so circles are round.

const TAU = Math.PI * 2;
const fract = (x) => x - Math.floor(x);
const hash = (x, y, s = 0) => fract(Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453);

function smoothNoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Iterate cells with centred, aspect-correct coordinates (short side spans -1..1).
function each(ctx, fn) {
  const { cols, rows } = ctx; const s = Math.min(cols, rows) / 2;
  let i = 0;
  for (let y = 0; y < rows; y++) {
    const v = (y + 0.5 - rows / 2) / s;
    for (let x = 0; x < cols; x++, i++) fn(i, x, y, (x + 0.5 - cols / 2) / s, v);
  }
}

// ============================================================
// EXTENSION ZONE: PATTERN GENERATORS
// PURPOSE: Additional pattern generators.
// CONTRACT: src/patterns/pattern-registry.js — fill(out, ctx) writes 0..1 per cell; state via init().
// SAFETY: O(cells) per frame; values outside 0..1 are clamped; a throwing pattern falls back to CHECKER.
// INTEGRATION: api.patterns.register(def). Example: src/extensions/examples/plasma-pattern.js
// ============================================================
export const BUILTIN_PATTERNS = [
  {
    id: 'blank', name: 'BLANK', description: 'Empty field — only your gestures light it.', animated: false,
    fill(out) { out.fill(0); },
  },
  {
    id: 'checker', name: 'CHECKER', description: 'Breathing checkerboard with a travelling inversion.',
    params: { size: 1, speed: 0.6 },
    fill(out, ctx) {
      const { t, params: p } = ctx; const sz = Math.max(1, p.size | 0);
      each(ctx, (i, x, y, u, v) => {
        const c = ((Math.floor(x / sz) + Math.floor(y / sz)) & 1);
        const wave = 0.5 + 0.5 * Math.sin(t * p.speed - (u + v) * 1.8);
        out[i] = c ? 0.25 + 0.55 * wave : 0.05 + 0.18 * (1 - wave);
      });
    },
  },
  {
    id: 'stripes', name: 'STRIPES', description: 'Drifting vertical/horizontal bands.',
    params: { freq: 7, speed: 0.5, angle: 0 },
    fill(out, ctx) {
      const { t, params: p } = ctx; const ca = Math.cos(p.angle), sa = Math.sin(p.angle);
      each(ctx, (i, x, y, u, v) => { const k = u * ca + v * sa; out[i] = Math.pow(0.5 + 0.5 * Math.sin(k * p.freq + t * p.speed * 3), 3); });
    },
  },
  {
    id: 'concentric', name: 'CONCENTRIC', description: 'Rings expanding from the centre.',
    params: { freq: 10, speed: 1 },
    fill(out, ctx) { const { t, params: p } = ctx; each(ctx, (i, x, y, u, v) => { const d = Math.hypot(u, v); out[i] = Math.pow(0.5 + 0.5 * Math.sin(d * p.freq - t * p.speed * 2), 2.5) * (1 - Math.min(1, d * 0.35)); }); },
  },
  {
    id: 'radial', name: 'RADIAL', description: 'N-fold radial symmetry spokes.',
    params: { folds: 8, speed: 0.4 },
    fill(out, ctx) { const { t, params: p } = ctx; each(ctx, (i, x, y, u, v) => { const a = Math.atan2(v, u), d = Math.hypot(u, v); out[i] = Math.pow(0.5 + 0.5 * Math.cos(a * p.folds + t * p.speed + d * 2.5), 4) * Math.min(1, d * 1.5); }); },
  },
  {
    id: 'mirror', name: 'MIRROR', description: 'Four-way mirrored morphing composition.',
    params: { scale: 2.6, speed: 0.15 },
    fill(out, ctx) { const { t, params: p } = ctx; each(ctx, (i, x, y, u, v) => { const n = smoothNoise(Math.abs(u) * p.scale, Math.abs(v) * p.scale + t * p.speed, 3) * 0.7 + smoothNoise(Math.abs(u) * p.scale * 2.3, Math.abs(v) * p.scale * 2.3 - t * p.speed, 5) * 0.3; out[i] = n > 0.55 ? 0.35 + (n - 0.55) * 1.4 : n * 0.15; }); },
  },
  {
    id: 'rotating-grid', name: 'ROTATING GRID', description: 'A lattice turning slowly over the cells.',
    params: { spacing: 0.32, speed: 0.08 },
    fill(out, ctx) {
      const { t, params: p } = ctx; const a = t * p.speed, ca = Math.cos(a), sa = Math.sin(a);
      each(ctx, (i, x, y, u, v) => { const ru = u * ca - v * sa, rv = u * sa + v * ca; const gx = Math.abs(fract(ru / p.spacing) - 0.5), gy = Math.abs(fract(rv / p.spacing) - 0.5); out[i] = Math.max(gx, gy) > 0.36 ? 0.75 : ((Math.floor(ru / p.spacing) + Math.floor(rv / p.spacing)) & 1) * 0.12; });
    },
  },
  {
    id: 'diagonal', name: 'DIAGONAL WAVE', description: 'Waves rolling diagonally.',
    params: { freq: 9, speed: 1.2 },
    fill(out, ctx) { const { t, params: p } = ctx; each(ctx, (i, x, y, u, v) => { out[i] = Math.pow(0.5 + 0.5 * Math.sin((u + v) * p.freq - t * p.speed * 2 + Math.sin(u * 2 - t) * 0.8), 3); }); },
  },
  {
    id: 'cellular', name: 'CELLULAR', description: 'A slowly evolving life-like automaton (B3/S23 with seeding).',
    params: { step: 0.22 },
    init(ctx) {
      const n = ctx.count; const s = { a: new Uint8Array(n), b: new Uint8Array(n), fade: new Float32Array(n), acc: 0 };
      for (let i = 0; i < n; i++) s.a[i] = ctx.rng.chance(0.28) ? 1 : 0;
      return s;
    },
    fill(out, ctx) {
      const { cols: W, rows: H, state: s, dt, params: p, energy } = ctx;
      s.acc += dt;
      if (s.acc >= p.step) {
        s.acc = 0; let alive = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          let n = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const xx = (x + dx + W) % W, yy = (y + dy + H) % H; n += s.a[yy * W + xx];
          }
          const i = y * W + x; const on = s.a[i];
          // Energy from gestures seeds life.
          s.b[i] = (on && (n === 2 || n === 3)) || (!on && n === 3) || energy[i] > 0.6 ? 1 : 0;
          alive += s.b[i];
        }
        [s.a, s.b] = [s.b, s.a];
        if (alive < ctx.count * 0.03) for (let k = 0; k < ctx.count * 0.05; k++) s.a[(ctx.rng.next() * ctx.count) | 0] = 1;
      }
      for (let i = 0; i < ctx.count; i++) { s.fade[i] += ((s.a[i] ? 0.85 : 0) - s.fade[i]) * Math.min(1, dt * 7); out[i] = s.fade[i]; }
    },
  },
  {
    id: 'recursive', name: 'RECURSIVE SQUARES', description: 'Nested squares zooming inward forever.',
    params: { speed: 0.35 },
    fill(out, ctx) { const { t, params: p } = ctx; each(ctx, (i, x, y, u, v) => { const d = Math.max(Math.abs(u), Math.abs(v)) + 1e-3; const k = fract(Math.log2(d) * 2 + t * p.speed); out[i] = k < 0.42 ? 0.8 * (1 - k) : 0.04; }); },
  },
  {
    id: 'spiral', name: 'SPIRAL', description: 'Logarithmic spiral arms.',
    params: { arms: 3, twist: 3, speed: 0.6 },
    fill(out, ctx) { const { t, params: p } = ctx; each(ctx, (i, x, y, u, v) => { const a = Math.atan2(v, u), d = Math.hypot(u, v) + 1e-3; out[i] = Math.pow(0.5 + 0.5 * Math.sin(a * p.arms + Math.log(d) * p.twist * 2 - t * p.speed * 2), 3); }); },
  },
  {
    id: 'ripples', name: 'RIPPLES', description: 'Interference of three wandering ripple sources.',
    params: { freq: 12, speed: 1 },
    fill(out, ctx) {
      const { t, params: p } = ctx;
      const src = [[Math.sin(t * 0.23) * 0.7, Math.cos(t * 0.31) * 0.6], [Math.cos(t * 0.19) * 0.8, Math.sin(t * 0.27 + 2) * 0.7], [Math.sin(t * 0.13 + 4) * 0.5, Math.cos(t * 0.17 + 1) * 0.8]];
      each(ctx, (i, x, y, u, v) => { let s = 0; for (const [sx, sy] of src) s += Math.sin(Math.hypot(u - sx, v - sy) * p.freq - t * p.speed * 3); out[i] = Math.pow(Math.max(0, s / 3) , 1.5); });
    },
  },
  {
    id: 'truchet', name: 'TESSELLATION', description: 'Truchet tiling of quarter-arcs that re-seeds slowly.',
    params: { tile: 4, speed: 0.12 },
    fill(out, ctx) {
      const { t, params: p } = ctx; const T = Math.max(2, p.tile | 0); const epoch = Math.floor(t * p.speed);
      let i = 0;
      for (let y = 0; y < ctx.rows; y++) for (let x = 0; x < ctx.cols; x++, i++) {
        const tx = Math.floor(x / T), ty = Math.floor(y / T);
        const flip = hash(tx, ty, epoch) > 0.5;
        let lx = (x % T + 0.5) / T, ly = (y % T + 0.5) / T; if (flip) lx = 1 - lx;
        const d1 = Math.abs(Math.hypot(lx, ly) - 0.5), d2 = Math.abs(Math.hypot(1 - lx, 1 - ly) - 0.5);
        out[i] = Math.min(d1, d2) < 0.17 ? 0.7 : 0.03;
      }
    },
  },
  {
    id: 'bands', name: 'OSCILLATING BANDS', description: 'Horizontal bands, each oscillating at a related frequency.',
    params: { bands: 8, speed: 1 },
    fill(out, ctx) {
      const { t, params: p, cols, rows } = ctx; let i = 0;
      for (let y = 0; y < rows; y++) {
        const b = Math.floor((y / rows) * p.bands); const f = (b + 1) * 0.5;
        for (let x = 0; x < cols; x++, i++) { const ph = (x / cols) * TAU * (1 + b * 0.25); out[i] = Math.pow(0.5 + 0.5 * Math.sin(ph + t * f * p.speed * 2), 4) * (b % 2 ? 0.9 : 0.6); }
      }
    },
  },
  {
    id: 'clusters', name: 'SYMMETRIC CLUSTERS', description: 'Mirrored 8x8 block motifs that mutate.',
    params: { block: 8, speed: 0.35 },
    fill(out, ctx) {
      const { t, params: p } = ctx; const B = Math.max(4, p.block | 0); const h = B / 2; let i = 0;
      for (let y = 0; y < ctx.rows; y++) for (let x = 0; x < ctx.cols; x++, i++) {
        const bx = Math.floor(x / B), by = Math.floor(y / B);
        let lx = x % B, ly = y % B; if (lx >= h) lx = B - 1 - lx; if (ly >= h) ly = B - 1 - ly;
        if (ly > lx) [lx, ly] = [ly, lx];
        const n = hash(lx + bx * 0.0, ly, Math.floor(t * p.speed + hash(bx, by) * 3));
        out[i] = n > 0.55 ? 0.3 + n * 0.6 : 0.02;
      }
    },
  },
  {
    id: 'noise', name: 'NOISE FIELD', description: 'Flowing fractal value noise.',
    params: { scale: 2.2, speed: 0.25 },
    fill(out, ctx) { const { t, params: p } = ctx; each(ctx, (i, x, y, u, v) => { const n = smoothNoise(u * p.scale + t * p.speed, v * p.scale, 1) * 0.6 + smoothNoise(u * p.scale * 2.1, v * p.scale * 2.1 - t * p.speed * 1.3, 2) * 0.3 + smoothNoise(u * p.scale * 4.3, v * p.scale * 4.3, 4) * 0.1; out[i] = Math.pow(n, 2.2); }); },
  },
  {
    id: 'memory', name: 'MEMORY', description: 'Built from your own gesture history — where you play, it remembers.',
    fill(out, ctx) { const { memory, t } = ctx; each(ctx, (i, x, y, u, v) => { const m = Math.min(1, memory[i] * 1.6); out[i] = m * (0.75 + 0.25 * Math.sin(t * 1.5 + i * 0.37)); }); },
  },
];
