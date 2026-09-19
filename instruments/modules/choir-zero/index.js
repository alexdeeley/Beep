import { createEffectsChain } from "../../core/effects.js";
import { createMonoStepSequencer, noteToFreq } from "../../core/mono-step-sequencer.js";

export const manifest = {
  id: "choir-zero",
  name: "Choir Zero",
  shortName: "Choir",
  description: "An entirely synthetic vocal instrument - formant filters turn a raw oscillator into ghostly vowels.",
  category: "Keys",
  tags: ["vocal", "formant", "choir", "synthesized", "monophonic"],
  version: "1.0.0",
  icon: "\u{1F47B}",
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

// Five vowels as three-formant filter banks. Pitch and vowel are coupled
// through the same step data (note selects both) - no samples anywhere,
// the "vocal" quality comes entirely from three resonant bandpass filters
// reshaping one harmonically-rich oscillator.
const VOWELS = [
  [800, 1150, 2900], // ah
  [400, 1700, 2600], // ee
  [350, 2000, 2800], // ih
  [450, 800, 2830], // oh
  [325, 700, 2530], // oo
];

function createChoirEngine(ctx, dest) {
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = 220;
  const amp = ctx.createGain();
  amp.gain.value = 0;
  const formants = VOWELS[0].map((f) => {
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = f;
    bp.Q.value = 12;
    const g = ctx.createGain();
    g.gain.value = 0.45;
    osc.connect(bp);
    bp.connect(g);
    g.connect(amp);
    return bp;
  });
  osc.start();

  function trigger(time, { note, octave, accent, glideIn }) {
    const freq = noteToFreq(note, octave, 57);
    osc.frequency.cancelScheduledValues(time);
    if (glideIn) {
      osc.frequency.setValueAtTime(osc.frequency.value, time);
      osc.frequency.linearRampToValueAtTime(freq, time + 0.14);
    } else {
      osc.frequency.setValueAtTime(freq, time);
    }
    const vowel = VOWELS[note % VOWELS.length];
    formants.forEach((bp, i) => bp.frequency.setTargetAtTime(vowel[i], time, 0.05));

    const life = accent ? 0.5 : 0.4;
    amp.gain.cancelScheduledValues(time);
    if (!glideIn) {
      amp.gain.setValueAtTime(0.0001, time);
      amp.gain.exponentialRampToValueAtTime(accent ? 0.55 : 0.35, time + 0.06);
    }
    amp.gain.exponentialRampToValueAtTime(0.0001, time + life);
  }

  function dispose() {
    try {
      osc.stop();
      osc.disconnect();
      formants.forEach((f) => f.disconnect());
      amp.disconnect();
    } catch (e) {}
  }

  amp.connect(dest);
  return { trigger, dispose };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createChoirEngine(ctx, output.input);
  const seq = createMonoStepSequencer({
    trigger: engine.trigger,
    defaultPattern: () => {
      const s = Array.from({ length: 16 }, () => ({ active: false, note: 0, octave: 0, accent: false, slide: false }));
      s[0] = { active: true, note: 0, octave: 0, accent: true, slide: false };
      s[4] = { active: true, note: 4, octave: 0, accent: false, slide: false };
      s[8] = { active: true, note: 7, octave: 0, accent: false, slide: false };
      s[12] = { active: true, note: 2, octave: 0, accent: false, slide: false };
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
