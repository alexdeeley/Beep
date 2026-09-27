// Small synthesized sound effects. No sample files.

let ctx = null;
let master = null;
let muted = false;
try { muted = localStorage.getItem('bj.muted') === '1'; } catch {}

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
  try { localStorage.setItem('bj.muted', m ? '1' : '0'); } catch {}
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

// A short burst of filtered noise - a card-slide / chip-click texture,
// distinct from the tone-based cues.
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
  deal() { scratch(0, 0.06, { vol: 0.16, freq: 1800 }); },
  chip() { tone(1400, 0, 0.03, { type: 'square', vol: 0.12 }); tone(1100, 0.03, 0.05, { type: 'square', vol: 0.1 }); },
  flip() { tone(600, 0, 0.08, { type: 'triangle', vol: 0.18 }); tone(900, 0.08, 0.12, { type: 'triangle', vol: 0.18 }); },
  tick() { tone(1100, 0, 0.07, { type: 'square', vol: 0.08 }); },
  win() {
    const dots = [523, 659, 784, 1047];
    dots.forEach((f, i) => tone(f, i * 0.07, 0.14, { type: 'sine', vol: 0.24 }));
  },
  blackjack() {
    // A bigger fanfare than a plain win - this is the best possible hand.
    const dots = [523, 587, 659, 784, 880, 1047, 1319];
    dots.forEach((f, i) => tone(f, i * 0.055, 0.12, { type: 'sine', vol: 0.24 }));
    const landAt = dots.length * 0.055 + 0.02;
    [784, 1047, 1319, 1568].forEach((f) => tone(f, landAt, 0.55, { type: 'triangle', vol: 0.2 }));
  },
  bust() { tone(330, 0, 0.2, { type: 'triangle', vol: 0.22, slide: 0.55 }); tone(220, 0.15, 0.3, { type: 'triangle', vol: 0.2, slide: 0.6 }); },
  push() { tone(500, 0, 0.16, { type: 'triangle', vol: 0.18 }); tone(500, 0.14, 0.16, { type: 'triangle', vol: 0.16 }); },
  close() { tone(520, 0, 0.12, { type: 'triangle', vol: 0.2 }); tone(620, 0.1, 0.14, { type: 'triangle', vol: 0.2 }); },
};

export function play(name) {
  if (muted || !ctx || ctx.state !== 'running') return;
  try { SOUNDS[name]?.(); } catch {}
}
