import { createEffectsChain } from "../../core/effects.js";
import { createDrumSequencer } from "../../core/drum-grid-ui.js";
import { makeNoiseBuffer, makeDistortionCurve } from "../../core/dsp-utils.js";
import { buildParamRow } from "../../core/param-controls.js";

export const manifest = {
  id: "crater",
  name: "Crater",
  shortName: "Crater",
  description: "A drum kit with one Impact knob - turn it up and every hit collapses into clipped, pitch-crushed wreckage.",
  category: "Drums",
  tags: ["drums", "destruction", "distortion", "synthesized"],
  version: "1.0.0",
  icon: "\u{1F30B}",
  supportsSequencer: true,
  supportsLivePlay: true,
  supportsEffects: true,
  supportsTempo: true,
  polyphony: 4,
  defaultWidth: 380,
  defaultHeight: 460,
  minimumWidth: 260,
  minimumHeight: 320,
};

const VOICES = [
  { id: "kick", label: "KICK", freq: 60, decay: 0.35 },
  { id: "snap", label: "SNAP", freq: 220, decay: 0.15 },
  { id: "hat", label: "HAT", freq: 600, decay: 0.08 },
  { id: "tom", label: "TOM", freq: 140, decay: 0.25 },
];

function defaultPattern() {
  const p = Object.fromEntries(VOICES.map((v) => [v.id, new Array(16).fill(false)]));
  [0, 8].forEach((i) => (p.kick[i] = true));
  [4, 12].forEach((i) => (p.snap[i] = true));
  for (let i = 0; i < 16; i += 2) p.hat[i] = true;
  p.tom[14] = true;
  return p;
}

// Every voice is a clean sine hit routed through one shared distortion +
// noise + resonant-ghost bus whose intensity is a single Impact control -
// at 0 it's plain electronic percussion, pushed up it clips, detunes, and
// grows a ringing metallic ghost, while the amplitude envelope (so the
// rhythm) stays intact throughout.
function createCraterEngine(ctx, dest) {
  const shaper = ctx.createWaveShaper();
  shaper.oversample = "2x";
  const bus = ctx.createGain();
  bus.connect(shaper);
  shaper.connect(dest);
  const noiseBuffer = makeNoiseBuffer(ctx, 0.3);
  let impact = 0.3;

  function updateCurve() {
    shaper.curve = makeDistortionCurve(impact * 70);
  }
  updateCurve();

  function playVoice(v, time) {
    const t = time ?? ctx.currentTime;
    const collapse = 1 - impact * 0.55 * Math.random();
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(v.freq * collapse, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, v.freq * 0.4 * collapse), t + v.decay * 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + v.decay);
    osc.connect(g);
    g.connect(bus);
    osc.start(t);
    osc.stop(t + v.decay + 0.05);

    if (impact > 0.3) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(impact * 0.5, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + v.decay * 0.4);
      src.connect(ng);
      ng.connect(bus);
      src.start(t);
      src.stop(t + v.decay * 0.4 + 0.02);
    }
    if (impact > 0.6) {
      const ring = ctx.createBiquadFilter();
      ring.type = "bandpass";
      ring.frequency.value = v.freq * 4;
      ring.Q.value = 18 + impact * 30;
      const rg = ctx.createGain();
      rg.gain.setValueAtTime(impact * 0.3, t);
      rg.gain.exponentialRampToValueAtTime(0.0001, t + v.decay * 1.5);
      osc.connect(ring);
      ring.connect(rg);
      rg.connect(bus);
    }
  }

  return {
    hit(id, time) {
      const v = VOICES.find((x) => x.id === id);
      if (v) playVoice(v, time);
    },
    setImpact(value) {
      impact = value;
      updateCurve();
    },
    getImpact: () => impact,
    dispose() {
      try {
        bus.disconnect();
        shaper.disconnect();
      } catch (e) {}
    },
  };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createCraterEngine(ctx, output.input);
  let impactControl = null;
  const seq = createDrumSequencer({
    voices: VOICES,
    defaultPattern,
    trigger: (id, time) => engine.hit(id, time),
    now: () => ctx.currentTime,
    extraControls: (row) => {
      impactControl = buildParamRow(row, {
        label: "Impact",
        min: 0,
        max: 100,
        value: Math.round(engine.getImpact() * 100),
        format: (v) => v + "%",
        onInput: (v) => engine.setImpact(v / 100),
      });
    },
  });

  return {
    manifest,
    mount(el) { seq.mount(el, "im-drum-kit"); },
    unmount() { seq.unmount(); },
    start() { seq.start(); },
    stop() { seq.stop(); },
    getAudioOutput() { return output.output; },
    setEffectAmount(kind, amount) { if (output[kind]) output[kind].setAmount(amount); },
    serialize() {
      return { ...seq.serialize(), impact: engine.getImpact() };
    },
    restore(state) {
      if (!state) return;
      seq.restore(state);
      if (typeof state.impact === "number") {
        engine.setImpact(state.impact);
        impactControl?.setValue(Math.round(state.impact * 100));
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
