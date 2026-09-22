// Single shared AudioContext for the whole drum machine, plus the master
// gain-stage chain and the three shared effect-send buses every voice can
// route into. Deliberately self-contained (no dependency on the
// Instruments app's own audio engine) since this is a standalone
// instrument with its own transport and its own performance surface.
//
//   voice dry output ----------------------------> masterInput
//   voice delay send -> delayBus  -----------------> masterInput
//   voice reverb send -> reverbBus -----------------> masterInput
//   voice distortion send -> distortionBus ---------> masterInput
//   masterInput -> masterFilter -> compressor -> limiter -> destination

let ctx = null;
let masterInput = null;
let masterFilter = null;
let limiter = null;
let delayBus = null;
let reverbBus = null;
let distortionBus = null;
let started = false;

export function getContext() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    buildMasterChain();
  }
  return ctx;
}

function buildMasterChain() {
  masterInput = ctx.createGain();
  masterInput.gain.value = 0.9;

  masterFilter = ctx.createBiquadFilter();
  masterFilter.type = "lowpass";
  masterFilter.frequency.value = 20000; // wide open by default - the "Filter" macro pulls this down

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 8;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.006;
  compressor.release.value = 0.18;

  // A second, harder stage acts purely as a safety limiter - never meant
  // to be heard doing work in normal use, just a backstop against
  // multiple simultaneous hits (or a runaway macro) clipping digitally.
  limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 1;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;

  masterInput.connect(masterFilter);
  masterFilter.connect(compressor);
  compressor.connect(limiter);
  limiter.connect(ctx.destination);

  delayBus = createDelayBus(masterInput);
  reverbBus = createReverbBus(masterInput);
  distortionBus = createDistortionBus(masterInput);
}

function createDelayBus(dest) {
  const input = ctx.createGain();
  input.gain.value = 1;
  const delay = ctx.createDelay(2);
  delay.delayTime.value = 0.28;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.35;
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 4000;
  const wet = ctx.createGain();
  wet.gain.value = 1;

  input.connect(delay);
  delay.connect(tone);
  tone.connect(feedback);
  feedback.connect(delay);
  tone.connect(wet);
  wet.connect(dest);

  return {
    input,
    setTime(seconds) { delay.delayTime.setTargetAtTime(Math.max(0.005, seconds), ctx.currentTime, 0.02); },
    setFeedback(amount) { feedback.gain.setTargetAtTime(Math.min(0.92, Math.max(0, amount)), ctx.currentTime, 0.02); },
    setFilter(hz) { tone.frequency.setTargetAtTime(hz, ctx.currentTime, 0.02); },
  };
}

function makeImpulseResponse(durationSeconds, decayPower) {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * durationSeconds));
  const impulse = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decayPower);
    }
  }
  return impulse;
}

function createReverbBus(dest) {
  const input = ctx.createGain();
  input.gain.value = 1;
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 6000;
  const convolver = ctx.createConvolver();
  convolver.buffer = makeImpulseResponse(2.2, 2.5);
  const wet = ctx.createGain();
  wet.gain.value = 0.9;

  input.connect(tone);
  tone.connect(convolver);
  convolver.connect(wet);
  wet.connect(dest);

  let size = 0.6;
  let decayS = 2.2;

  return {
    input,
    setSize(v) {
      size = Math.max(0.05, Math.min(1, v));
      convolver.buffer = makeImpulseResponse(0.3 + size * 3.2, 2.5);
    },
    setDecay(seconds) {
      decayS = Math.max(0.3, Math.min(6, seconds));
      convolver.buffer = makeImpulseResponse(0.3 + size * decayS, 2.5);
    },
    setTone(hz) { tone.frequency.setTargetAtTime(hz, ctx.currentTime, 0.02); },
    setMix(v) { wet.gain.setTargetAtTime(v, ctx.currentTime, 0.02); },
  };
}

function makeDriveCurve(amount, character) {
  const n = 2048;
  const curve = new Float32Array(n);
  const k = amount * (character === "hard" ? 220 : 60);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = character === "hard"
      ? Math.max(-1, Math.min(1, x * (1 + k / 20)))
      : Math.tanh(x * (1 + k));
  }
  return curve;
}

function createDistortionBus(dest) {
  const input = ctx.createGain();
  input.gain.value = 1;
  const shaper = ctx.createWaveShaper();
  shaper.curve = makeDriveCurve(0.3, "soft");
  shaper.oversample = "4x";
  const wet = ctx.createGain();
  wet.gain.value = 0.8;

  input.connect(shaper);
  shaper.connect(wet);
  wet.connect(dest);

  return {
    input,
    setDrive(v, character) { shaper.curve = makeDriveCurve(v, character || "soft"); },
    setMix(v) { wet.gain.setTargetAtTime(v, ctx.currentTime, 0.02); },
  };
}

export function getMasterInput() { getContext(); return masterInput; }
export function getMasterFilter() { getContext(); return masterFilter; }
export function getDelayBus() { getContext(); return delayBus; }
export function getReverbBus() { getContext(); return reverbBus; }
export function getDistortionBus() { getContext(); return distortionBus; }

export async function ensureStarted() {
  const c = getContext();
  if (c.state === "suspended") await c.resume();
  started = true;
  return c;
}

export function isStarted() {
  return started && ctx && ctx.state === "running";
}

// Small helper used throughout the voice engines to avoid zipper noise:
// ramps an AudioParam instead of snapping it, and handles the "ramp to
// zero" case safely (exponential ramps can't target exactly 0).
export function rampTo(param, value, time, now) {
  const t = now ?? getContext().currentTime;
  param.cancelScheduledValues(t);
  const current = param.value;
  param.setValueAtTime(current, t);
  if (value <= 0.0001) {
    param.linearRampToValueAtTime(0.0001, t + time);
  } else if (current <= 0.0001) {
    param.setValueAtTime(value, t + time);
  } else {
    param.exponentialRampToValueAtTime(Math.max(0.0001, value), t + time);
  }
}

// Generic look-ahead scheduling clock - the ONLY thing that reads
// wall-clock time via setInterval. Everything downstream (the looper's
// event scheduling) works exclusively in AudioContext.currentTime, so a
// janky UI frame can delay when this clock's tick is *checked*, never
// when an already-scheduled sound actually plays.
export function createClock({ lookaheadSeconds = 0.12, pollMs = 25, onTick }) {
  let timer = null;
  return {
    start() {
      if (timer) return;
      timer = setInterval(() => {
        const now = getContext().currentTime;
        onTick(now, now + lookaheadSeconds);
      }, pollMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    isRunning: () => !!timer,
  };
}
