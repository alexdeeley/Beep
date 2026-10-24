// EXAMPLE EXTENSION — a pattern generator (classic sine plasma).

export default {
  manifest: { id: 'ex.plasma', name: 'Plasma Pattern (example)', version: '1.0.0', type: 'pattern', apiVersion: '1.0.0', description: 'Adds a sine-plasma pattern.', dependencies: ['core.patterns'] },
  register(api) {
    // ============================================================
    // EXTENSION ZONE: PATTERN GENERATORS (example)
    // PURPOSE: Register additional pattern generators.
    // CONTRACT: src/patterns/pattern-registry.js — fill(out, ctx) writes 0..1 per cell.
    // SAFETY: O(cells) per frame at most; keep state in ctx.state (from init()).
    // INTEGRATION: api.patterns.register(def)
    // ============================================================
    api.patterns.register({
      id: 'ex.plasma', name: 'PLASMA', description: 'Overlapping sine fields.',
      params: { scale: 5, speed: 0.8 },
      fill(out, ctx) {
        const { cols, rows, t, params: p } = ctx; const k = Math.min(cols, rows);
        let i = 0;
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++, i++) {
          const u = x / k, v = y / k;
          const s = Math.sin(u * p.scale + t * p.speed) + Math.sin(v * p.scale * 1.3 - t * p.speed * 0.7)
            + Math.sin((u + v) * p.scale * 0.7 + t * p.speed * 0.4) + Math.sin(Math.hypot(u - 0.5, v - 0.5) * p.scale * 2 - t * p.speed);
          out[i] = Math.pow((s + 4) / 8, 2.4);
        }
      },
    });
  },
};
