// Small synthesized sound effects. No sample files, no autoplay - only ever
// starts once the player has interacted with the page (see unlockAudio()).

let ctx = null;
let master = null;
let muted = false;
try { muted = localStorage.getItem('play.muted') === '1'; } catch {}

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

export const isMuted = () => muted;
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('play.muted', m ? '1' : '0'); } catch {}
}
// True once we know whether audio is actually flowing - the caller shows
// "TAP TO ENABLE SOUND" until this is true (see app.js).
export const isRunning = () => !!ctx && ctx.state === 'running';

function tone(freq, start, dur, { type = 'sine', vol = 0.3, slide = 0 } = {}) {
  const t = ctx.currentTime + start;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

// A burst of filtered noise - explosions, static, tension textures.
function noise(start, dur, { vol = 0.3, freq = 1200, q = 0.8, type = 'lowpass' } = {}) {
  const t = ctx.currentTime + start;
  const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = type;
  filt.frequency.value = freq;
  filt.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filt).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

const SOUNDS = {
  tap() { tone(880, 0, 0.05, { type: 'square', vol: 0.24, slide: 0.72 }); },
  join() { tone(523, 0, 0.16, { type: 'triangle' }); tone(784, 0.09, 0.22, { type: 'triangle' }); },
  countdown(n) {
    const f = n <= 1 ? 880 : 660;
    tone(f, 0, 0.16, { type: 'square', vol: 0.26 });
  },
  tick() { tone(1300, 0, 0.05, { type: 'square', vol: 0.1 }); },
  // A quick fibrous snap - a rope strand parting, not a button click.
  snap() {
    noise(0, 0.05, { vol: 0.24, freq: 2400, q: 1.1, type: 'highpass' });
    tone(650, 0, 0.09, { type: 'triangle', vol: 0.2, slide: 0.35 });
  },
  // A rising pulse for "something is about to happen" - reveal pauses,
  // the machine building up before a button's fate is known.
  tension(intensity = 1) {
    tone(160 + intensity * 40, 0, 0.14, { type: 'sawtooth', vol: 0.08 + intensity * 0.05 });
    noise(0, 0.1, { vol: 0.05 + intensity * 0.04, freq: 400 + intensity * 200, type: 'bandpass', q: 2 });
  },
  correct() {
    [659, 880, 1175].forEach((f, i) => tone(f, i * 0.05, 0.14, { type: 'sine', vol: 0.24 }));
  },
  wrong() { tone(220, 0, 0.22, { type: 'sawtooth', vol: 0.22, slide: 0.6 }); },
  safe() { tone(500, 0, 0.09, { type: 'triangle', vol: 0.2 }); tone(700, 0.07, 0.12, { type: 'triangle', vol: 0.18 }); },
  explosion() {
    noise(0, 0.5, { vol: 0.45, freq: 900, q: 0.6, type: 'lowpass' });
    tone(90, 0, 0.4, { type: 'sine', vol: 0.35, slide: 0.3 });
    tone(50, 0.03, 0.5, { type: 'sine', vol: 0.3, slide: 0.25 });
  },
  // Friendly, comedic - never mean. A descending "whoop-womp" for whoever
  // gets eliminated, immediately following whichever bigger cue (explosion,
  // wrong) already played.
  eliminated() {
    tone(440, 0, 0.12, { type: 'triangle', vol: 0.18, slide: 0.7 });
    tone(330, 0.1, 0.16, { type: 'triangle', vol: 0.16, slide: 0.6 });
    tone(220, 0.22, 0.22, { type: 'triangle', vol: 0.14, slide: 0.5 });
  },
  victory() {
    const dots = [523, 587, 659, 784, 880, 1047, 1319];
    dots.forEach((f, i) => tone(f, i * 0.06, 0.13, { type: 'sine', vol: 0.25 }));
    const landAt = dots.length * 0.06 + 0.02;
    [784, 1047, 1319, 1568].forEach((f) => tone(f, landAt, 0.6, { type: 'triangle', vol: 0.22 }));
  },
  score() { tone(1200, 0, 0.05, { type: 'square', vol: 0.16 }); tone(1600, 0.05, 0.08, { type: 'square', vol: 0.14 }); },
  transition() {
    noise(0, 0.3, { vol: 0.1, freq: 1800, q: 0.5, type: 'highpass' });
    tone(300, 0, 0.25, { type: 'sine', vol: 0.14, slide: 2.2 });
  },
};

export function play(name, ...args) {
  if (muted || !ctx || ctx.state !== 'running') return;
  try { SOUNDS[name]?.(...args); } catch {}
}
