import { createEffectsChain } from "../../core/effects.js";
import { createMonoStepSequencer, noteToFreq } from "../../core/mono-step-sequencer.js";
import { buildParamRow } from "../../core/param-controls.js";

export const manifest = {
  id: "magnet",
  name: "Magnet",
  shortName: "Magnet",
  description: "Active steps pull toward - or push away from - each other's pitch every loop, so the melody keeps negotiating with itself.",
  category: "Generative",
  tags: ["generative", "sequencer", "harmony", "evolving", "monophonic"],
  version: "1.0.0",
  icon: "\u{1F9F2}",
  supportsSequencer: true,
  supportsLivePlay: false,
  supportsEffects: true,
  supportsTempo: true,
  polyphony: 1,
  defaultWidth: 360,
  defaultHeight: 440,
  minimumWidth: 260,
  minimumHeight: 320,
};

function createMagnetEngine(ctx, dest) {
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = 220;
  const amp = ctx.createGain();
  amp.gain.value = 0;
  osc.connect(amp);
  osc.start();

  function trigger(time, { note, octave, accent, glideIn }) {
    const freq = noteToFreq(note, octave, 57);
    osc.frequency.cancelScheduledValues(time);
    if (glideIn) {
      osc.frequency.setValueAtTime(osc.frequency.value, time);
      osc.frequency.linearRampToValueAtTime(freq, time + 0.09);
    } else {
      osc.frequency.setValueAtTime(freq, time);
    }
    amp.gain.cancelScheduledValues(time);
    if (!glideIn) {
      amp.gain.setValueAtTime(0.0001, time);
      amp.gain.exponentialRampToValueAtTime(accent ? 0.75 : 0.48, time + 0.01);
    }
    amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.32);
  }

  function dispose() {
    try {
      osc.stop();
      osc.disconnect();
      amp.disconnect();
    } catch (e) {}
  }

  amp.connect(dest);
  return { trigger, dispose };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createMagnetEngine(ctx, output.input);
  let magnetism = 0.35; // -1 (repel) .. 1 (attract)
  let magnetismControl = null;

  function mutatePattern(pattern) {
    const activeIdxs = pattern.map((s, i) => (s.active ? i : -1)).filter((i) => i >= 0);
    if (activeIdxs.length < 2 || magnetism === 0) return;
    const notes = activeIdxs.map((i) => pattern[i].note);
    const avg = notes.reduce((a, b) => a + b, 0) / notes.length;
    activeIdxs.forEach((i) => {
      const s = pattern[i];
      const pull = (avg - s.note) * magnetism * 0.5;
      s.note = ((Math.round(s.note + pull) % 12) + 12) % 12;
    });
  }

  const seq = createMonoStepSequencer({
    trigger: engine.trigger,
    onBarComplete: mutatePattern,
    extraControls: (row) => {
      magnetismControl = buildParamRow(row, {
        label: "Magnetism",
        min: -100,
        max: 100,
        value: Math.round(magnetism * 100),
        format: (v) => (v > 0 ? "+" + v : String(v)),
        onInput: (v) => { magnetism = v / 100; },
      });
    },
    defaultPattern: () => {
      const s = Array.from({ length: 16 }, () => ({ active: false, note: 0, octave: 0, accent: false, slide: false }));
      s[0] = { active: true, note: 0, octave: 0, accent: true, slide: false };
      s[4] = { active: true, note: 9, octave: 0, accent: false, slide: false };
      s[8] = { active: true, note: 3, octave: 0, accent: false, slide: false };
      s[12] = { active: true, note: 7, octave: 0, accent: false, slide: false };
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
      return { ...seq.serialize(), magnetism };
    },
    restore(state) {
      if (!state) return;
      seq.restore(state);
      if (typeof state.magnetism === "number") {
        magnetism = state.magnetism;
        magnetismControl?.setValue(Math.round(magnetism * 100));
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
