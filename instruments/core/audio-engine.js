// Single shared AudioContext for the whole Instruments app. Every instrument
// gets its own gain-staged bus off the same context - never a context per
// instrument, since browsers cap how many contexts can be running/resumed
// at once and there's no way to keep N independent contexts in sample-accurate
// sync anyway.
//
//   instrument engine -> instrument effects -> instrument gain (mixer channel)
//     -> master bus -> safety limiter -> destination

let ctx = null;
let masterBus = null;
let limiter = null;
let started = false;

export function getContext() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterBus = ctx.createGain();
    masterBus.gain.value = 0.9;

    // Soft safety ceiling, not a creative effect - keeps N simultaneous
    // instruments (each with its own uncoordinated gain staging) from
    // summing into hard digital clipping.
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;

    masterBus.connect(limiter);
    limiter.connect(ctx.destination);
  }
  return ctx;
}

export function getMasterBus() {
  getContext();
  return masterBus;
}

// Must be called from inside a real user gesture handler (click/pointerup).
// Safe to call repeatedly - a no-op once already running.
export async function ensureStarted() {
  const c = getContext();
  if (c.state === "suspended") {
    await c.resume();
  }
  started = true;
  return c;
}

export function isStarted() {
  return started && ctx && ctx.state === "running";
}

// Creates a fresh instrument output bus: a plain GainNode already wired to
// the master bus. Instruments connect their final node here; the mixer
// channel strip (volume/mute) later inserts itself between the instrument
// and this bus - see components/mixer.js.
export function createInstrumentBus() {
  const c = getContext();
  const bus = c.createGain();
  bus.gain.value = 1;
  bus.connect(masterBus);
  return bus;
}

// Small helper used throughout the synths to avoid zipper noise / clicks:
// ramps instead of snapping AudioParam values.
export function rampTo(param, value, time, now) {
  const t = now ?? getContext().currentTime;
  param.cancelScheduledValues(t);
  param.setValueAtTime(param.value, t);
  if (value <= 0) {
    param.exponentialRampToValueAtTime(0.0001, t + time);
    param.linearRampToValueAtTime(0, t + time + 0.001);
  } else {
    param.exponentialRampToValueAtTime(Math.max(0.0001, value), t + time);
  }
}
