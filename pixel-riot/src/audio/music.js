// Musical helpers: scales, pitch quantization, tap tempo. Pure functions (unit-tested).

export const SCALES = {
  'pentatonic-major': [0, 2, 4, 7, 9],
  'pentatonic-minor': [0, 3, 5, 7, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  'whole-tone': [0, 2, 4, 6, 8, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);

// Scale degree (can be negative / beyond one octave) -> MIDI note.
export function degreeToMidi(degree, scale = 'pentatonic-minor', root = 0, base = 48) {
  const s = SCALES[scale] || SCALES.chromatic;
  const oct = Math.floor(degree / s.length);
  const idx = ((degree % s.length) + s.length) % s.length;
  return base + root + oct * 12 + s[idx];
}

// Map normalized 0..1 to a pitch. free=true gives continuous (microtonal) pitch.
export function normToMidi(n, { scale = 'pentatonic-minor', root = 0, base = 48, octaves = 2.5, free = false } = {}) {
  n = Math.max(0, Math.min(1, n));
  if (free) return base + root + n * octaves * 12;
  const s = SCALES[scale] || SCALES.chromatic;
  const degrees = Math.max(1, Math.round(octaves * s.length));
  return degreeToMidi(Math.min(degrees, Math.floor(n * (degrees + 1))), scale, root, base);
}

// Chord tones (scale degrees stacked in thirds) from a root degree.
export function chordDegrees(rootDegree, size = 3, step = 2) {
  const out = []; for (let k = 0; k < size; k++) out.push(rootDegree + k * step); return out;
}

export class TapTempo {
  constructor({ min = 40, max = 220, window = 4.0 } = {}) { this.min = min; this.max = max; this.window = window; this.taps = []; }
  tap(tSec) {
    this.taps.push(tSec);
    this.taps = this.taps.filter((t) => tSec - t <= this.window).slice(-6);
    if (this.taps.length < 2) return null;
    const iv = []; for (let i = 1; i < this.taps.length; i++) iv.push(this.taps[i] - this.taps[i - 1]);
    iv.sort((a, b) => a - b);
    const med = iv[Math.floor(iv.length / 2)];
    if (med <= 0) return null;
    return Math.round(Math.max(this.min, Math.min(this.max, 60 / med)));
  }
  reset() { this.taps = []; }
}
