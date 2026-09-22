// Pure music-theory math, no audio dependency - scales, a root note, and
// scale-degree -> frequency conversion. Kept separate from audio.js and
// voices.js so it can be reasoned about (and tested) without a running
// AudioContext.

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const SCALES = {
  chromatic: { label: "Chromatic", degrees: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  major: { label: "Major", degrees: [0, 2, 4, 5, 7, 9, 11] },
  minor: { label: "Minor", degrees: [0, 2, 3, 5, 7, 8, 10] },
  dorian: { label: "Dorian", degrees: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { label: "Phrygian", degrees: [0, 1, 3, 5, 7, 8, 10] },
  pentatonic: { label: "Pentatonic", degrees: [0, 2, 4, 7, 9] },
  wholeTone: { label: "Whole Tone", degrees: [0, 2, 4, 6, 8, 10] },
  octatonic: { label: "Octatonic", degrees: [0, 2, 3, 5, 6, 8, 9, 11] },
};

export const MODES = ["free", "chromatic", "major", "minor", "dorian", "phrygian", "pentatonic", "wholeTone", "octatonic", "custom"];

// Anchor octave for degree 1 with octaveOffset 0 - chosen low enough that
// most percussion voices land in a useful sub/low-mid register before any
// per-voice octave/fine-tune is applied on top.
const BASE_MIDI = 48; // C3

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// degree: 1-based scale degree (wraps past the scale length into the next
// octave, e.g. degree 8 in a 7-note scale is degree 1 one octave up).
// customDegrees: used when mode === "custom" (an arbitrary 0-11 semitone set).
export function degreeToFreq({ rootSemitone = 0, mode = "major", degree = 1, octaveOffset = 0, customDegrees = null }) {
  const table = mode === "custom" ? (customDegrees && customDegrees.length ? customDegrees : SCALES.major.degrees) : (SCALES[mode]?.degrees || SCALES.major.degrees);
  const len = table.length;
  const zeroBased = Math.round(degree) - 1;
  const octaveJump = Math.floor(zeroBased / len);
  const idx = ((zeroBased % len) + len) % len;
  const semis = table[idx] + (octaveJump + octaveOffset) * 12 + rootSemitone;
  return midiToFreq(BASE_MIDI + semis);
}

export function noteNameToSemitone(name) {
  const idx = NOTE_NAMES.indexOf(name);
  return idx >= 0 ? idx : 0;
}
