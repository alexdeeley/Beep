// EXAMPLE EXTENSION — a preset that combines other extensions (shape, pattern, palette,
// energy behaviour and interaction profile). Declares them as dependencies so it only
// loads when they did.

export default {
  manifest: {
    id: 'ex.preset-sunset-hive', name: 'Sunset Hive Preset (example)', version: '1.0.0', type: 'preset', apiVersion: '1.0.0',
    description: 'A preset built only from example extensions.',
    dependencies: ['ex.hexagon', 'ex.plasma', 'ex.sunset', 'ex.gravity', 'ex.lissajous', 'core.presets'],
  },
  register(api) {
    // ============================================================
    // EXTENSION ZONE: PRESETS (example)
    // PURPOSE: Ship instrument configurations.
    // CONTRACT: src/presets/preset-schema.js (format 'pixel-riot-preset', version 1).
    // SAFETY: Data only — validated on register; unknown ids fall back with warnings.
    // INTEGRATION: api.presets.register(preset)
    // ============================================================
    api.presets.register({
      format: 'pixel-riot-preset', version: 1, id: 'ex.sunset-hive', name: 'SUNSET HIVE',
      palette: 'ex.sunset', pattern: { a: { id: 'ex.plasma', params: { scale: 6 } }, b: { id: 'checker' }, blend: 'multiply', mix: 0.4 },
      shapes: ['ex.hexagon', 'circle'], shapeMode: 'band', interaction: 'ex.lissajous-profile',
      look: { patternGain: 0.5, cellScale: 1.05, gap: 0.92, symmetry: 'quad' }, energy: { behavior: 'ex.gravity', decay: 0.9, spread: 0.1 },
    });
  },
};
