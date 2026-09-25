// Small synthesized sounds. No files, no background music.

let ctx = null;
let master = null;
let muted = false;
try { muted = localStorage.getItem('dt.muted') === '1'; } catch {}

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
  try { localStorage.setItem('dt.muted', m ? '1' : '0'); } catch {}
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

const SOUNDS = {
  join() { tone(523, 0, 0.18, { type: 'triangle' }); tone(784, 0.1, 0.25, { type: 'triangle' }); },
  start() { [392, 523, 659].forEach((f, i) => tone(f, i * 0.09, 0.22, { type: 'triangle', vol: 0.25 })); },
  tick() { tone(1100, 0, 0.07, { type: 'square', vol: 0.08 }); },
  nope() { tone(330, 0, 0.18, { type: 'triangle', vol: 0.2, slide: 0.7 }); },
  close() { tone(520, 0, 0.12, { type: 'triangle', vol: 0.2 }); tone(620, 0.1, 0.14, { type: 'triangle', vol: 0.2 }); },
  win() {
    // A little run of bright "dots" climbing a major scale, landing on a
    // sparkly resolving chord - a small charming fanfare for a correct guess.
    const dots = [523, 587, 659, 784, 880, 1047];
    dots.forEach((f, i) => tone(f, i * 0.06, 0.1, { type: 'sine', vol: 0.24 }));
    const landAt = dots.length * 0.06 + 0.02;
    [784, 1047, 1319].forEach((f) => tone(f, landAt, 0.5, { type: 'triangle', vol: 0.22 }));
    tone(1976, landAt + 0.05, 0.6, { type: 'sine', vol: 0.15 });
  },
  timeup() { tone(440, 0, 0.25, { type: 'triangle', slide: 0.6 }); tone(330, 0.2, 0.35, { type: 'triangle', slide: 0.6 }); },
  over() {
    [523, 587, 659, 784, 880, 1047].forEach((f, i) => tone(f, i * 0.11, 0.35, { type: 'triangle', vol: 0.22 }));
  },
  pop() { tone(700, 0, 0.06, { type: 'sine', vol: 0.12, slide: 1.6 }); },
};

export function play(name) {
  if (muted || !ctx || ctx.state !== 'running') return;
  try { SOUNDS[name]?.(); } catch {}
}
