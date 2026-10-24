// Tonal generators: pluck, bell, metallic ping, sweeps, granular.
import { params, envAD, noiseSource } from './common.js';

// Karplus-Strong-flavoured pluck: noise burst into a short feedback delay.
export const pluck = {
  id: 'pluck', name: 'PLUCK',
  params: params({ decay: { min: 0.05, max: 4, default: 0.9 }, damp: { min: 0.1, max: 0.99, default: 0.92 } }),
  create(ac, out, when, p, shared) {
    const n = noiseSource(ac, shared, when);
    const exc = ac.createGain(); exc.gain.setValueAtTime(0, when); exc.gain.linearRampToValueAtTime(p.gain * 0.9, when + 0.001); exc.gain.setTargetAtTime(0, when + 0.002, 0.004);
    const d = ac.createDelay(0.1); d.delayTime.value = Math.min(0.099, 1 / Math.max(20, p.freq));
    const fb = ac.createGain(); fb.gain.value = Math.min(0.985, p.damp * (1 - 0.03 / Math.max(0.05, p.decay)));
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(16000, p.freq * (4 + p.bright * 10));
    const amp = ac.createGain(); const end = envAD(amp.gain, when, 0.001, p.decay, 0.8);
    n.connect(exc); exc.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(amp); amp.connect(out);
    n.stop(when + 0.03);
    // Break the feedback loop after the note so the graph can be collected.
    fb.gain.setValueAtTime(0, end);
    return {
      end,
      stop: (t) => { try { n.stop(t); } catch {} fb.gain.cancelScheduledValues(t); fb.gain.setValueAtTime(0, t); },
      dispose: () => { try { d.disconnect(); fb.disconnect(); lp.disconnect(); } catch {} },
    };
  },
};

// Inharmonic partial bell.
export const bell = {
  id: 'bell', name: 'BELL',
  params: params({ decay: { min: 0.1, max: 8, default: 2.2 } }),
  create(ac, out, when, p) {
    const ratios = [1, 2.76, 5.4, 8.93, 13.34];
    const amp = ac.createGain(); amp.gain.value = p.gain * 0.22; amp.connect(out);
    let end = when;
    const oscs = ratios.map((r, k) => {
      const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = Math.min(16000, p.freq * r);
      const g = ac.createGain(); end = Math.max(end, envAD(g.gain, when, 0.002, p.decay / (1 + k * 0.7), 1 / (1 + k * 0.8)));
      o.connect(g); g.connect(amp); o.start(when); return o;
    });
    oscs.forEach((o) => o.stop(end));
    return { end, stop: (t) => oscs.forEach((o) => { try { o.stop(t); } catch {} }) };
  },
};

// Metallic ping: ring-modulated squares through a high-Q bandpass.
export const metal = {
  id: 'metal', name: 'METAL PING',
  params: params({ freq: { min: 200, max: 6000, default: 1300 }, decay: { min: 0.03, max: 3, default: 0.6 } }),
  create(ac, out, when, p) {
    const a = ac.createOscillator(); a.type = 'square'; a.frequency.value = p.freq;
    const b = ac.createOscillator(); b.type = 'square'; b.frequency.value = p.freq * 1.4142;
    const rm = ac.createGain(); rm.gain.value = 0; b.connect(rm.gain); a.connect(rm);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = p.freq * 2.1; bp.Q.value = 14;
    const amp = ac.createGain(); const end = envAD(amp.gain, when, 0.001, p.decay, p.gain * 0.9);
    rm.connect(bp); bp.connect(amp); amp.connect(out);
    a.start(when); b.start(when); a.stop(end); b.stop(end);
    return { end, stop: (t) => { try { a.stop(t); b.stop(t); } catch {} } };
  },
};

function sweep(id, name, dir) {
  return {
    id, name,
    params: params({ decay: { min: 0.05, max: 3, default: 0.35 }, range: { min: 1.2, max: 16, default: 4 } }),
    create(ac, out, when, p) {
      const o = ac.createOscillator(); o.type = 'sawtooth';
      const f0 = dir > 0 ? p.freq : Math.min(9000, p.freq * p.range), f1 = dir > 0 ? Math.min(9000, p.freq * p.range) : p.freq;
      o.frequency.setValueAtTime(f0, when); o.frequency.exponentialRampToValueAtTime(f1, when + p.decay);
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 8;
      lp.frequency.setValueAtTime(f0 * 2, when); lp.frequency.exponentialRampToValueAtTime(Math.min(16000, f1 * 2), when + p.decay);
      const amp = ac.createGain(); amp.gain.setValueAtTime(0, when); amp.gain.linearRampToValueAtTime(p.gain * 0.22, when + p.decay * 0.2); amp.gain.linearRampToValueAtTime(0, when + p.decay);
      o.connect(lp); lp.connect(amp); amp.connect(out); o.start(when); o.stop(when + p.decay + 0.05);
      return { end: when + p.decay + 0.05, stop: (t) => { try { o.stop(t); } catch {} } };
    },
  };
}
export const sweepUp = sweep('sweep-up', 'RISING SWEEP', 1);
export const sweepDown = sweep('sweep-down', 'FALLING SWEEP', -1);

// Granular cloud: many short windowed grains of sine/noise scattered around a pitch.
// Grain count is bounded (<= 24 per voice).
export const grain = {
  id: 'grain', name: 'GRAIN CLOUD',
  params: params({ decay: { min: 0.1, max: 3, default: 0.7 }, density: { min: 2, max: 24, default: 12 }, scatter: { min: 0, max: 1, default: 0.3 } }),
  create(ac, out, when, p, shared) {
    const n = Math.round(p.density); const amp = ac.createGain(); amp.gain.value = p.gain * 0.5; amp.connect(out);
    const nodes = [];
    for (let k = 0; k < n; k++) {
      const t = when + (k / n) * p.decay;
      const g = ac.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime((1 - k / n) * 0.6, t + 0.01); g.gain.linearRampToValueAtTime(0, t + 0.045);
      let src;
      if (k % 3 === 2) { src = noiseSource(ac, shared, t); const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = p.freq * 4; bp.Q.value = 10; src.connect(bp); bp.connect(g); }
      else { src = ac.createOscillator(); src.frequency.value = p.freq * Math.pow(2, (Math.random() - 0.5) * p.scatter * 2); src.connect(g); src.start(t); }
      src.stop(t + 0.06); g.connect(amp); nodes.push(src);
    }
    const end = when + p.decay + 0.1;
    return { end, stop: (t) => nodes.forEach((s) => { try { s.stop(t); } catch {} }) };
  },
};

export const TONAL_GENERATORS = [pluck, bell, metal, sweepUp, sweepDown, grain];
