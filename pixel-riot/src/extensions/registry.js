// ============================================================
// EXTENSION ZONE: OPTIONAL MODULE LIST
// PURPOSE: The single list of optional extensions loaded at startup.
// CONTRACT: Each entry is a plugin module (default export) with a valid manifest
//           (src/extensions/manifest-schema.js). Order does not matter — dependencies
//           are resolved by the plugin manager.
// SAFETY: Only explicitly imported local modules run. Nothing is fetched or evaluated
//         from the network. Broken entries are isolated and shown in SETTINGS > EXTENSIONS.
// INTEGRATION: Add `import myExt from './my-ext/index.js';` and append it to EXTENSIONS.
//              To remove an extension, delete both lines; nothing else references it.
// ============================================================

import lissajous from './examples/lissajous-effect.js';
import hexagon from './examples/hexagon-shape.js';
import plasma from './examples/plasma-pattern.js';
import sunset from './examples/sunset-palette.js';
import wobble from './examples/wobble-sound.js';
import zigzag from './examples/zigzag-gesture.js';
import gravity from './examples/gravity-energy.js';
import examplePreset from './examples/example-preset.js';
import statsPanel from './examples/stats-panel.js';
import dotMatrix from './examples/dot-matrix-renderer.js';
import orbits from './examples/orbit-system.js';
import frameBudget from './examples/frame-budget.js';
import colourSafe from './examples/colour-safe.js';
import autoplay from './examples/autoplay.js';

export const EXTENSIONS = [
  lissajous, hexagon, plasma, sunset, wobble, zigzag, gravity, examplePreset,
  statsPanel, dotMatrix, orbits, frameBudget, colourSafe, autoplay,
];
