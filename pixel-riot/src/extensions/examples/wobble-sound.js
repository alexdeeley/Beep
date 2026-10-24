// EXAMPLE EXTENSION — sound generator + named sound + audio mapping.
// 'ex.wobble' is an LFO-filtered saw bass; 'ex.wobble' sound uses it; the 'ex.y-wobble'
// mapping turns vertical position into LFO rate. Try it from the WOBBLE profile below or
// reference the sound from your own profile: { sound: 'ex.wobble', map: 'ex.y-wobble' }.

export default {
  manifest: {
    id: 'ex.wobble', name: 'Wobble Bass (example)', version: '1.0.0', type: 'sound', apiVersion: '1.0.0',
    description: 'Adds a wobble-bass generator, a sound that uses it, and a y -> LFO mapping.',
    dependencies: ['core.audio'], capabilities: ['audio'],
  },
  register(api) {
    // ============================================================
    // EXTENSION ZONE: SOUND GENERATORS (example)
    // PURPOSE: Register synthesis primitives.
    // CONTRACT: src/audio/generators/common.js — params with min/default/max; create()
    //           returns { end, stop } and must envelope its own output (no clicks).
    // SAFETY: Bounded node count per voice; no DOM; params arrive pre-clamped.
    // INTEGRATION: api.audio.generators.register(def), then a sound recipe.
    // ============================================================
    api.audio.generators.register({
      id: 'ex.wobble', name: 'WOBBLE',
      params: { freq: { min: 30, max: 400, default: 55 }, gain: { min: 0, max: 1, default: 0.5 }, attack: { min: 0.001, max: 0.5, default: 0.01 }, decay: { min: 0.05, max: 3, default: 0.6 }, rate: { min: 0.5, max: 16, default: 4 }, cutoff: { min: 100, max: 8000, default: 1800 }, bright: { min: 0, max: 1, default: 0.5 }, glide: { min: 0.25, max: 4, default: 1 } },
      create(ac, out, when, p) {
        const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = p.freq;
        const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 9; lp.frequency.value = p.cutoff * 0.3;
        const lfo = ac.createOscillator(); lfo.frequency.value = p.rate; const lg = ac.createGain(); lg.gain.value = p.cutoff * 0.28;
        lfo.connect(lg); lg.connect(lp.frequency);
        const amp = ac.createGain(); amp.gain.setValueAtTime(0, when); amp.gain.linearRampToValueAtTime(p.gain * 0.4, when + p.attack); amp.gain.setTargetAtTime(0, when + p.attack, p.decay / 4);
        o.connect(lp); lp.connect(amp); amp.connect(out);
        const end = when + p.attack + p.decay + 0.1;
        o.start(when); lfo.start(when); o.stop(end); lfo.stop(end);
        return { end, stop: (t) => { try { o.stop(t); lfo.stop(t); } catch {} } };
      },
    });
    api.audio.sounds.register({ id: 'ex.wobble', name: 'WOBBLE BASS', family: 'tonal', layers: [{ gen: 'ex.wobble', octave: -2 }] });
    // ============================================================
    // EXTENSION ZONE: AUDIO MAPPINGS (example)
    // PURPOSE: Turn gesture/cell data into musical parameters.
    // CONTRACT: src/audio/audio-mapping.js — map(ev, ctx) -> { degree|midi, gain, pan, cutoff, ... }
    // SAFETY: Return plain numbers; the engine clamps everything to generator ranges.
    // INTEGRATION: api.audio.mappings.register(def)
    // ============================================================
    api.audio.mappings.register({
      id: 'ex.y-wobble', name: 'Y → WOBBLE RATE',
      map(ev, ctx) { return { degree: ctx.normToDegree(ev.x, 1.5), gain: 0.6, pan: ev.x * 1.4 - 0.7, rate: 1 + (1 - ev.y) * 12, cutoff: 900 + (1 - ev.y) * 4000 }; },
    });
  },
};
