// Percussive / noise generators.
import { params, envAD, noiseSource } from './common.js';

export const kick = {
  id: 'kick', name: 'KICK THUMP',
  params: params({ freq: { min: 30, max: 160, default: 55 }, decay: { min: 0.05, max: 1.5, default: 0.4 }, punch: { min: 1, max: 8, default: 4 } }),
  create(ac, out, when, p) {
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(p.freq * p.punch, when);
    o.frequency.exponentialRampToValueAtTime(p.freq, when + 0.06);
    const amp = ac.createGain();
    const end = envAD(amp.gain, when, 0.002, p.decay, p.gain * 0.95);
    const sh = ac.createWaveShaper(); const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.2); } sh.curve = curve;
    o.connect(sh); sh.connect(amp); amp.connect(out); o.start(when); o.stop(end);
    return { end, stop: (t) => { try { o.stop(t); } catch {} } };
  },
};

export const snare = {
  id: 'snare', name: 'SNARE',
  params: params({ freq: { min: 120, max: 400, default: 190 }, decay: { min: 0.05, max: 0.8, default: 0.18 } }),
  create(ac, out, when, p, shared) {
    const n = noiseSource(ac, shared, when);
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200;
    const na = ac.createGain(); const end = envAD(na.gain, when, 0.001, p.decay, p.gain * 0.6);
    const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(p.freq * 1.5, when); o.frequency.exponentialRampToValueAtTime(p.freq, when + 0.04);
    const oa = ac.createGain(); envAD(oa.gain, when, 0.001, p.decay * 0.5, p.gain * 0.5);
    n.connect(hp); hp.connect(na); na.connect(out); o.connect(oa); oa.connect(out);
    o.start(when); o.stop(end); n.stop(end);
    return { end, stop: (t) => { try { n.stop(t); o.stop(t); } catch {} } };
  },
};

function hat(id, name, decayDefault) {
  return {
    id, name,
    params: params({ decay: { min: 0.01, max: 1.2, default: decayDefault }, cutoff: { min: 3000, max: 16000, default: 8000 } }),
    create(ac, out, when, p, shared) {
      const n = noiseSource(ac, shared, when);
      const bp = ac.createBiquadFilter(); bp.type = 'highpass'; bp.frequency.value = p.cutoff;
      const pk = ac.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 10000; pk.gain.value = 6;
      const a = ac.createGain(); const end = envAD(a.gain, when, 0.001, p.decay, p.gain * 0.4);
      n.connect(bp); bp.connect(pk); pk.connect(a); a.connect(out); n.stop(end);
      return { end, stop: (t) => { try { n.stop(t); } catch {} } };
    },
  };
}
export const hatClosed = hat('hat-closed', 'CLOSED HAT', 0.05);
export const hatOpen = hat('hat-open', 'OPEN HAT', 0.4);

export const click = {
  id: 'click', name: 'CLICK',
  params: params({ freq: { min: 400, max: 9000, default: 2400 }, decay: { min: 0.003, max: 0.1, default: 0.02 } }),
  create(ac, out, when, p) {
    const o = ac.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(p.freq, when); o.frequency.exponentialRampToValueAtTime(p.freq * 0.5, when + p.decay);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = p.freq; bp.Q.value = 2;
    const a = ac.createGain(); const end = envAD(a.gain, when, 0.0008, p.decay, p.gain * 0.5);
    o.connect(bp); bp.connect(a); a.connect(out); o.start(when); o.stop(end);
    return { end, stop: (t) => { try { o.stop(t); } catch {} } };
  },
};

export const noiseBurst = {
  id: 'noise-burst', name: 'NOISE BURST',
  params: params({ decay: { min: 0.01, max: 1, default: 0.06 } }),
  create(ac, out, when, p, shared) {
    const n = noiseSource(ac, shared, when);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = p.cutoff;
    const a = ac.createGain(); const end = envAD(a.gain, when, 0.001, p.decay, p.gain * 0.45);
    n.connect(lp); lp.connect(a); a.connect(out); n.stop(end);
    return { end, stop: (t) => { try { n.stop(t); } catch {} } };
  },
};

// Band-passed noise with a resonant sweep (glide moves the band).
export const filteredNoise = {
  id: 'filtered-noise', name: 'FILTERED NOISE',
  params: params({ q: { min: 0.5, max: 30, default: 8 }, decay: { min: 0.03, max: 3, default: 0.4 } }),
  create(ac, out, when, p, shared) {
    const n = noiseSource(ac, shared, when);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = p.q;
    bp.frequency.setValueAtTime(Math.min(16000, p.freq * 4), when);
    bp.frequency.exponentialRampToValueAtTime(Math.min(16000, Math.max(60, p.freq * 4 * p.glide)), when + p.attack + p.decay);
    const a = ac.createGain(); const end = envAD(a.gain, when, p.attack, p.decay, p.gain * Math.min(1.6, 0.4 + p.q * 0.06));
    n.connect(bp); bp.connect(a); a.connect(out); n.stop(end);
    return { end, stop: (t) => { try { n.stop(t); } catch {} } };
  },
};

export const PERCUSSION_GENERATORS = [kick, snare, hatClosed, hatOpen, click, noiseBurst, filteredNoise];
