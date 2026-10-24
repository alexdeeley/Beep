// Built-in interaction profiles ("effect sets"). The EFFECT button cycles through the
// profiles marked `cycle: true`. 'core.base' holds the shared hold / multitouch / circle /
// rhythm / chain behaviour that most profiles include.

// ============================================================
// EXTENSION ZONE: GESTURE-TO-EFFECT MAPPINGS
// PURPOSE: What each gesture does: interaction profiles (pure data).
// CONTRACT: src/interaction/router.js — { id, rules: [{ on, when?, throttle?, do: [actions] }], include?, global?, cycle? }.
// SAFETY: Profiles cannot execute code; unknown ids are ignored; use throttle on continuous gestures.
// INTEGRATION: api.interactions.register(profile). Example: src/extensions/examples/lissajous-effect.js
// ============================================================
export const BASE_PROFILE = {
  id: 'core.base', name: 'BASE', description: 'Shared long-press, multitouch, circle, rhythm and chain behaviour.',
  rules: [
    // Long press = energy buildup + sustained tone; lift releases it.
    { on: 'hold:start', do: [{ sound: 'charge', map: 'charge-level', sustain: true, key: 'gesture' }] },
    { on: 'hold:charge', do: [{ effect: 'charge-field', key: 'gesture', params: { level: '$level' } }, { sound: 'charge', map: 'charge-level', sustain: true, key: 'gesture' }] },
    { on: 'hold:release', do: [{ effect: 'charge-field', key: 'gesture', params: { level: '$level', released: true } }, { release: 'gesture', seconds: 0.5 }, { sound: 'thump', map: 'fixed' }] },
    { on: 'hold:cancel', do: [{ effect: 'charge-field', key: 'gesture', params: { cancelled: true } }, { release: 'gesture', seconds: 0.2 }] },
    // Two-finger spread = radial expansion + chord. Pinch outward keeps feeding it.
    { on: 'spread', do: [{ effect: 'radial-expansion', key: 'group', params: { scale: '$scale' } }, { sound: 'chord', map: 'chord-centroid' }] },
    { on: 'pinch', when: { fields: { scale: [1.12, 99] } }, throttle: 0.08, do: [{ effect: 'radial-expansion', key: 'group', params: { scale: '$scale' } }] },
    { on: 'squeeze', do: [{ effect: 'infinite-corridor' }, { sound: 'fall', map: 'chord-centroid' }] },
    // Two-finger rotation = rotating geometry + pitch modulation.
    { on: 'rotate', throttle: 0.03, do: [{ effect: 'rotating-matrix', key: 'group', params: { follow: '$rotation', radius: 8 } }] },
    { on: 'rotate', throttle: 0.14, do: [{ sound: 'fm-bell', map: 'rotation-mod', gain: 0.6 }] },
    // Three or more fingers: a mirrored composition.
    { on: 'multi:count', when: { fields: { count: [3, 10] } }, do: [{ effect: 'symmetry-explosion' }, { sound: 'burst', map: 'fixed' }] },
    // Circles draw spirals and kick the moiré.
    { on: 'circle', do: [{ effect: 'spiral-draw' }, { sound: 'grain' }] },
    // Rapid repeated taps = rhythmic sequence (and tempo follow in musical mode).
    { on: 'rhythm', do: [{ effect: 'flash-grid' }, { effect: 'harmonic-grid', key: 'harmonic' }, { sound: 'pulse' }, { tempo: 'rhythm' }] },
    // Chain reactions sing as they spread.
    { on: 'chain:stage', when: { fields: { sound: [1, 1] } }, throttle: 0.05, do: [{ sound: 'pluck', map: 'depth', gain: 0.5 }] },
  ],
};

export const BUILTIN_PROFILES = [
  BASE_PROFILE,
  {
    id: 'riot', name: 'RIOT', cycle: true, include: ['core.base'],
    description: 'Tap = burst + click + ripple. Swipe = sweep + glide + cascade. The all-rounder.',
    rules: [
      { on: 'press', do: [{ effect: 'tap-burst' }, { sound: 'click', map: 'fixed', gain: 0.7 }, { sound: 'touch', map: 'position-pitch' }] },
      { on: 'tap', do: [{ effect: 'ripple-field' }] },
      { on: 'doubletap', do: [{ effect: 'cell-explosion' }, { effect: 'cellular-pulse' }, { sound: 'burst', map: 'fixed' }] },
      { on: 'drag', do: [{ effect: 'energy-trail' }] },
      { on: 'drag', throttle: 0.075, do: [{ sound: 'pluck', map: 'velocity-glide', gain: 0.55 }] },
      { on: 'drag', when: { minSpeed: 1.2 }, throttle: 0.12, do: [{ effect: 'particle-scatter' }] },
      { on: 'drag:reverse', do: [{ effect: 'directional-sweep', params: { reverse: false } }, { effect: 'glitch-blocks' }, { sound: 'fall', map: 'velocity-glide' }] },
      { on: 'swipe', do: [{ effect: 'directional-sweep' }, { effect: 'color-cascade' }, { sound: 'rise', map: 'velocity-glide' }] },
    ],
  },
  {
    id: 'flow', name: 'FLOW', cycle: true, include: ['core.base'],
    description: 'Liquid: drags bend the checkerboard and leave long currents.',
    rules: [
      { on: 'press', do: [{ effect: 'ripple-field', params: { rings: 2, speed: 10 } }, { sound: 'bell', map: 'position-pitch', gain: 0.6 }] },
      { on: 'drag', do: [{ effect: 'energy-trail', params: { energy: 0.9, ink: 0.2 } }] },
      { on: 'drag', throttle: 0.16, do: [{ effect: 'checkerboard-warp' }, { sound: 'pluck', map: 'velocity-glide', gain: 0.45 }] },
      { on: 'swipe', do: [{ effect: 'color-cascade', params: { radius: 14 } }, { effect: 'directional-sweep', params: { strength: 0.5 } }, { sound: 'noise', map: 'velocity-glide' }] },
      { on: 'drag:reverse', do: [{ effect: 'directional-sweep', params: { reverse: true } }, { sound: 'fall' }] },
      { on: 'doubletap', do: [{ effect: 'rotating-matrix', params: { angle: 3.2, radius: 7 } }, { sound: 'chord', map: 'chord-centroid' }] },
    ],
  },
  {
    id: 'bloom', name: 'BLOOM', cycle: true, include: ['core.base'],
    description: 'Recursive geometry: shapes nest, mirror and bloom.',
    rules: [
      { on: 'press', do: [{ effect: 'recursive-bloom' }, { sound: 'bell', map: 'position-pitch' }] },
      { on: 'tap', do: [{ effect: 'mirror-field' }] },
      { on: 'doubletap', do: [{ effect: 'symmetry-explosion' }, { sound: 'chord', map: 'chord-centroid' }] },
      { on: 'drag', do: [{ effect: 'energy-trail', params: { shape: 'diamond' } }] },
      { on: 'drag', throttle: 0.18, do: [{ effect: 'mirror-field', params: { energy: 0.5, paint: true } }, { sound: 'ping', map: 'position-pitch', gain: 0.5 }] },
      { on: 'swipe', do: [{ effect: 'infinite-corridor' }, { sound: 'rise', map: 'velocity-glide' }] },
      { on: 'drag:reverse', do: [{ effect: 'recursive-bloom', params: { shape: 'diamond', depth: 3 } }, { sound: 'fall' }] },
    ],
  },
  {
    id: 'glitch', name: 'GLITCH', cycle: true, include: ['core.base'],
    description: 'Digital damage: blocks shear, scanners flash, noise ticks.',
    rules: [
      { on: 'press', do: [{ effect: 'glitch-blocks' }, { effect: 'tap-burst', params: { shape: 'square', sparks: 6 } }, { sound: 'tick', map: 'fixed' }, { sound: 'noise', map: 'position-pitch', gain: 0.5 }] },
      { on: 'tap', do: [{ effect: 'flash-grid' }] },
      { on: 'doubletap', do: [{ effect: 'cell-explosion', params: { radius: 5 } }, { sound: 'burst', map: 'fixed' }] },
      { on: 'drag', do: [{ effect: 'energy-trail', params: { shape: 'cross', paint: false } }] },
      { on: 'drag', throttle: 0.11, do: [{ effect: 'glitch-blocks', params: { blocks: 3, spread: 3 } }, { sound: 'tick', map: 'fixed', gain: 0.8 }] },
      { on: 'swipe', do: [{ effect: 'flash-grid', params: { half: 8 } }, { effect: 'directional-sweep', params: { spin: 3 } }, { sound: 'fall', map: 'velocity-glide' }] },
      { on: 'drag:reverse', do: [{ effect: 'glitch-blocks', params: { blocks: 8 } }, { sound: 'click', map: 'fixed' }] },
    ],
  },
  {
    id: 'pulse', name: 'PULSE', cycle: true, include: ['core.base'],
    description: 'Every touch starts a chain reaction; drags scatter particles.',
    rules: [
      { on: 'press', do: [{ effect: 'cellular-pulse' }, { effect: 'tap-burst', params: { sparks: 4, radius: 1.4 } }, { sound: 'pulse', map: 'position-pitch' }] },
      { on: 'doubletap', do: [{ effect: 'cellular-pulse', params: { level: 1.8, chain: { maxDepth: 16, probability: 0.75 } } }, { sound: 'thump', map: 'fixed' }] },
      { on: 'drag', do: [{ effect: 'energy-trail', params: { ink: 0.15 } }] },
      { on: 'drag', throttle: 0.09, do: [{ effect: 'particle-scatter' }, { sound: 'tick', map: 'fixed', gain: 0.7 }] },
      { on: 'swipe', do: [{ effect: 'cellular-pulse', params: { level: 1.4 } }, { effect: 'color-cascade' }, { sound: 'rise', map: 'velocity-glide' }] },
      { on: 'drag:reverse', do: [{ effect: 'directional-sweep', params: { reverse: true } }, { sound: 'burst', map: 'fixed', gain: 0.6 }] },
    ],
  },
  {
    id: 'mirror', name: 'MIRROR', cycle: true, include: ['core.base'],
    description: 'Everything you do is reflected into a symmetric composition.',
    rules: [
      { on: 'press', do: [{ effect: 'tap-burst' }, { effect: 'mirror-field' }, { sound: 'ping', map: 'position-pitch' }] },
      { on: 'tap', do: [{ effect: 'ripple-field', params: { rings: 2 } }] },
      { on: 'doubletap', do: [{ effect: 'symmetry-explosion', params: { motif: 12 } }, { sound: 'chord', map: 'chord-centroid' }] },
      { on: 'drag', do: [{ effect: 'energy-trail' }] },
      { on: 'drag', throttle: 0.06, do: [{ effect: 'mirror-field', params: { energy: 0.55, radius: 1, stagger: 0.01 } }] },
      { on: 'drag', throttle: 0.1, do: [{ sound: 'pluck', map: 'velocity-glide', gain: 0.5 }] },
      { on: 'swipe', do: [{ effect: 'symmetry-explosion' }, { effect: 'color-cascade' }, { sound: 'rise', map: 'velocity-glide' }] },
      { on: 'drag:reverse', do: [{ effect: 'directional-sweep', params: { reverse: true } }, { sound: 'fall' }] },
    ],
  },
];
