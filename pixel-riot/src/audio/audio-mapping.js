// Audio mappings: turn a gesture/cell event into musical parameters.
//
// Audio mapping contract (API 1.x):
//   {
//     id, name, description?,
//     map(ev, ctx) -> {
//       degree?: int        // scale degree (preferred; lets chords stay in key)
//       midi?: number       // OR an explicit MIDI pitch (used when degree is absent)
//       gain?: 0..1, pan?: -1..1, cutoff?: Hz, bright?: 0..1, decay?: s, glide?: ratio, attack?: s
//     }
//   }
//   ev  = any gesture event (see gesture-events.js) or chain/effect event with x, y
//   ctx = { music: { scale, root, free, base }, grid, energyAt(x, y), paintAt(x, y),
//           normToDegree(n, octaves), normToMidi(n, octaves) }
//
// Mappings never create audio nodes; the engine turns the result into voices and clamps
// every value to the generator's safe range.

import { SCALES } from './music.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const yToCutoff = (y) => 400 + Math.pow(1 - y, 2) * 9000;

// ============================================================
// EXTENSION ZONE: AUDIO MAPPINGS
// PURPOSE: Turn gestures / cells into musical parameters.
// CONTRACT: map(ev, ctx) -> { degree | midi, gain, pan, cutoff, ...any generator param }.
// SAFETY: Return numbers only; the engine clamps everything to safe generator ranges.
// INTEGRATION: api.audio.mappings.register(def). Example: src/extensions/examples/wobble-sound.js
// ============================================================
export const BUILTIN_AUDIO_MAPPINGS = [
  {
    id: 'position-pitch', name: 'POSITION → PITCH',
    description: 'x selects the note in the active scale; y opens the filter (top = bright); speed and pressure set the attack strength; x pans.',
    map(ev, ctx) {
      const sp = ev.speed || 0, pr = ev.pressure ?? 0.5;
      return {
        degree: ctx.normToDegree(ev.x, 2.5), gain: clamp(0.45 + sp * 0.12 + (pr - 0.5) * 0.4, 0.15, 0.95),
        pan: clamp(ev.x * 2 - 1, -0.9, 0.9) * 0.8, cutoff: yToCutoff(ev.y), bright: clamp(1 - ev.y, 0, 1),
      };
    },
  },
  {
    id: 'velocity-glide', name: 'VELOCITY → GLIDE',
    description: 'Like position-pitch, but upward motion glides pitch up and downward motion glides down.',
    map(ev, ctx) {
      const base = ctx.mappings.get('position-pitch').map(ev, ctx);
      const vy = ev.velocityY || 0;
      return { ...base, glide: clamp(Math.pow(2, -vy * 0.6), 0.5, 2), decay: clamp(0.15 + (ev.duration || 0) * 0.3, 0.12, 1.5) };
    },
  },
  {
    id: 'energy-gain', name: 'ENERGY → VOLUME',
    description: 'Cell energy controls loudness (bounded); painted colour selects the octave.',
    map(ev, ctx) {
      const e = ctx.energyAt(ev.x, ev.y); const paint = ctx.paintAt(ev.x, ev.y);
      const oct = paint >= 0 ? Math.floor((((paint % 1) + 1) % 1) * 3) : 1;
      return { degree: ctx.normToDegree(ev.x, 1) + oct * (SCALES[ctx.music.scale]?.length || 5), gain: clamp(0.2 + e * 0.35, 0.1, 0.9), pan: ev.x * 1.6 - 0.8, cutoff: yToCutoff(ev.y) };
    },
  },
  {
    id: 'color-family', name: 'COLOUR → NOTE FAMILY',
    description: 'The painted palette position of the touched cell picks the scale degree; x pans.',
    map(ev, ctx) {
      const paint = ctx.paintAt(ev.x, ev.y);
      const t = paint >= 0 ? (((paint % 1) + 1) % 1) : ev.x;
      return { degree: Math.floor(t * 12), gain: 0.5, pan: ev.x * 1.6 - 0.8, cutoff: yToCutoff(ev.y) };
    },
  },
  {
    id: 'chord-centroid', name: 'MULTITOUCH → CHORD ROOT',
    description: 'Centroid x picks the chord root; pinch scale spreads the voicing; count adds brightness.',
    map(ev, ctx) {
      return { degree: ctx.normToDegree(ev.x, 1.5) - 2, gain: 0.55, pan: 0, cutoff: 1200 + (ev.scale || 1) * 2500 + (ev.activePointerCount || 2) * 400, decay: 1.2 };
    },
  },
  {
    id: 'rotation-mod', name: 'ROTATION → PITCH BEND',
    description: 'Rotation angle bends pitch around the centroid note.',
    map(ev, ctx) {
      const base = ctx.normToMidi(ev.x, 2);
      return { midi: base + clamp((ev.rotation || 0) * 6, -12, 12), gain: 0.4, pan: clamp(Math.sin(ev.rotation || 0), -1, 1) * 0.7, cutoff: 2500 + Math.abs(ev.deltaRotation || 0) * 40000, glide: 1 };
    },
  },
  {
    id: 'charge-level', name: 'CHARGE → RISE',
    description: 'Hold level raises pitch (one octave), filter and LFO rate.',
    map(ev, ctx) {
      const L = ev.level || 0;
      return { midi: ctx.normToMidi(ev.x, 1.5) + L * 12, gain: 0.3 + L * 0.45, cutoff: 800 + L * 9000, bright: L, pan: ev.x * 1.4 - 0.7 };
    },
  },
  {
    id: 'fixed', name: 'FIXED', description: 'No pitch from position — for drums. Pans with x.',
    map(ev) { return { midi: 48, gain: 0.6, pan: ((ev.x ?? 0.5) * 2 - 1) * 0.6, cutoff: 8000 }; },
  },
  {
    id: 'depth', name: 'CHAIN DEPTH', description: 'Chain-reaction stages step down the scale as they spread; quieter with depth.',
    map(ev, ctx) {
      return { degree: ctx.normToDegree(ev.x ?? 0.5, 2) - (ev.depth || 0), gain: clamp(0.5 * (ev.level ?? 1), 0.08, 0.6), pan: ((ev.x ?? 0.5) * 2 - 1) * 0.7, cutoff: 3000 - (ev.depth || 0) * 200 };
    },
  },
];
