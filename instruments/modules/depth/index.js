import { createEffectsChain } from "../../core/effects.js";
import { createMonoStepSequencer, noteToFreq } from "../../core/mono-step-sequencer.js";

export const manifest = {
  id: "depth",
  name: "Depth",
  shortName: "Depth",
  description: "Sub-bass built for pressure, not melody - a saturated sine/triangle stack with a pitch-drop impact on every hit.",
  category: "Bass",
  tags: ["bass", "sub", "saturation", "monophonic"],
  version: "1.0.0",
  icon: "\u{1F311}",
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

function makeSatCurve() {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = Math.tanh(x * 2.2);
  }
  return curve;
}

// Two persistent low oscillators (sub + a harmonic layer) through
// saturation for weight, plus a sharp downward pitch-drop transient on
// every non-glide hit for a felt "impact" rather than a pure sine thud.
function createDepthEngine(ctx, dest) {
  const sub = ctx.createOscillator();
  sub.type = "sine";
  sub.frequency.value = 55;
  const harm = ctx.createOscillator();
  harm.type = "triangle";
  harm.frequency.value = 55;
  const harmGain = ctx.createGain();
  harmGain.gain.value = 0.3;
  const mix = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  shaper.curve = makeSatCurve();
  shaper.oversample = "2x";
  const amp = ctx.createGain();
  amp.gain.value = 0;

  sub.connect(mix);
  harm.connect(harmGain);
  harmGain.connect(mix);
  mix.connect(shaper);
  shaper.connect(amp);
  sub.start();
  harm.start();

  function trigger(time, { note, octave, accent, glideIn }) {
    const freq = noteToFreq(note, octave, 28);
    const impactFreq = freq * 2.4;
    [sub, harm].forEach((o) => {
      o.frequency.cancelScheduledValues(time);
      if (glideIn) {
        o.frequency.setValueAtTime(o.frequency.value, time);
        o.frequency.linearRampToValueAtTime(freq, time + 0.1);
      } else {
        o.frequency.setValueAtTime(impactFreq, time);
        o.frequency.exponentialRampToValueAtTime(freq, time + 0.07);
      }
    });

    const life = accent ? 0.55 : 0.75;
    amp.gain.cancelScheduledValues(time);
    if (!glideIn) {
      amp.gain.setValueAtTime(0.0001, time);
      amp.gain.exponentialRampToValueAtTime(accent ? 1 : 0.72, time + 0.012);
    }
    amp.gain.exponentialRampToValueAtTime(0.0001, time + life);
  }

  function dispose() {
    try {
      sub.stop();
      harm.stop();
      sub.disconnect();
      harm.disconnect();
      harmGain.disconnect();
      mix.disconnect();
      shaper.disconnect();
      amp.disconnect();
    } catch (e) {}
  }

  amp.connect(dest);
  return { trigger, dispose };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createDepthEngine(ctx, output.input);
  const seq = createMonoStepSequencer({
    trigger: engine.trigger,
    defaultPattern: () => {
      const s = Array.from({ length: 16 }, () => ({ active: false, note: 0, octave: 0, accent: false, slide: false }));
      s[0] = { active: true, note: 0, octave: 0, accent: true, slide: false };
      s[6] = { active: true, note: 0, octave: 0, accent: false, slide: false };
      s[8] = { active: true, note: 5, octave: -1, accent: true, slide: false };
      s[12] = { active: true, note: 0, octave: 0, accent: false, slide: true };
      s[14] = { active: true, note: 3, octave: 0, accent: false, slide: false };
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
