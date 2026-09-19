import { createEffectsChain } from "../../core/effects.js";
import { createMonoStepSequencer, noteToFreq } from "../../core/mono-step-sequencer.js";

export const manifest = {
  id: "elastic",
  name: "Elastic",
  shortName: "Elastic",
  description: "A rubbery monophonic synth: every note overshoots its pitch and bounces back into place.",
  category: "Bass",
  tags: ["bass", "synth", "glide", "bounce", "monophonic"],
  version: "1.0.0",
  icon: "\u{1FA80}",
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

// A persistent saw + resonant lowpass, but every trigger overshoots its
// target pitch and cutoff before settling - that overshoot-then-settle
// motion (rather than a straight ramp) is what reads as "rubbery" instead
// of merely "gliding".
function createElasticEngine(ctx, dest) {
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = 110;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 800;
  filter.Q.value = 5;
  const amp = ctx.createGain();
  amp.gain.value = 0;
  osc.connect(filter);
  filter.connect(amp);
  osc.start();

  function trigger(time, { note, octave, accent, glideIn }) {
    const freq = noteToFreq(note, octave, 48);
    const overshoot = freq * (accent ? 1.6 : 1.32);
    osc.frequency.cancelScheduledValues(time);
    if (glideIn) {
      osc.frequency.setValueAtTime(osc.frequency.value, time);
      osc.frequency.linearRampToValueAtTime(overshoot, time + 0.1);
      osc.frequency.linearRampToValueAtTime(freq, time + 0.22);
    } else {
      osc.frequency.setValueAtTime(freq * 0.65, time);
      osc.frequency.linearRampToValueAtTime(overshoot, time + 0.045);
      osc.frequency.linearRampToValueAtTime(freq, time + 0.16);
    }

    const decay = 0.42;
    const peakCut = 2200 + (accent ? 1400 : 0);
    filter.frequency.cancelScheduledValues(time);
    filter.frequency.setValueAtTime(400, time);
    filter.frequency.linearRampToValueAtTime(peakCut, time + 0.035);
    filter.frequency.exponentialRampToValueAtTime(500, time + decay);

    amp.gain.cancelScheduledValues(time);
    if (!glideIn) {
      amp.gain.setValueAtTime(0.0001, time);
      amp.gain.exponentialRampToValueAtTime(accent ? 0.9 : 0.62, time + 0.01);
    }
    amp.gain.exponentialRampToValueAtTime(0.0001, time + decay * 1.25);
  }

  function dispose() {
    try {
      osc.stop();
      osc.disconnect();
      filter.disconnect();
      amp.disconnect();
    } catch (e) {}
  }

  amp.connect(dest);
  return { trigger, dispose };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createElasticEngine(ctx, output.input);
  const seq = createMonoStepSequencer({
    trigger: engine.trigger,
    defaultPattern: () => {
      const s = Array.from({ length: 16 }, () => ({ active: false, note: 0, octave: 0, accent: false, slide: false }));
      s[0] = { active: true, note: 0, octave: 0, accent: true, slide: true };
      s[3] = { active: true, note: 7, octave: 0, accent: false, slide: false };
      s[6] = { active: true, note: 3, octave: 0, accent: false, slide: true };
      s[8] = { active: true, note: 0, octave: 1, accent: true, slide: false };
      s[11] = { active: true, note: 10, octave: 0, accent: false, slide: false };
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
