// Controlled randomness. Produces a NEW PRESET OBJECT from the current one; it never
// touches the running systems itself (the preset manager applies the result).
//
// Strengths:
//   1 SUBTLE      nudge numbers ±10–15%, maybe swap one shape
//   2 NOTICEABLE  new palette OR pattern B, shape set reshuffled, look tweaks
//   3 MAJOR       new palette + pattern pair + profile + ambient, curated compatible ranges
//   4 EXPERIMENTAL anything goes within safe bounds (still weighted toward good pairings)
//
// locks: Set of section names kept as-is: 'palette', 'pattern', 'shapes', 'interaction',
// 'ambient', 'energy', 'chain', 'look', 'symmetry'.

export const RANDOM_SECTIONS = ['palette', 'pattern', 'shapes', 'interaction', 'ambient', 'energy', 'chain', 'look', 'symmetry'];

// Curated pattern pairings that look good together (weights).
const PATTERN_PAIRS = [
  ['checker', 'concentric', 'multiply'], ['checker', 'recursive', 'xor'], ['stripes', 'noise', 'multiply'],
  ['radial', 'recursive', 'max'], ['noise', 'ripples', 'add'], ['recursive', 'cellular', 'max'],
  ['truchet', 'rotating-grid', 'add'], ['bands', 'checker', 'multiply'], ['spiral', 'concentric', 'difference'],
  ['mirror', 'radial', 'max'], ['diagonal', 'checker', 'xor'], ['clusters', 'noise', 'multiply'],
];
const SHAPE_FAMILIES = [
  ['square', 'hollow', 'nested'], ['circle', 'ring', 'concentric'], ['diamond', 'triangle', 'chevron'],
  ['hbar', 'vbar', 'plus'], ['line', 'arc', 'quarter'], ['square', 'split', 'checker'],
  ['starburst', 'cross', 'particle'], ['polygon', 'cluster', 'stripes'],
];
const AMBIENT = ['moire-shift', 'oscillator-bands', 'harmonic-grid'];

export function randomizePreset(cur, { strength = 2, locks = new Set(), rng, registries }) {
  const p = JSON.parse(JSON.stringify(cur));
  const L = (s) => locks.has(s);
  const jitter = (v, amt, a, b) => Math.min(b, Math.max(a, v * (1 + (rng.next() * 2 - 1) * amt)));
  const ids = (reg, filter = () => true) => reg.list().filter(filter).map((d) => d.id);
  const palettes = ids(registries.palettes);
  const patterns = ids(registries.patterns, (d) => d.id !== 'blank');
  const profiles = ids(registries.interactions, (d) => d.cycle);
  const shapes = ids(registries.shapes);
  p.id = 'random'; p.name = ['SUBTLE', 'SHIFT', 'MUTATION', 'CHAOS'][strength - 1] + ' ' + (rng.int(100, 999));
  delete p.builtin;

  // Numbers: every strength nudges.
  const amt = [0.12, 0.25, 0.45, 0.8][strength - 1];
  if (!L('look')) {
    p.look.patternGain = jitter(p.look.patternGain, amt, 0.15, 0.85);
    p.look.cellScale = jitter(p.look.cellScale, amt * 0.5, 0.6, 1.15);
    p.look.gap = jitter(p.look.gap, amt * 0.3, 0.75, 1);
    if (strength >= 2) p.look.hueBias = (p.look.hueBias + (rng.next() - 0.5) * amt) % 1;
    if (strength >= 3) p.look.rotateCells = rng.chance(0.3) ? rng.range(0, 0.4) : 0;
    if (strength >= 2) p.shapeMode = rng.weighted([['band', 4], ['hash', 2], ['energy', 2], ['uniform', 1]]);
  }
  if (!L('symmetry') && strength >= 2) p.look.symmetry = rng.weighted([['quad', 4], ['radial8', 3], ['radial4', 2], ['h', 1], ['v', 1], ['none', 1]]);
  if (!L('pattern')) {
    for (const slot of ['a', 'b']) if (p.pattern[slot]) for (const [k, v] of Object.entries(p.pattern[slot].params || {})) if (typeof v === 'number') p.pattern[slot].params[k] = jitter(v, amt, v * 0.3, v * 3 + 0.5);
    p.pattern.speed = jitter(p.pattern.speed ?? 1, amt * 0.6, 0.3, 2.2);
  }
  if (!L('energy')) { p.energy.decay = jitter(p.energy.decay, amt, 0.6, 3.5); p.energy.spread = jitter(p.energy.spread, amt, 0.05, 0.3); }
  if (!L('chain')) {
    p.chain.probability = jitter(p.chain.probability, amt, 0.3, 0.85);
    p.chain.maxDepth = Math.round(jitter(p.chain.maxDepth, amt, 4, 18));
    if (strength >= 3) { p.chain.symmetry = rng.weighted([['none', 3], ['quad', 2], ['radial4', 1], ['h', 1]]); p.chain.radius = rng.weighted([[1, 4], [2, 1]]); }
  }

  if (strength === 1) {
    if (!L('shapes') && rng.chance(0.4) && p.shapes.length) p.shapes[rng.int(0, p.shapes.length - 1)] = rng.pick(shapes);
    return p;
  }
  if (!L('shapes')) p.shapes = rng.chance(strength >= 4 ? 0.4 : 0.85) ? rng.pick(SHAPE_FAMILIES).slice() : rng.shuffle(shapes).slice(0, rng.int(1, 4));
  p.shapes = p.shapes.filter((s) => registries.shapes.has(s));
  if (!p.shapes.length) p.shapes = ['square'];

  if (strength === 2) {
    if (rng.chance(0.5)) { if (!L('palette')) p.palette = rng.pick(palettes); }
    else if (!L('pattern')) { p.pattern.b = { id: rng.pick(patterns), params: {} }; p.pattern.blend = rng.pick(['multiply', 'max', 'add']); p.pattern.mix = rng.range(0.3, 0.7); }
    return p;
  }
  if (!L('palette')) p.palette = rng.pick(palettes);
  if (!L('pattern')) {
    if (strength === 3 || rng.chance(0.6)) {
      const [a, b, blend] = rng.pick(PATTERN_PAIRS.filter(([x, y]) => patterns.includes(x) && patterns.includes(y)));
      p.pattern = { a: { id: a, params: {} }, b: rng.chance(0.75) ? { id: b, params: {} } : null, blend, mix: rng.range(0.35, 0.8), speed: rng.range(0.6, 1.5) };
    } else {
      p.pattern = { a: { id: rng.pick(patterns), params: {} }, b: { id: rng.pick(patterns), params: {} }, blend: rng.pick(['mix', 'add', 'multiply', 'max', 'difference', 'xor']), mix: rng.range(0.2, 1), speed: rng.range(0.4, 2) };
    }
  }
  if (!L('interaction') && profiles.length) p.interaction = rng.pick(profiles);
  if (!L('ambient')) {
    const n = strength === 4 ? rng.int(0, 2) : rng.weighted([[0, 3], [1, 2]]);
    p.ambient = rng.shuffle(AMBIENT.filter((id) => registries.effects.has(id))).slice(0, n).map((effect) => ({ effect, params: {} }));
  }
  if (!L('energy')) p.energy.behavior = rng.pick(registries.energyBehaviors.ids());
  if (strength === 4) p.trails = rng.range(0, 0.75);
  return p;
}
