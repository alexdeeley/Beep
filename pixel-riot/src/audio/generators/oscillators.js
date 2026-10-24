// Oscillator-based generators: basic waveforms, FM tone, sustained pad, sustained tone.
import { oscVoice, params, envAD } from './common.js';

export const sine = { id: 'sine', name: 'SINE', ...oscVoice('sine') };
export const triangle = { id: 'triangle', name: 'TRIANGLE', ...oscVoice('triangle') };
export const square = { id: 'square', name: 'SQUARE', ...oscVoice('square') };
export const saw = { id: 'saw', name: 'SAWTOOTH', ...oscVoice('sawtooth') };

// Two-operator FM: modulator -> carrier.frequency.
export const fm = {
  id: 'fm', name: 'FM TONE',
  params: params({ ratio: { min: 0.25, max: 8, default: 2 }, index: { min: 0, max: 12, default: 3 } }),
  create(ac, out, when, p) {
    const car = ac.createOscillator(), mod = ac.createOscillator(), mg = ac.createGain(), amp = ac.createGain();
    car.frequency.setValueAtTime(p.freq, when);
    mod.frequency.setValueAtTime(p.freq * p.ratio, when);
    mg.gain.setValueAtTime(p.freq * p.index, when);
    mg.gain.setTargetAtTime(p.freq * p.index * 0.1, when, p.decay / 3);
    if (p.glide !== 1) { car.frequency.exponentialRampToValueAtTime(p.freq * p.glide, when + p.decay); mod.frequency.exponentialRampToValueAtTime(p.freq * p.ratio * p.glide, when + p.decay); }
    const end = envAD(amp.gain, when, p.attack, p.decay, p.gain * 0.45);
    mod.connect(mg); mg.connect(car.frequency); car.connect(amp); amp.connect(out);
    car.start(when); mod.start(when); car.stop(end); mod.stop(end);
    return { end, stop: (t) => { try { car.stop(t); mod.stop(t); } catch {} } };
  },
};

// Sustained detuned-saw pad through a resonant lowpass. Held until released.
export const pad = {
  id: 'pad', name: 'SOFT PAD', sustain: true,
  params: params({ attack: { min: 0.01, max: 4, default: 0.6 }, detune: { min: 0, max: 40, default: 12 } }),
  create(ac, out, when, p) {
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(p.cutoff * 0.3, when); lp.Q.value = 2 + p.bright * 6;
    const amp = ac.createGain(); amp.gain.setValueAtTime(0, when); amp.gain.linearRampToValueAtTime(p.gain * 0.22, when + p.attack);
    const oscs = [-1, 0, 1].map((k) => { const o = ac.createOscillator(); o.type = k === 0 ? 'triangle' : 'sawtooth'; o.frequency.setValueAtTime(p.freq * (k === 0 ? 0.5 : 1), when); o.detune.value = k * p.detune; o.connect(lp); o.start(when); return o; });
    lp.connect(amp); amp.connect(out);
    return {
      end: Infinity,
      set(q, t) {
        if (q.freq) oscs.forEach((o, k) => o.frequency.setTargetAtTime(q.freq * (k === 1 ? 0.5 : 1), t, 0.05));
        if (q.cutoff) lp.frequency.setTargetAtTime(q.cutoff * 0.3, t, 0.08);
        if (q.gain != null) amp.gain.setTargetAtTime(q.gain * 0.22, t, 0.08);
      },
      release(t, r) { amp.gain.cancelScheduledValues(t); amp.gain.setTargetAtTime(0, t, r / 4); oscs.forEach((o) => o.stop(t + r + 0.2)); },
      stop: (t) => oscs.forEach((o) => { try { o.stop(t); } catch {} }),
    };
  },
};

// Sustained energy tone for long presses: a sine+square blend whose pitch and filter
// rise with the charge level (set via set({ freq, cutoff, gain })).
export const drone = {
  id: 'drone', name: 'CHARGE TONE', sustain: true,
  params: params({ attack: { min: 0.01, max: 2, default: 0.15 } }),
  create(ac, out, when, p) {
    const a = ac.createOscillator(); a.type = 'sine';
    const b = ac.createOscillator(); b.type = 'square';
    const bg = ac.createGain(); bg.gain.value = 0.18;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(p.cutoff * 0.15, when); lp.Q.value = 6;
    const lfo = ac.createOscillator(); lfo.frequency.value = 5; const lg = ac.createGain(); lg.gain.value = p.freq * 0.01;
    lfo.connect(lg); lg.connect(a.frequency); lg.connect(b.frequency);
    a.frequency.setValueAtTime(p.freq, when); b.frequency.setValueAtTime(p.freq * 0.5, when);
    const amp = ac.createGain(); amp.gain.setValueAtTime(0, when); amp.gain.linearRampToValueAtTime(p.gain * 0.3, when + p.attack);
    a.connect(lp); b.connect(bg); bg.connect(lp); lp.connect(amp); amp.connect(out);
    for (const o of [a, b, lfo]) o.start(when);
    return {
      end: Infinity,
      set(q, t) {
        if (q.freq) { a.frequency.setTargetAtTime(q.freq, t, 0.06); b.frequency.setTargetAtTime(q.freq * 0.5, t, 0.06); lg.gain.setTargetAtTime(q.freq * 0.012, t, 0.1); }
        if (q.cutoff) lp.frequency.setTargetAtTime(q.cutoff * 0.25, t, 0.06);
        if (q.bright != null) lfo.frequency.setTargetAtTime(4 + q.bright * 10, t, 0.1);
        if (q.gain != null) amp.gain.setTargetAtTime(q.gain * 0.3, t, 0.06);
      },
      release(t, r) { amp.gain.cancelScheduledValues(t); amp.gain.setTargetAtTime(0, t, r / 5); for (const o of [a, b, lfo]) o.stop(t + r + 0.2); },
      stop: (t) => { for (const o of [a, b, lfo]) { try { o.stop(t); } catch {} } },
    };
  },
};

export const OSCILLATOR_GENERATORS = [sine, triangle, square, saw, fm, pad, drone];
