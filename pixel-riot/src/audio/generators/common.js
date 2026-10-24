// Shared building blocks for sound generators.
//
// Sound generator contract (API 1.x):
//   {
//     id, name, description?,
//     sustain?: bool,                                  // true = held until released
//     params: { name: { min, max, default } },         // every param is clamped to its range
//     create(ac, out, when, p, shared) -> {
//        end: number,                                  // audio time the voice is silent (Infinity if sustained)
//        stop(t),                                      // hard stop at audio time t
//        set?(p, t),                                   // live parameter change (sustained voices)
//        release?(t, releaseSeconds),                  // graceful release (sustained voices)
//        dispose?(),                                   // called after `end` to break feedback loops
//     }
//   }
//   ac     AudioContext (or OfflineAudioContext) — use only standard nodes
//   out    destination node for this voice (the voice manager's gain -> panner -> bus)
//   shared { noise: AudioBuffer (2s white noise) }
// Generators must not touch the DOM, global state, or create unbounded nodes.

export const BASE_PARAMS = {
  freq: { min: 20, max: 9000, default: 220 },
  gain: { min: 0, max: 1, default: 0.5 },
  attack: { min: 0.001, max: 3, default: 0.004 },
  decay: { min: 0.01, max: 8, default: 0.35 },
  cutoff: { min: 60, max: 18000, default: 6000 },
  glide: { min: 0.125, max: 8, default: 1 },     // pitch multiplier reached over the decay
  bright: { min: 0, max: 1, default: 0.5 },
};

export function params(extra = {}) { return { ...BASE_PARAMS, ...extra }; }

// Percussive envelope on an AudioParam. Returns end time.
export function envAD(param, when, attack, decay, peak) {
  param.cancelScheduledValues(when);
  param.setValueAtTime(0, when);
  param.linearRampToValueAtTime(peak, when + attack);
  param.setTargetAtTime(0, when + attack, Math.max(0.003, decay / 4.5));
  return when + attack + decay + 0.05;
}

export function makeNoiseBuffer(ac, seconds = 2) {
  const n = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  let s = 12345;
  for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = (s / 4294967296) * 2 - 1; }
  return buf;
}

export function noiseSource(ac, shared, when) {
  const src = ac.createBufferSource();
  src.buffer = shared.noise; src.loop = true;
  src.start(when, Math.random() * 1.5);
  return src;
}

// Generic "oscillator voice": osc -> lowpass -> amp. Used by the 4 basic waveforms.
export function oscVoice(type) {
  return {
    params: params(),
    create(ac, out, when, p) {
      const osc = ac.createOscillator(); osc.type = type;
      osc.frequency.setValueAtTime(p.freq, when);
      if (p.glide !== 1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, p.freq * p.glide), when + p.attack + p.decay);
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(p.cutoff, when); lp.Q.value = 0.7 + p.bright * 4;
      const amp = ac.createGain();
      const peak = p.gain * (type === 'square' || type === 'sawtooth' ? 0.35 : 0.6);
      const end = envAD(amp.gain, when, p.attack, p.decay, peak);
      osc.connect(lp); lp.connect(amp); amp.connect(out);
      osc.start(when); osc.stop(end);
      return { end, stop: (t) => { try { osc.stop(t); } catch {} } };
    },
  };
}
