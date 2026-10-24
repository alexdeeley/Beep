// Named sounds = layered recipes over generators. Sounds are what mappings/presets refer
// to ('click', 'bell', 'chord'...). Generators are the synthesis primitives.
//
// Sound contract (API 1.x):
//   {
//     id, name, family?: 'percussive' | 'tonal' | 'texture',
//     sustain?: bool,                 // held voice (needs a key; released by the router)
//     layers: [{
//       gen: 'generator-id',          // REQUIRED
//       params?: { ... },             // fixed generator params for this layer
//       gain?: 1,                     // layer gain multiplier
//       octave?: 0, semis?: 0,        // pitch offset from the mapped note
//       degree?: 0,                   // scale-degree offset (for chords) when the mapping gives a degree
//       pitch?: true,                 // false = ignore mapped pitch (drums)
//       delay?: 0,                    // seconds after the start time
//     }]
//   }

import { Registry, need } from '../core/registry.js';

export function validateSound(d) {
  const e = [];
  need.arr(d, 'layers', e);
  if (Array.isArray(d.layers)) {
    if (!d.layers.length) e.push('layers must not be empty');
    if (d.layers.length > 6) e.push('at most 6 layers');
    d.layers.forEach((l, k) => { if (!l || typeof l.gen !== 'string') e.push(`layers[${k}].gen must be a generator id`); });
  }
  return e;
}

export function validateGenerator(d) {
  const e = [];
  need.fn(d, 'create', e); need.obj(d, 'params', e);
  if (d.params) for (const [k, s] of Object.entries(d.params)) if (!(s && s.min <= s.default && s.default <= s.max)) e.push(`param "${k}" needs min <= default <= max`);
  return e;
}

export function validateAudioMapping(d) {
  const e = []; need.fn(d, 'map', e); return e;
}

export const createSoundRegistry = (events) => new Registry('sounds', { events, validate: validateSound });
export const createGeneratorRegistry = (events) => new Registry('generators', { events, validate: validateGenerator });
export const createAudioMappingRegistry = (events) => new Registry('audioMappings', { events, validate: validateAudioMapping });

export const BUILTIN_SOUNDS = [
  { id: 'click', name: 'CLICK', family: 'percussive', layers: [{ gen: 'click', pitch: false }] },
  { id: 'pop', name: 'POP', family: 'percussive', layers: [{ gen: 'sine', params: { decay: 0.09, attack: 0.002, glide: 0.45 }, octave: 1 }, { gen: 'noise-burst', params: { decay: 0.02 }, gain: 0.35, pitch: false }] },
  { id: 'ping', name: 'PING', family: 'tonal', layers: [{ gen: 'metal', params: { decay: 0.4 }, octave: 1 }] },
  { id: 'pluck', name: 'SOFT PLUCK', family: 'tonal', layers: [{ gen: 'pluck', params: { decay: 1.1 } }] },
  { id: 'thump', name: 'BASS THUMP', family: 'percussive', layers: [{ gen: 'kick', octave: -2 }] },
  { id: 'tick', name: 'NOISE TICK', family: 'percussive', layers: [{ gen: 'hat-closed', pitch: false }] },
  { id: 'rise', name: 'RISING SWEEP', family: 'texture', layers: [{ gen: 'sweep-up', params: { decay: 0.32 } }] },
  { id: 'fall', name: 'FALLING SWEEP', family: 'texture', layers: [{ gen: 'sweep-down', params: { decay: 0.32 } }] },
  { id: 'bell', name: 'BELL', family: 'tonal', layers: [{ gen: 'bell', octave: 1 }] },
  { id: 'burst', name: 'PERCUSSIVE BURST', family: 'percussive', layers: [{ gen: 'snare', pitch: false }, { gen: 'noise-burst', params: { decay: 0.16 }, pitch: false, gain: 0.6 }, { gen: 'kick', octave: -2, gain: 0.7 }] },
  { id: 'noise', name: 'FILTERED NOISE', family: 'texture', layers: [{ gen: 'filtered-noise', params: { q: 12, decay: 0.5, glide: 0.35 } }] },
  { id: 'chord', name: 'CHORD', family: 'tonal', layers: [{ gen: 'triangle', params: { decay: 1.2 } }, { gen: 'triangle', degree: 2, params: { decay: 1.1 } }, { gen: 'triangle', degree: 4, params: { decay: 1.0 } }, { gen: 'sine', octave: -1, gain: 0.8, params: { decay: 1.4 } }] },
  { id: 'pulse', name: 'RHYTHMIC PULSE', family: 'percussive', layers: [{ gen: 'fm', params: { ratio: 1, index: 2.5, decay: 0.16 } }, { gen: 'hat-closed', pitch: false, gain: 0.5 }] },
  { id: 'touch', name: 'LAYERED TOUCH', family: 'tonal', layers: [{ gen: 'triangle', params: { decay: 0.55 } }, { gen: 'sine', octave: 1, gain: 0.45, params: { decay: 0.3 } }, { gen: 'click', pitch: false, gain: 0.35 }] },
  { id: 'grain', name: 'GRAIN', family: 'texture', layers: [{ gen: 'grain' }] },
  { id: 'fm-bell', name: 'FM BELL', family: 'tonal', layers: [{ gen: 'fm', params: { ratio: 3.5, index: 5, decay: 1.2 }, octave: 1 }] },
  { id: 'charge', name: 'CHARGE TONE', family: 'texture', sustain: true, layers: [{ gen: 'drone', octave: -1 }] },
  { id: 'pad', name: 'SOFT PAD', family: 'tonal', sustain: true, layers: [{ gen: 'pad' }] },
];
