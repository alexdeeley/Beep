// Small synthesized sound effects. No sample files, no autoplay - only ever
// starts once the player has interacted with the page.

let ctx = null;
let master = null;
let muted = false;
try { muted = localStorage.getItem('roll.muted') === '1'; } catch {}

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
  try { localStorage.setItem('roll.muted', m ? '1' : '0'); } catch {}
}

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

// A short burst of filtered noise - a rattle/click texture, distinct from
// the tone-based cues.
function scratch(start, dur, { vol = 0.14, freq = 2200, q = 1.2 } = {}) {
  const t = ctx.currentTime + start;
  const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = 'bandpass';
  filt.frequency.value = freq;
  filt.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filt).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

const SOUNDS = {
  join() { tone(523, 0, 0.18, { type: 'triangle' }); tone(784, 0.1, 0.25, { type: 'triangle' }); },
  tap() { tone(880, 0, 0.05, { type: 'square', vol: 0.24, slide: 0.72 }); },
  // A rattling shake - several quick noise bursts at random pitches,
  // roughly matching the ~400-700ms shake animation.
  roll() {
    const hits = 7;
    for (let i = 0; i < hits; i++) {
      scratch(i * 0.05, 0.045, { vol: 0.13, freq: 1600 + Math.random() * 1400, q: 1 + Math.random() });
    }
  },
  // A couple of quick percussive clicks as the dice settle.
  land() {
    tone(340, 0, 0.05, { type: 'square', vol: 0.16, slide: 0.6 });
    tone(260, 0.05, 0.06, { type: 'square', vol: 0.14, slide: 0.6 });
  },
  hold() { tone(700, 0, 0.07, { type: 'triangle', vol: 0.2 }); tone(1050, 0.06, 0.1, { type: 'triangle', vol: 0.18 }); },
  release() { tone(700, 0, 0.06, { type: 'triangle', vol: 0.16, slide: 0.75 }); },
  tick() { tone(1100, 0, 0.07, { type: 'square', vol: 0.08 }); },
  // A category gets locked in - a short, satisfying "banked" chime.
  score() {
    [659, 880, 1047].forEach((f, i) => tone(f, i * 0.06, 0.14, { type: 'sine', vol: 0.24 }));
  },
  // The best possible roll - a bigger fanfare than a plain score.
  yahtzee() {
    const dots = [523, 587, 659, 784, 880, 1047, 1319];
    dots.forEach((f, i) => tone(f, i * 0.055, 0.12, { type: 'sine', vol: 0.25 }));
    const landAt = dots.length * 0.055 + 0.02;
    [784, 1047, 1319, 1568].forEach((f) => tone(f, landAt, 0.55, { type: 'triangle', vol: 0.22 }));
  },
  win() {
    const dots = [523, 659, 784, 1047];
    dots.forEach((f, i) => tone(f, i * 0.07, 0.14, { type: 'sine', vol: 0.24 }));
  },
  gameover() {
    [523, 587, 659, 784, 880, 1047].forEach((f, i) => tone(f, i * 0.11, 0.35, { type: 'triangle', vol: 0.22 }));
  },
};

export function play(name) {
  if (muted || !ctx || ctx.state !== 'running') return;
  try { SOUNDS[name]?.(); } catch {}
}
