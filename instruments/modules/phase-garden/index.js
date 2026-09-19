import { createEffectsChain } from "../../core/effects.js";
import { createPolyrhythmLoops } from "../../core/polyrhythm-loops.js";

export const manifest = {
  id: "phase-garden",
  name: "Phase Garden",
  shortName: "Garden",
  description: "Three melodic loops of 5, 7, and 11 steps recombine endlessly before they ever fully repeat.",
  category: "Generative",
  tags: ["generative", "polyrhythm", "melodic", "evolving", "synthesized"],
  version: "1.0.0",
  icon: "\u{1F33F}",
  supportsSequencer: true,
  supportsLivePlay: false,
  supportsEffects: true,
  supportsTempo: true,
  polyphony: 3,
  defaultWidth: 380,
  defaultHeight: 380,
  minimumWidth: 260,
  minimumHeight: 280,
};

const SCALE = [0, 2, 3, 5, 7, 9, 10]; // natural-minor-ish, keeps every layer harmonically related

const LAYERS = [
  { id: "a", label: "Loop A", length: 5, type: "sine", baseMidi: 48 },
  { id: "b", label: "Loop B", length: 7, type: "triangle", baseMidi: 60 },
  { id: "c", label: "Loop C", length: 11, type: "sine", baseMidi: 74 },
];

function defaultPatterns() {
  const p = {};
  for (const l of LAYERS) {
    p[l.id] = new Array(l.length).fill(0).map((_, i) => (i % 2 === 0 ? 0.9 : 0));
  }
  p.a[0] = 1;
  p.c[3] = 0.6;
  return p;
}

// Each layer is its own tiny persistent voice at a distinct register -
// the "recombination" effect is entirely structural (5 vs 7 vs 11 step
// cycles drifting against each other), not randomized synthesis, so the
// same seed always sounds intentional rather than noisy.
function createGardenEngine(ctx, dest) {
  const layerVoices = Object.fromEntries(
    LAYERS.map((l) => {
      const gain = ctx.createGain();
      gain.gain.value = 1;
      gain.connect(dest);
      return [l.id, { type: l.type, baseMidi: l.baseMidi, bus: gain }];
    })
  );

  function trigger(layerId, idx, time) {
    const t = time ?? ctx.currentTime;
    const v = layerVoices[layerId];
    const note = SCALE[idx % SCALE.length];
    const freq = 440 * Math.pow(2, (v.baseMidi + note - 69) / 12);
    const osc = ctx.createOscillator();
    osc.type = v.type;
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    osc.connect(g);
    g.connect(v.bus);
    osc.start(t);
    osc.stop(t + 1);
  }

  function dispose() {
    Object.values(layerVoices).forEach((v) => {
      try { v.bus.disconnect(); } catch (e) {}
    });
  }

  return { trigger, dispose };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createGardenEngine(ctx, output.input);
  const loops = createPolyrhythmLoops({
    layers: LAYERS,
    defaultPatterns,
    trigger: (id, idx, time) => engine.trigger(id, idx, time),
  });

  return {
    manifest,
    mount(el) { loops.mount(el, "im-polyrhythm"); },
    unmount() { loops.unmount(); },
    start() { loops.start(); },
    stop() { loops.stop(); },
    getAudioOutput() { return output.output; },
    setEffectAmount(kind, amount) { if (output[kind]) output[kind].setAmount(amount); },
    serialize() { return loops.serialize(); },
    restore(state) { loops.restore(state); },
    dispose() {
      this.stop();
      this.unmount();
      engine.dispose();
      try { output.output.disconnect(); } catch (e) {}
    },
  };
}
