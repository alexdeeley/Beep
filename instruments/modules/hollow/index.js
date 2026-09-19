import { createEffectsChain } from "../../core/effects.js";
import { createMonoStepSequencer, noteToFreq } from "../../core/mono-step-sequencer.js";
import { makeNoiseBuffer } from "../../core/dsp-utils.js";

export const manifest = {
  id: "hollow",
  name: "Hollow",
  shortName: "Hollow",
  description: "A resonator instrument - short impulses excite a virtual cavity tuned to each note.",
  category: "Experimental",
  tags: ["resonator", "cavity", "physical-modeling", "monophonic"],
  version: "1.0.0",
  icon: "\u{1F573}\u{FE0F}",
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

// Same delay-line-as-resonator idea as Wire, but with much lower feedback
// (a box rings for a moment, a string sustains) and a bandpass excitation
// stage instead of a body-EQ stage - a cavity's resonance, not a wire's.
function createHollowEngine(ctx, dest) {
  const noiseBuffer = makeNoiseBuffer(ctx, 0.02);
  const excite = ctx.createBiquadFilter();
  excite.type = "bandpass";
  excite.frequency.value = 220;
  excite.Q.value = 14;
  const cavity = ctx.createDelay(0.05);
  cavity.delayTime.value = 1 / 220;
  const cavityFeedback = ctx.createGain();
  cavityFeedback.gain.value = 0.7;
  const output = ctx.createGain();
  output.gain.value = 0.9;

  excite.connect(cavity);
  cavity.connect(cavityFeedback);
  cavityFeedback.connect(cavity);
  cavity.connect(output);
  output.connect(dest);

  function trigger(time, { note, octave, accent, glideIn }) {
    const freq = noteToFreq(note, octave, 40);
    const period = Math.min(0.049, 1 / freq);
    excite.frequency.setTargetAtTime(freq, time, 0.006);
    cavity.delayTime.cancelScheduledValues(time);
    if (glideIn) {
      cavity.delayTime.setValueAtTime(cavity.delayTime.value, time);
      cavity.delayTime.linearRampToValueAtTime(period, time + 0.08);
    } else {
      cavity.delayTime.setValueAtTime(period, time);
    }
    cavityFeedback.gain.setTargetAtTime(accent ? 0.82 : 0.68, time, 0.02);

    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const g = ctx.createGain();
    g.gain.setValueAtTime(accent ? 1 : 0.6, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.015);
    src.connect(g);
    g.connect(excite);
    src.start(time);
    src.stop(time + 0.03);
  }

  function dispose() {
    try {
      excite.disconnect();
      cavity.disconnect();
      cavityFeedback.disconnect();
      output.disconnect();
    } catch (e) {}
  }

  return { trigger, dispose };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createHollowEngine(ctx, output.input);
  const seq = createMonoStepSequencer({
    trigger: engine.trigger,
    defaultPattern: () => {
      const s = Array.from({ length: 16 }, () => ({ active: false, note: 0, octave: 0, accent: false, slide: false }));
      [0, 5, 8, 13].forEach((i, k) => {
        s[i] = { active: true, note: [0, 5, 7, 3][k], octave: k % 2, accent: k === 0, slide: false };
      });
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
