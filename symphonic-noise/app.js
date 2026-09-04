// Symphonic Noise — Phase 2
//
// A generative harmony engine drives four layered voices from one shared
// chord/root state, so they always stay in tune with each other while the
// harmony drifts forever without looping:
//   - pad      sustained chord voice (strings-like)
//   - brass    occasional swelling accent on a subset of the chord
//   - sub      continuous low drone that glides to the new root
//   - texture  filtered noise wash — the "wall of noise" underneath it all

const beginBtn = document.getElementById("begin");
const volumeSlider = document.getElementById("volume");
const statusEl = document.getElementById("status");

// A D minor pentatonic scale (D F G A C) spread across three octaves.
// Pentatonic has no half-steps or tritones between any two of its notes,
// so *any* random subset is consonant — that's the generative safety rail
// that lets the composer pick notes freely without ever sounding "wrong".
const SCALE = [
  "D2", "A2", "C3", "D3", "F3", "G3", "A3",
  "C4", "D4", "F4", "G4", "A4", "C5",
];

// The scale's two strongest resting tones, used as the sub-drone root.
// Weighted toward D (the tonic) so the tonal center mostly holds, with
// occasional drifts to A (the fifth) for slow harmonic movement.
const ROOTS = [
  { note: "D1", weight: 0.7 },
  { note: "A1", weight: 0.3 },
];

const state = {
  playing: false,
  initialized: false,
  chordTimer: null,
  // audio nodes, created once in initAudio()
  limiter: null,
  masterVolume: null,
  reverb: null,
  chordSynth: null,
  brassSynth: null,
  brassFilter: null,
  brassFilterLfo: null,
  subDrone: null,
  subGain: null,
  noise: null,
  noiseFilter: null,
  noiseFilterLfo: null,
  noiseGain: null,
};

function dbFromGain(gain) {
  return 20 * Math.log10(Math.max(gain, 0.0001));
}

function pickRoot() {
  const roll = Math.random();
  let acc = 0;
  for (const root of ROOTS) {
    acc += root.weight;
    if (roll <= acc) return root.note;
  }
  return ROOTS[0].note;
}

function pickChord() {
  const shuffled = [...SCALE].sort(() => Math.random() - 0.5);
  const size = 3 + Math.floor(Math.random() * 2); // 3-4 notes
  return shuffled.slice(0, size);
}

async function initAudio() {
  const limiter = new Tone.Limiter(-1).toDestination();
  const masterVolume = new Tone.Volume(
    dbFromGain(parseFloat(volumeSlider.value))
  ).connect(limiter);

  const reverb = new Tone.Reverb({ decay: 14, wet: 0.6 });
  reverb.connect(masterVolume);
  await reverb.generate();

  // Pad: sustained chord voice, the main "wall" body.
  const chordSynth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "fatsawtooth", count: 3, spread: 30 },
    envelope: { attack: 6, decay: 2, sustain: 1, release: 10 },
  });
  chordSynth.volume.value = -10;
  chordSynth.connect(reverb);

  // Brass: occasional slow swells on a subset of the current chord.
  const brassFilter = new Tone.Filter(1800, "lowpass");
  const brassFilterLfo = new Tone.LFO({ frequency: 0.04, min: 700, max: 2600 }).start();
  brassFilterLfo.connect(brassFilter.frequency);
  const brassSynth = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 2,
    modulationIndex: 3,
    envelope: { attack: 5, decay: 2, sustain: 0.5, release: 8 },
    modulationEnvelope: { attack: 5, decay: 2, sustain: 0.5, release: 8 },
  });
  brassSynth.volume.value = -16;
  brassSynth.connect(brassFilter);
  brassFilter.connect(reverb);

  // Sub drone: continuous low root note, dry (no reverb) to stay tight.
  const subGain = new Tone.Gain(0).connect(masterVolume);
  const subDrone = new Tone.Oscillator({ frequency: "D1", type: "sine" }).connect(subGain);
  subDrone.start();

  // Texture: filtered noise wash, dry, the "wall of noise" underneath.
  const noiseGain = new Tone.Gain(0).connect(masterVolume);
  const noiseFilter = new Tone.Filter(600, "bandpass").connect(noiseGain);
  noiseFilter.Q.value = 1.2;
  const noiseFilterLfo = new Tone.LFO({ frequency: 0.03, min: 300, max: 1400 }).start();
  noiseFilterLfo.connect(noiseFilter.frequency);
  const noise = new Tone.Noise("pink").connect(noiseFilter);
  noise.start();

  Object.assign(state, {
    limiter,
    masterVolume,
    reverb,
    chordSynth,
    brassSynth,
    brassFilter,
    brassFilterLfo,
    subDrone,
    subGain,
    noise,
    noiseFilter,
    noiseFilterLfo,
    noiseGain,
  });
  state.initialized = true;
}

function maybeSwellBrass(chord) {
  if (Math.random() > 0.55) return;
  const notes = [...chord].sort(() => Math.random() - 0.5).slice(0, 2);
  const swellDuration = 10 + Math.random() * 8;
  state.brassSynth.triggerAttackRelease(notes, swellDuration, Tone.now() + 1);
}

function advanceHarmony() {
  if (!state.playing) return;

  const chord = pickChord();
  const root = pickRoot();
  const holdSeconds = 16 + Math.random() * 14; // 16-30s of active voice
  const durationSeconds = holdSeconds + 10; // + release tail

  state.chordSynth.triggerAttackRelease(chord, durationSeconds, Tone.now());
  state.subDrone.frequency.rampTo(root, 4);
  maybeSwellBrass(chord);

  // Start the next chord before this one's tail fully fades, so the wash
  // of sound never has a gap or a hard edge.
  const overlapSeconds = 4;
  state.chordTimer = setTimeout(advanceHarmony, (holdSeconds - overlapSeconds) * 1000);
}

function stopAudio() {
  state.playing = false;
  clearTimeout(state.chordTimer);
  state.chordSynth.releaseAll(2);
  state.brassSynth.releaseAll(2);
  state.subGain.gain.rampTo(0, 3);
  state.noiseGain.gain.rampTo(0, 3);
  beginBtn.textContent = "Begin";
  statusEl.textContent = "Stopped.";
}

beginBtn.addEventListener("click", async () => {
  if (state.playing) {
    stopAudio();
    return;
  }

  beginBtn.disabled = true;
  statusEl.textContent = "Waking up the orchestra…";

  await Tone.start();
  if (!state.initialized) {
    await initAudio();
  }

  state.playing = true;
  state.subGain.gain.rampTo(0.45, 4);
  state.noiseGain.gain.rampTo(0.12, 6);
  advanceHarmony();

  beginBtn.textContent = "Stop";
  beginBtn.disabled = false;
  statusEl.textContent = "Playing — generative, never repeats the same way twice.";
});

volumeSlider.addEventListener("input", () => {
  if (state.masterVolume) {
    state.masterVolume.volume.value = dbFromGain(parseFloat(volumeSlider.value));
  }
});

// Sidelined from the gallery: unregister any service worker left over from
// when this was its own installable app, so it stops intercepting requests
// in this scope for anyone who still has it registered.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      for (const reg of regs) reg.unregister();
    }).catch(() => {});
  });
}
