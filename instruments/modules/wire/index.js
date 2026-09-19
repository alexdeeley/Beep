import { createEffectsChain } from "../../core/effects.js";
import { createMonoStepSequencer, noteToFreq } from "../../core/mono-step-sequencer.js";
import { makeNoiseBuffer } from "../../core/dsp-utils.js";

export const manifest = {
  id: "wire",
  name: "Wire",
  shortName: "Wire",
  description: "A plucked string physical model - taut wire and cable rather than any one acoustic instrument.",
  category: "Keys",
  tags: ["pluck", "physical-modeling", "karplus-strong", "string", "monophonic"],
  version: "1.0.0",
  icon: "\u{1FAA2}",
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

// Karplus-Strong: a persistent delay line + damping filter + feedback loop
// tuned to the note's period, excited by a short noise burst per pluck.
// The loop is never torn down between notes (that's what lets a held
// resonance ring into the next pluck - "sympathetic vibration").
function createWireEngine(ctx, dest) {
  const noiseBuffer = makeNoiseBuffer(ctx, 0.05);
  const delay = ctx.createDelay(0.05);
  delay.delayTime.value = 1 / 110;
  const damping = ctx.createBiquadFilter();
  damping.type = "lowpass";
  damping.frequency.value = 3200;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.986;
  const body = ctx.createBiquadFilter();
  body.type = "peaking";
  body.frequency.value = 220;
  body.gain.value = 4;
  const output = ctx.createGain();
  output.gain.value = 0.9;

  delay.connect(damping);
  damping.connect(feedback);
  feedback.connect(delay);
  damping.connect(body);
  body.connect(output);
  output.connect(dest);

  function trigger(time, { note, octave, accent, glideIn }) {
    const freq = noteToFreq(note, octave, 52);
    const period = Math.min(0.049, 1 / freq);
    delay.delayTime.cancelScheduledValues(time);
    if (glideIn) {
      delay.delayTime.setValueAtTime(delay.delayTime.value, time);
      delay.delayTime.linearRampToValueAtTime(period, time + 0.09);
    } else {
      delay.delayTime.setValueAtTime(period, time);
    }
    body.frequency.setTargetAtTime(freq * 2, time, 0.02);

    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const burst = ctx.createGain();
    burst.gain.setValueAtTime(accent ? 1 : 0.55, time);
    burst.gain.exponentialRampToValueAtTime(0.0001, time + 0.02);
    src.connect(burst);
    burst.connect(delay);
    src.start(time);
    src.stop(time + 0.05);
  }

  function dispose() {
    try {
      delay.disconnect();
      damping.disconnect();
      feedback.disconnect();
      body.disconnect();
      output.disconnect();
    } catch (e) {}
  }

  return { trigger, dispose };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createWireEngine(ctx, output.input);
  const seq = createMonoStepSequencer({
    trigger: engine.trigger,
    defaultPattern: () => {
      const s = Array.from({ length: 16 }, () => ({ active: false, note: 0, octave: 0, accent: false, slide: false }));
      [0, 3, 6, 8, 11, 14].forEach((i, k) => {
        s[i] = { active: true, note: [0, 7, 3, 5, 10, 7][k], octave: 0, accent: k === 0, slide: false };
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
