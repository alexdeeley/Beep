import { createEffectsChain } from "../../core/effects.js";
import { createMonoStepSequencer, noteToFreq } from "../../core/mono-step-sequencer.js";
import { buildParamRow } from "../../core/param-controls.js";

export const manifest = {
  id: "deep-synth",
  name: "Deep Synth",
  shortName: "Deep",
  description: "A warm analog-style bass/lead: two detuned saws plus a sub oscillator through a resonant filter that sweeps open on every note.",
  category: "Synths",
  tags: ["synth", "bass", "lead", "filter", "analog", "monophonic"],
  version: "1.0.0",
  icon: "\u{1F30C}",
  supportsSequencer: true,
  supportsLivePlay: false,
  supportsEffects: true,
  supportsTempo: true,
  polyphony: 1,
  defaultWidth: 380,
  defaultHeight: 460,
  minimumWidth: 260,
  minimumHeight: 320,
};

// Two saws (one slightly detuned for width) plus a sub sine an octave
// down for weight, summed into one resonant lowpass filter. Cutoff and
// Resonance are live controls, not fixed like Elastic/Depth - every
// trigger still pushes the filter open and lets it fall, the classic
// analog synth "pluck", but the base tone color is the player's to shape.
function createDeepSynthEngine(ctx, dest) {
  const osc1 = ctx.createOscillator();
  osc1.type = "sawtooth";
  const osc2 = ctx.createOscillator();
  osc2.type = "sawtooth";
  osc2.detune.value = 9;
  const sub = ctx.createOscillator();
  sub.type = "sine";

  const oscGain = ctx.createGain();
  oscGain.gain.value = 0.45;
  const subGain = ctx.createGain();
  subGain.gain.value = 0.55;

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 500;
  filter.Q.value = 4;

  const amp = ctx.createGain();
  amp.gain.value = 0;

  osc1.connect(oscGain);
  osc2.connect(oscGain);
  sub.connect(subGain);
  oscGain.connect(filter);
  subGain.connect(filter);
  filter.connect(amp);
  osc1.start();
  osc2.start();
  sub.start();

  let params = { cutoff: 45, resonance: 40 };

  function applyResonance() {
    filter.Q.setTargetAtTime(0.5 + (params.resonance / 100) * 14, ctx.currentTime, 0.02);
  }
  applyResonance();

  function trigger(time, { note, octave, accent, glideIn }) {
    const freq = noteToFreq(note, octave, 40);
    [osc1, osc2].forEach((o) => {
      o.frequency.cancelScheduledValues(time);
      if (glideIn) {
        o.frequency.setValueAtTime(o.frequency.value, time);
        o.frequency.linearRampToValueAtTime(freq, time + 0.09);
      } else {
        o.frequency.setValueAtTime(freq, time);
      }
    });
    sub.frequency.cancelScheduledValues(time);
    if (glideIn) {
      sub.frequency.setValueAtTime(sub.frequency.value, time);
      sub.frequency.linearRampToValueAtTime(freq / 2, time + 0.09);
    } else {
      sub.frequency.setValueAtTime(freq / 2, time);
    }

    const baseCut = 100 + (params.cutoff / 100) * 3200;
    const peakCut = Math.min(9000, baseCut + (accent ? 3200 : 1800));
    filter.frequency.cancelScheduledValues(time);
    filter.frequency.setValueAtTime(baseCut, time);
    filter.frequency.linearRampToValueAtTime(peakCut, time + 0.015);
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, baseCut * 0.8), time + 0.5);

    const decay = accent ? 0.5 : 0.4;
    amp.gain.cancelScheduledValues(time);
    if (!glideIn) {
      amp.gain.setValueAtTime(0.0001, time);
      amp.gain.exponentialRampToValueAtTime(accent ? 0.85 : 0.6, time + 0.01);
    }
    amp.gain.exponentialRampToValueAtTime(0.0001, time + decay);
  }

  function dispose() {
    try {
      osc1.stop();
      osc2.stop();
      sub.stop();
      osc1.disconnect();
      osc2.disconnect();
      sub.disconnect();
      oscGain.disconnect();
      subGain.disconnect();
      filter.disconnect();
      amp.disconnect();
    } catch (e) {}
  }

  amp.connect(dest);

  return {
    trigger,
    dispose,
    setCutoff(v) { params.cutoff = v; },
    setResonance(v) { params.resonance = v; applyResonance(); },
    getCutoff: () => params.cutoff,
    getResonance: () => params.resonance,
  };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createDeepSynthEngine(ctx, output.input);
  let cutoffControl = null;
  let resonanceControl = null;

  const seq = createMonoStepSequencer({
    trigger: engine.trigger,
    extraControls: (row) => {
      cutoffControl = buildParamRow(row, {
        label: "Cutoff",
        min: 0,
        max: 100,
        value: Math.round(engine.getCutoff()),
        format: (v) => v + "%",
        onInput: (v) => engine.setCutoff(v),
      });
      resonanceControl = buildParamRow(row, {
        label: "Resonance",
        min: 0,
        max: 100,
        value: Math.round(engine.getResonance()),
        format: (v) => v + "%",
        onInput: (v) => engine.setResonance(v),
      });
    },
    defaultPattern: () => {
      const s = Array.from({ length: 16 }, () => ({ active: false, note: 0, octave: 0, accent: false, slide: false }));
      s[0] = { active: true, note: 0, octave: -1, accent: true, slide: false };
      s[3] = { active: true, note: 3, octave: -1, accent: false, slide: false };
      s[6] = { active: true, note: 7, octave: -1, accent: false, slide: true };
      s[8] = { active: true, note: 5, octave: -1, accent: true, slide: false };
      s[11] = { active: true, note: 0, octave: -1, accent: false, slide: false };
      s[14] = { active: true, note: 10, octave: -1, accent: false, slide: true };
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
    serialize() {
      return { ...seq.serialize(), cutoff: engine.getCutoff(), resonance: engine.getResonance() };
    },
    restore(state) {
      if (!state) return;
      seq.restore(state);
      if (typeof state.cutoff === "number") {
        engine.setCutoff(state.cutoff);
        cutoffControl?.setValue(Math.round(state.cutoff));
      }
      if (typeof state.resonance === "number") {
        engine.setResonance(state.resonance);
        resonanceControl?.setValue(Math.round(state.resonance));
      }
    },
    dispose() {
      this.stop();
      this.unmount();
      engine.dispose();
      try { output.output.disconnect(); } catch (e) {}
    },
  };
}
