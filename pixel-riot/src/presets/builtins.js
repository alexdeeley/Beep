// Built-in instrument presets. Each is a real configuration of the running systems
// (palette, pattern layers, shapes, interaction profile, ambient effects, energy
// behaviour, chain reaction tuning) — not a picture.

const P = (o) => ({ format: 'pixel-riot-preset', version: 1, builtin: true, ...o });

// ============================================================
// EXTENSION ZONE: PRESETS
// PURPOSE: Ship instrument configurations.
// CONTRACT: src/presets/preset-schema.js (format pixel-riot-preset, version 1).
// SAFETY: Data only; validated on registration; unknown ids fall back with warnings.
// INTEGRATION: api.presets.register(preset). Example: src/extensions/examples/example-preset.js
// ============================================================
export const BUILTIN_PRESETS = [
  P({ id: 'glass-grid', name: 'GLASS GRID', palette: 'white-electric',
    pattern: { a: { id: 'checker', params: { speed: 0.5 } }, b: { id: 'concentric', params: { freq: 7 } }, blend: 'multiply', mix: 0.55 },
    shapes: ['square', 'hollow', 'nested'], shapeMode: 'band', interaction: 'riot',
    look: { patternGain: 0.78, cellScale: 0.95, gap: 0.86, symmetry: 'quad' }, energy: { behavior: 'diffuse', decay: 1.6, spread: 0.18 } }),
  P({ id: 'electric-rain', name: 'ELECTRIC RAIN', palette: 'ice',
    pattern: { a: { id: 'stripes', params: { freq: 14, speed: 1.6, angle: 1.5708 } }, b: { id: 'noise', params: { scale: 3 } }, blend: 'multiply', mix: 0.7 },
    shapes: ['vbar', 'line', 'particle'], shapeMode: 'band', interaction: 'flow', trails: 0.6,
    look: { patternGain: 0.7, cellScale: 0.9, gap: 0.9 }, energy: { behavior: 'drift', decay: 1.1 },
    ambient: [{ effect: 'oscillator-bands', params: { bands: 10, vertical: true, strength: 0.18 } }] }),
  P({ id: 'pulse-matrix', name: 'PULSE MATRIX', palette: 'cyan-magenta',
    pattern: { a: { id: 'blank' } }, shapes: ['square', 'plus', 'cross'], shapeMode: 'energy', interaction: 'pulse',
    look: { patternGain: 0.2, cellScale: 0.95, gap: 0.82 }, ambient: [{ effect: 'harmonic-grid', params: { strength: 0.35 } }],
    chain: { radius: 1, delay: 0.05, decay: 0.85, maxDepth: 12, probability: 0.6, symmetry: 'none' }, music: { tempo: 118 } }),
  P({ id: 'neon-cathedral', name: 'NEON CATHEDRAL', palette: 'ultraviolet',
    pattern: { a: { id: 'radial', params: { folds: 12, speed: 0.25 } }, b: { id: 'recursive', params: { speed: 0.2 } }, blend: 'max', mix: 0.6 },
    shapes: ['diamond', 'triangle', 'arc', 'chevron'], shapeMode: 'band', interaction: 'bloom', trails: 0.5,
    look: { patternGain: 0.5, cellScale: 1, gap: 0.92, symmetry: 'radial8' }, energy: { behavior: 'pulse', decay: 1.2 } }),
  P({ id: 'pixel-drum-machine', name: 'PIXEL DRUM MACHINE', palette: 'red-black-white',
    pattern: { a: { id: 'bands', params: { bands: 4, speed: 1 } } }, shapes: ['square', 'hbar', 'checker'], shapeMode: 'band', interaction: 'glitch',
    look: { patternGain: 0.5, cellScale: 0.9, gap: 0.8 }, ambient: [{ effect: 'harmonic-grid', params: { strength: 0.6, harmonics: [1, 2, 4, 8] } }],
    energy: { behavior: 'still', decay: 3 }, music: { tempo: 124 } }),
  P({ id: 'chromatic-storm', name: 'CHROMATIC STORM', palette: 'spectrum',
    pattern: { a: { id: 'noise', params: { scale: 2.6, speed: 0.6 } }, b: { id: 'ripples', params: { freq: 9 } }, blend: 'add', mix: 0.4 },
    shapes: ['circle', 'ring', 'starburst', 'particle'], shapeMode: 'hash', interaction: 'riot', trails: 0.55,
    look: { patternGain: 0.65, cellScale: 0.9, gap: 0.9, hueBias: 0.1 }, energy: { behavior: 'drift', decay: 1.3 },
    chain: { probability: 0.7, maxDepth: 12, colorInherit: 0.8 } }),
  P({ id: 'white-noise-geometry', name: 'WHITE NOISE GEOMETRY', palette: 'mono-white',
    pattern: { a: { id: 'clusters', params: { block: 8, speed: 0.5 } } }, shapes: ['square', 'split', 'quarter', 'triangle'], shapeMode: 'hash', interaction: 'glitch',
    look: { patternGain: 0.5, cellScale: 0.95, gap: 0.94 }, energy: { behavior: 'still', decay: 2 } }),
  P({ id: 'recursive-garden', name: 'RECURSIVE GARDEN', palette: 'acid',
    pattern: { a: { id: 'recursive', params: { speed: 0.3 } }, b: { id: 'cellular' }, blend: 'max', mix: 0.5 },
    shapes: ['nested', 'circle', 'plus', 'cluster'], shapeMode: 'band', interaction: 'bloom',
    look: { patternGain: 0.42, cellScale: 0.95, gap: 0.86, symmetry: 'quad' }, energy: { behavior: 'pulse', decay: 1.4 } }),
  P({ id: 'infinite-checkerboard', name: 'INFINITE CHECKERBOARD', palette: 'mono-white',
    pattern: { a: { id: 'checker', params: { speed: 1.4 } }, b: { id: 'recursive', params: { speed: 0.45 } }, blend: 'xor', mix: 1 },
    shapes: ['square'], shapeMode: 'uniform', interaction: 'flow',
    look: { patternGain: 0.75, cellScale: 1, gap: 1 }, energy: { behavior: 'diffuse', decay: 1.6 } }),
  P({ id: 'liquid-squares', name: 'LIQUID SQUARES', palette: 'white-electric',
    pattern: { a: { id: 'diagonal', params: { freq: 6, speed: 0.8 } } }, shapes: ['square', 'hollow'], shapeMode: 'band', interaction: 'flow', trails: 0.65,
    look: { patternGain: 0.55, cellScale: 1.05, gap: 0.9, rotateCells: 0.15 }, energy: { behavior: 'drift', decay: 0.9, spread: 0.24 } }),
  P({ id: 'hypnotic-spiral', name: 'HYPNOTIC SPIRAL', palette: 'red-black-white',
    pattern: { a: { id: 'spiral', params: { arms: 4, twist: 3, speed: 0.9 } } }, shapes: ['circle', 'ring', 'concentric'], shapeMode: 'band', interaction: 'mirror',
    look: { patternGain: 0.6, cellScale: 0.95, gap: 0.9, symmetry: 'radial4' }, ambient: [{ effect: 'moire-shift', params: { strength: 0.2, alpha: 0.12 } }] }),
  P({ id: 'rhythm-engine', name: 'RHYTHM ENGINE', palette: 'warm',
    pattern: { a: { id: 'bands', params: { bands: 8, speed: 0.8 } }, b: { id: 'checker' }, blend: 'multiply', mix: 0.5 },
    shapes: ['hbar', 'square', 'stripes'], shapeMode: 'band', interaction: 'pulse',
    look: { patternGain: 0.55, cellScale: 0.92, gap: 0.86 }, ambient: [{ effect: 'harmonic-grid', params: { strength: 0.5 } }, { effect: 'oscillator-bands', params: { bands: 8, strength: 0.15 } }],
    chain: { delay: 0.0625, maxDepth: 8, probability: 0.65, soundInherit: 0.7 }, music: { tempo: 128 } }),
  P({ id: 'cellular-bloom', name: 'CELLULAR BLOOM', palette: 'harmony',
    pattern: { a: { id: 'cellular', params: { step: 0.18 } } }, shapes: ['circle', 'square', 'diamond'], shapeMode: 'energy', interaction: 'pulse',
    look: { patternGain: 0.75, cellScale: 0.9, gap: 0.86 }, energy: { behavior: 'diffuse', decay: 1.2, spread: 0.24 },
    chain: { radius: 2, probability: 0.45, maxDepth: 14, symmetry: 'quad', colorInherit: 0.7 } }),
  P({ id: 'midnight-circuit', name: 'MIDNIGHT CIRCUIT', palette: 'acid',
    pattern: { a: { id: 'truchet', params: { tile: 4, speed: 0.1 } }, b: { id: 'rotating-grid', params: { spacing: 0.4 } }, blend: 'add', mix: 0.3 },
    shapes: ['line', 'arc', 'plus', 'square'], shapeMode: 'band', interaction: 'flow',
    look: { patternGain: 0.45, cellScale: 0.95, gap: 0.92 }, energy: { behavior: 'drift', decay: 1.4 },
    chain: { bias: [1, 0], biasStrength: 0.6, maxDepth: 14, probability: 0.5 } }),
  P({ id: 'experimental-chaos', name: 'EXPERIMENTAL CHAOS', palette: 'harmony',
    pattern: { a: { id: 'ripples' }, b: { id: 'cellular' }, blend: 'difference', mix: 0.8, speed: 1.4 },
    shapes: ['polygon', 'starburst', 'cross', 'cluster', 'quarter'], shapeMode: 'hash', interaction: 'glitch', trails: 0.5,
    look: { patternGain: 0.65, cellScale: 1, gap: 0.9, rotateCells: 0.35, symmetry: 'radial8' },
    ambient: [{ effect: 'moire-shift', params: { strength: 0.25 } }, { effect: 'oscillator-bands', params: { strength: 0.2 } }],
    energy: { behavior: 'pulse', decay: 1 }, chain: { probability: 0.8, maxDepth: 16, symmetry: 'radial4' } }),
];
