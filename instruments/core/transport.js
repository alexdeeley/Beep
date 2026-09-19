import { getContext } from "./audio-engine.js";

// Look-ahead scheduler: a setInterval only decides WHEN TO CHECK for
// upcoming musical events, never when they actually play. Every event is
// scheduled at a precise AudioContext.currentTime, which is what keeps
// timing stable under normal UI/rendering load - a janky animation frame
// can delay the *check*, never the *sound*, as long as the check still
// happens within the look-ahead window.
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_S = 0.12;
const STEPS_PER_BAR = 16;

let bpm = 120;
let running = false;
let timer = null;
let nextStepTime = 0;
let currentStep = 0; // 0..15, wraps every bar
let listeners = new Set();
let tapTimes = [];

function secondsPerStep() {
  // 16th notes: one beat = 4 steps, one bar = 16 steps (4/4).
  return 60 / bpm / 4;
}

function notify(step, time) {
  const isBeat = step % 4 === 0;
  const isBar = step === 0;
  for (const fn of listeners) {
    try {
      fn({ step, time, isBeat, isBar, stepsPerBar: STEPS_PER_BAR });
    } catch (e) {
      console.error("transport listener error", e);
    }
  }
}

function schedulerTick() {
  const ctx = getContext();
  while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
    notify(currentStep, nextStepTime);
    nextStepTime += secondsPerStep();
    currentStep = (currentStep + 1) % STEPS_PER_BAR;
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function start() {
  if (running) return;
  const ctx = getContext();
  running = true;
  currentStep = 0;
  nextStepTime = ctx.currentTime + 0.05;
  timer = setInterval(schedulerTick, LOOKAHEAD_MS);
}

export function stop() {
  running = false;
  if (timer) clearInterval(timer);
  timer = null;
}

export function isRunning() {
  return running;
}

export function getBpm() {
  return bpm;
}

// Safe mid-playback: only changes the spacing of steps scheduled from now
// on. Already-queued steps in the look-ahead window keep their original
// timing, so there's no retroactive snap/glitch on the events about to fire.
export function setBpm(next) {
  bpm = Math.max(40, Math.min(240, Math.round(next)));
  return bpm;
}

export function tapTempo() {
  const now = performance.now();
  tapTimes = tapTimes.filter((t) => now - t < 2000);
  tapTimes.push(now);
  if (tapTimes.length < 2) return bpm;
  const intervals = [];
  for (let i = 1; i < tapTimes.length; i++) intervals.push(tapTimes[i] - tapTimes[i - 1]);
  const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  setBpm(60000 / avgMs);
  return bpm;
}

export function getCurrentStep() {
  return currentStep;
}
