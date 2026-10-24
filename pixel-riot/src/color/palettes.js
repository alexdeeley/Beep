// Built-in palettes. Stops are sampled cyclically (last blends back into first).
import { hslToRgb, rgbToHex } from './palette-registry.js';

// ============================================================
// EXTENSION ZONE: COLOR PALETTES
// PURPOSE: Additional palettes.
// CONTRACT: src/color/palette-registry.js — stops: [#hex >= 2] or generate(rng).
// SAFETY: Data only; the engine handles smooth transitions and caching.
// INTEGRATION: api.palettes.register(def). Example: src/extensions/examples/sunset-palette.js
// ============================================================
export const BUILTIN_PALETTES = [
  { id: 'mono-white', name: 'MONO WHITE', stops: ['#ffffff', '#d8d8d8', '#ffffff', '#9a9a9a'], white: 0.9, spread: 0.1, cycle: 0.01 },
  { id: 'white-electric', name: 'ELECTRIC', stops: ['#ffffff', '#2a6bff', '#0a2cff', '#7fb2ff'], white: 0.75, spread: 0.4 },
  { id: 'cyan-magenta', name: 'CYAN / MAGENTA', stops: ['#00f0ff', '#2b3dff', '#ff00c8', '#ff6ae6'], white: 0.5, spread: 0.5 },
  { id: 'red-black-white', name: 'RED SIGNAL', stops: ['#ff1a1a', '#ffffff', '#ff1a1a', '#5a0000'], white: 0.65, spread: 0.45, discrete: false },
  { id: 'ultraviolet', name: 'ULTRAVIOLET', stops: ['#7a00ff', '#c000ff', '#3d00b8', '#ff4dff'], white: 0.45, spread: 0.5 },
  { id: 'acid', name: 'ACID GREEN', stops: ['#b6ff00', '#39ff14', '#00ff9c', '#f2ff00'], white: 0.5, spread: 0.45 },
  { id: 'warm', name: 'WARM', stops: ['#ff7a00', '#ff2d00', '#ffb000', '#ff004c'], white: 0.55, spread: 0.45 },
  { id: 'spectrum', name: 'SPECTRUM', stops: ['#ff0040', '#ff8a00', '#ffe600', '#2bff00', '#00e5ff', '#2b4dff', '#b000ff'], white: 0.4, spread: 0.7, cycle: 0.04 },
  { id: 'ice', name: 'ICE', stops: ['#e8fbff', '#7fe3ff', '#2aa8ff', '#b8f0ff'], white: 0.8, spread: 0.35 },
  { id: 'ember', name: 'EMBER', stops: ['#ff3d00', '#ffb300', '#7a0a00', '#ff6a00'], white: 0.5, spread: 0.5, cycle: 0.03 },
  { id: 'primary', name: 'PRIMARY', stops: ['#ff0000', '#ffe600', '#0040ff', '#ffffff'], white: 0.35, spread: 0.9, discrete: true },
  { id: 'grayscale', name: 'GRAYSCALE', stops: ['#5c5c5c', '#bdbdbd', '#888888', '#e6e6e6'], white: 0.5, spread: 0.3, cycle: 0.005 },
  {
    id: 'harmony', name: 'HARMONY',
    // Random but harmony-constrained: one base hue plus analogous/triadic/complementary
    // neighbours at controlled saturation and lightness.
    generate(rng) {
      const base = rng.next();
      const scheme = rng.pick([[0, 0.08, -0.08, 0.5], [0, 0.333, 0.667, 0.05], [0, 0.5, 0.04, 0.54], [0, 0.42, 0.58, 0.02]]);
      return scheme.map((o, i) => rgbToHex(hslToRgb(base + o, 0.85 + rng.range(0, 0.15), i === 0 ? 0.55 : rng.range(0.45, 0.62))));
    },
    white: 0.5, spread: 0.55,
  },
];
