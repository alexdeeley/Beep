// Built-in audio pack: generators, named sounds and audio mappings.
import { OSCILLATOR_GENERATORS } from './generators/oscillators.js';
import { PERCUSSION_GENERATORS } from './generators/percussion.js';
import { TONAL_GENERATORS } from './generators/tonal.js';
import { BUILTIN_SOUNDS } from './sound-registry.js';
import { BUILTIN_AUDIO_MAPPINGS } from './audio-mapping.js';
import { API_VERSION } from '../config.js';

// ============================================================
// EXTENSION ZONE: SOUND GENERATORS
// PURPOSE: Synthesis primitives (generators) and named sounds (layered recipes).
// CONTRACT: src/audio/generators/common.js (generator) and src/audio/sound-registry.js (sound).
// SAFETY: Generators envelope their own output, declare param ranges (enforced), never touch the DOM.
// INTEGRATION: api.audio.generators.register(def); api.audio.sounds.register(def). Example: src/extensions/examples/wobble-sound.js
// ============================================================
export const BUILTIN_GENERATORS = [...OSCILLATOR_GENERATORS, ...PERCUSSION_GENERATORS, ...TONAL_GENERATORS];

export default {
  manifest: {
    id: 'core.audio', name: 'Core Audio', version: '1.0.0', type: 'pack', core: true, apiVersion: API_VERSION,
    description: `${BUILTIN_GENERATORS.length} generators, ${BUILTIN_SOUNDS.length} sounds, ${BUILTIN_AUDIO_MAPPINGS.length} audio mappings.`,
    capabilities: ['audio'],
  },
  register(api) {
    for (const g of BUILTIN_GENERATORS) api.audio.generators.register(g);
    for (const s of BUILTIN_SOUNDS) api.audio.sounds.register(s);
    for (const m of BUILTIN_AUDIO_MAPPINGS) api.audio.mappings.register(m);
  },
};
