// Built-in visual effects pack. Each effect is its own module and its own registry entry;
// this pack only registers them (the same way an extension would).

import tapBurst from './tap-burst.js';
import rippleField from './ripple-field.js';
import colorCascade from './color-cascade.js';
import directionalSweep from './directional-sweep.js';
import cellExplosion from './cell-explosion.js';
import mirrorField from './mirror-field.js';
import rotatingMatrix from './rotating-matrix.js';
import recursiveBloom from './recursive-bloom.js';
import energyTrail from './energy-trail.js';
import flashGrid from './flash-grid.js';
import moireShift from './moire-shift.js';
import oscillatorBands from './oscillator-bands.js';
import cellularPulse from './cellular-pulse.js';
import checkerboardWarp from './checkerboard-warp.js';
import particleScatter from './particle-scatter.js';
import infiniteCorridor from './infinite-corridor.js';
import harmonicGrid from './harmonic-grid.js';
import glitchBlocks from './glitch-blocks.js';
import spiralDraw from './spiral-draw.js';
import symmetryExplosion from './symmetry-explosion.js';
import chargeField from './charge-field.js';
import radialExpansion from './radial-expansion.js';
import { API_VERSION } from '../../config.js';

// ============================================================
// EXTENSION ZONE: CUSTOM VISUAL EFFECTS
// PURPOSE: Register additional visual effects here (built-ins below; extensions use a plugin).
// CONTRACT: See EXTENSION_GUIDE.md and src/effects/effect-interface.js.
// SAFETY: Effects must have bounded lifetimes and support cleanup.
// INTEGRATION: Register through the public effect registry: api.effects.register(def).
// ============================================================
export const BUILTIN_EFFECTS = [
  tapBurst, rippleField, colorCascade, directionalSweep, cellExplosion, mirrorField, rotatingMatrix,
  recursiveBloom, energyTrail, flashGrid, moireShift, oscillatorBands, cellularPulse, checkerboardWarp,
  particleScatter, infiniteCorridor, harmonicGrid, glitchBlocks, spiralDraw, symmetryExplosion,
  chargeField, radialExpansion,
];

export default {
  manifest: {
    id: 'core.effects', name: 'Core Effects', version: '1.0.0', type: 'pack', core: true,
    description: `${BUILTIN_EFFECTS.length} built-in visual effects.`, apiVersion: API_VERSION,
    capabilities: ['visual'],
  },
  register(api) { for (const e of BUILTIN_EFFECTS) api.effects.register(e); },
};
