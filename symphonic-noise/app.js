// Symphonic Noise — Phase 1
//
// A single generative pad voice: chords are drawn from a fixed consonant
// scale and crossfaded into each other on random, overlapping timers, so
// the harmony drifts forever without ever looping or repeating exactly.

const beginBtn = document.getElementById("begin");
const volumeSlider = document.getElementById("volume");
const statusEl = document.getElementById("status");

// A wide, evenly-spread scale (D aeolian) so any random subset of notes
// still sounds consonant together — the generative "safety rail".
const SCALE = [
  "D2", "A2", "C3", "D3", "F3", "G3", "A3",
  "C4", "D4", "F4", "G4", "A4", "C5",
];

const state = {
  playing: false,
  chordTimer: null,
  chordSynth: null,
  reverb: null,
  masterVolume: null,
  limiter: null,
};

function dbFromGain(gain) {
  return 20 * Math.log10(Math.max(gain, 0.0001));
}

async function initAudio() {
  const limiter = new Tone.Limiter(-1).toDestination();
  const masterVolume = new Tone.Volume(
    dbFromGain(parseFloat(volumeSlider.value))
  ).connect(limiter);

  const reverb = new Tone.Reverb({ decay: 14, wet: 0.6 });
  reverb.connect(masterVolume);
  await reverb.generate();

  const chordSynth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "fatsawtooth", count: 3, spread: 30 },
    envelope: { attack: 6, decay: 2, sustain: 1, release: 10 },
  });
  chordSynth.volume.value = -10;
  chordSynth.connect(reverb);

  state.limiter = limiter;
  state.masterVolume = masterVolume;
  state.reverb = reverb;
  state.chordSynth = chordSynth;
}

function pickChord() {
  const shuffled = [...SCALE].sort(() => Math.random() - 0.5);
  const size = 3 + Math.floor(Math.random() * 2); // 3-4 notes
  return shuffled.slice(0, size);
}

function scheduleNextChord() {
  if (!state.playing) return;

  const chord = pickChord();
  const holdSeconds = 16 + Math.random() * 14; // 16-30s of active voice
  const durationSeconds = holdSeconds + 10; // + release tail

  state.chordSynth.triggerAttackRelease(chord, durationSeconds, Tone.now());

  // Start the next chord before this one's tail fully fades, so the wash
  // of sound never has a gap or a hard edge.
  const overlapSeconds = 4;
  state.chordTimer = setTimeout(
    scheduleNextChord,
    (holdSeconds - overlapSeconds) * 1000
  );
}

function stopAudio() {
  state.playing = false;
  clearTimeout(state.chordTimer);
  if (state.chordSynth) state.chordSynth.releaseAll(2);
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
  if (!state.chordSynth) {
    await initAudio();
  }

  state.playing = true;
  scheduleNextChord();

  beginBtn.textContent = "Stop";
  beginBtn.disabled = false;
  statusEl.textContent =
    "Playing — generative, never repeats the same way twice.";
});

volumeSlider.addEventListener("input", () => {
  if (state.masterVolume) {
    state.masterVolume.volume.value = dbFromGain(
      parseFloat(volumeSlider.value)
    );
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
