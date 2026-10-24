// EXAMPLE EXTENSION — an energy propagation behaviour: energy falls like sand.
// Select it per preset with energy.behavior = 'ex.gravity' (or via api.energy.setBehavior).

export default {
  manifest: { id: 'ex.gravity', name: 'Gravity Energy (example)', version: '1.0.0', type: 'energy', apiVersion: '1.0.0', description: 'Energy drips downward and pools.', dependencies: ['core.energy'] },
  register(api) {
    // ============================================================
    // EXTENSION ZONE: ENERGY PROPAGATION BEHAVIORS (example)
    // PURPOSE: Register new ways energy moves through the grid.
    // CONTRACT: src/grid/energy-field.js — update(field, dt, params); mutate
    //           field.grid.energy inside field.region (the dirty rectangle) and grow the
    //           region if energy can leave it.
    // SAFETY: Never allocate per frame; clamp values (ENERGY_MAX = 2.5).
    // INTEGRATION: api.energy.behaviors.register(def)
    // ============================================================
    api.energy.behaviors.register({
      id: 'ex.gravity', name: 'GRAVITY', description: 'Energy drips downward and pools at the bottom.',
      update(field, dt, p) {
        const g = field.grid, e = g.energy, r = field.region, W = g.cols, H = g.rows;
        const k = Math.exp(-dt * p.decay * 0.6), fall = Math.min(0.6, dt * 24);
        for (let y = Math.min(H - 2, r.y1); y >= r.y0; y--) for (let x = r.x0; x <= r.x1; x++) {
          const i = y * W + x, j = i + W; const m = e[i] * fall;
          e[i] = (e[i] - m) * k; e[j] = Math.min(2.5, e[j] + m);
        }
        r.y1 = Math.min(H - 1, r.y1 + 1);
      },
    });
  },
};
