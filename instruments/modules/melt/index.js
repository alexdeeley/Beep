import { createEffectsChain } from "../../core/effects.js";
import { createMonoStepSequencer, noteToFreq } from "../../core/mono-step-sequencer.js";

export const manifest = {
  id: "melt",
  name: "Melt",
  shortName: "Melt",
  description: "A liquid synth voice that sags in pitch and brightness as each note plays, like it's melting.",
  category: "Synths",
  tags: ["synth", "waveshaping", "liquid", "monophonic"],
  version: "1.0.0",
  icon: "\u{1FAE0}",
  supportsSequencer: true,
  supportsLivePlay: false,
  supportsEffects: true,
  supportsTempo: true,
  polyphony: 1,
  defaultWidth: 360,
  defaultHeight: 420,
  minimumWidth: 260,
  minimumHeight: 300,
};

function makeFoldedCurve() {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = Math.tanh(Math.sin(x * Math.PI * 0.9) * 1.6 + x * 0.4);
  }
  return curve;
}

// The "melting" is literal AudioParam automation: pitch sags flat and the
// filter closes over the note's life, both driven straight off the decay
// time, not a one-shot envelope hit - so the sound is visibly (audibly)
// still deforming right up until it dies.
function createMeltEngine(ctx, dest) {
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = 220;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 2000;
  filter.Q.value = 2;
  const shaper = ctx.createWaveShaper();
  shaper.curve = makeFoldedCurve();
  shaper.oversample = "2x";
  const amp = ctx.createGain();
  amp.gain.value = 0;
  osc.connect(filter);
  filter.connect(shaper);
  shaper.connect(amp);
  osc.start();

  function trigger(time, { note, octave, accent, glideIn }) {
    const freq = noteToFreq(note, octave, 52);
    const sagFreq = freq * 0.93;
    const life = accent ? 0.5 : 0.95;
    osc.frequency.cancelScheduledValues(time);
    if (glideIn) {
      osc.frequency.setValueAtTime(osc.frequency.value, time);
      osc.frequency.linearRampToValueAtTime(freq, time + 0.08);
    } else {
      osc.frequency.setValueAtTime(freq, time);
    }
    osc.frequency.linearRampToValueAtTime(sagFreq, time + life);

    const peakCut = accent ? 4200 : 2600;
    filter.frequency.cancelScheduledValues(time);
    filter.frequency.setValueAtTime(peakCut, time);
    filter.frequency.exponentialRampToValueAtTime(280, time + life);

    amp.gain.cancelScheduledValues(time);
    if (!glideIn) {
      amp.gain.setValueAtTime(0.0001, time);
      amp.gain.exponentialRampToValueAtTime(accent ? 0.8 : 0.55, time + 0.02);
    }
    amp.gain.exponentialRampToValueAtTime(0.0001, time + life * 1.1);
  }

  function dispose() {
    try {
      osc.stop();
      osc.disconnect();
      filter.disconnect();
      shaper.disconnect();
      amp.disconnect();
    } catch (e) {}
  }

  amp.connect(dest);
  return { trigger, dispose };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createMeltEngine(ctx, output.input);
  const seq = createMonoStepSequencer({
    trigger: engine.trigger,
    defaultPattern: () => {
      const s = Array.from({ length: 16 }, () => ({ active: false, note: 0, octave: 0, accent: false, slide: false }));
      s[0] = { active: true, note: 0, octave: 1, accent: true, slide: false };
      s[4] = { active: true, note: 7, octave: 0, accent: false, slide: true };
      s[8] = { active: true, note: 3, octave: 0, accent: false, slide: false };
      s[12] = { active: true, note: 10, octave: 0, accent: true, slide: false };
      return s;
    },
  });

  return {
    manifest,
    mount(el) { seq.mount(el, "im-mono-synth"); },
    unmount() { seq.unmount(); },
    start() { seq.start(); },
    stop() { seq.stop(); },
    getAudioOutput() { return output.output; },
    setEffectAmount(kind, amount) { if (output[kind]) output[kind].setAmount(amount); },
    serialize() { return seq.serialize(); },
    restore(state) { seq.restore(state); },
    dispose() {
      this.stop();
      this.unmount();
      engine.dispose();
      try { output.output.disconnect(); } catch (e) {}
    },
  };
}
