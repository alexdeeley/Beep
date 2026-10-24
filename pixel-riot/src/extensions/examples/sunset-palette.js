// EXAMPLE EXTENSION — a colour palette.

export default {
  manifest: { id: 'ex.sunset', name: 'Sunset Palette (example)', version: '1.0.0', type: 'palette', apiVersion: '1.0.0', description: 'Adds a magenta/orange/violet palette.', dependencies: ['core.palettes'] },
  register(api) {
    // ============================================================
    // EXTENSION ZONE: COLOR PALETTES (example)
    // PURPOSE: Register additional palettes.
    // CONTRACT: src/color/palette-registry.js — stops (#hex, >= 2) or generate(rng).
    // SAFETY: Data only; transitions are handled by the engine.
    // INTEGRATION: api.palettes.register(def)
    // ============================================================
    api.palettes.register({ id: 'ex.sunset', name: 'SUNSET', stops: ['#ff2e63', '#ff9a3c', '#ffd23f', '#7b2cbf'], white: 0.5, spread: 0.5, cycle: 0.025 });
  },
};
