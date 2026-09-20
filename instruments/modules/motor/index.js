import { createEffectsChain } from "../../core/effects.js";
import { createPolyrhythmLoops } from "../../core/polyrhythm-loops.js";
import { makeNoiseBuffer } from "../../core/dsp-utils.js";
import { buildParamRow } from "../../core/param-controls.js";

export const manifest = {
  id: "motor",
  name: "Motor",
  shortName: "Motor",
  description: "Mechanical repetition - four pulse layers of different lengths (pistons, gears, relays, turbine) locking and drifting apart.",
  category: "Drums",
  tags: ["rhythm", "mechanical", "polyrhythm", "generative", "synthesized"],
  version: "1.0.0",
  icon: "\u{2699}\u{FE0F}",
  supportsSequencer: true,
  supportsLivePlay: false,
  supportsEffects: true,
  supportsTempo: true,
  polyphony: 4,
  defaultWidth: 380,
  defaultHeight: 400,
  minimumWidth: 260,
  minimumHeight: 300,
};

const LAYERS = [
  { id: "piston", label: "Piston", length: 4 },
  { id: "gear", label: "Gear", length: 6 },
  { id: "relay", label: "Relay", length: 5 },
  { id: "turbine", label: "Turbine", length: 8 },
];

function defaultPatterns() {
  const p = { piston: new Array(4).fill(0), gear: new Array(6).fill(0), relay: new Array(5).fill(0), turbine: new Array(8).fill(0) };
  p.piston[0] = 1;
  p.piston[2] = 0.85;
  p.gear[1] = 1;
  p.gear[4] = 0.5;
  p.relay[0] = 0.85;
  p.relay[3] = 0.5;
  p.turbine[0] = 1;
  return p;
}

// Every layer is the same noise-burst-through-a-filter engine, just a
// different filter register/type - the mechanical identity comes from
// wobble (random detune per hit) and friction (how long the turbine layer
// rings), both shared knobs that morph the whole machine at once.
function createMotorEngine(ctx, dest) {
  const noiseBuffer = makeNoiseBuffer(ctx, 0.25);
  let wobble = 0.12;
  let friction = 0.3;
  let pitch = 1;

  function burst(freqCenter, q, decay, time, type) {
    const t = time ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    const w = 1 + (Math.random() * 2 - 1) * wobble;
    filt.frequency.value = freqCenter * pitch * w;
    filt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.7, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(filt);
    filt.connect(g);
    g.connect(dest);
    src.start(t);
    src.stop(t + decay + 0.02);
  }

  return {
    trigger(id, idx, time) {
      if (id === "piston") burst(180, 3, 0.09, time, "lowpass");
      else if (id === "gear") burst(3200, 12, 0.03, time, "highpass");
      else if (id === "relay") burst(1400, 8, 0.05, time, "bandpass");
      else burst(500, 2, 0.22 + friction * 0.25, time, "bandpass");
    },
    setParam(key, value) {
      if (key === "wobble") wobble = value;
      if (key === "friction") friction = value;
      if (key === "pitch") pitch = value;
    },
    getParams: () => ({ wobble, friction, pitch }),
  };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createMotorEngine(ctx, output.input);
  let wobbleControl = null;
  let frictionControl = null;
  const loops = createPolyrhythmLoops({
    layers: LAYERS,
    defaultPatterns,
    trigger: (id, idx, time) => engine.trigger(id, idx, time),
    extraControls: (row) => {
      const p = engine.getParams();
      wobbleControl = buildParamRow(row, { label: "Wobble", min: 0, max: 100, value: Math.round(p.wobble * 100), format: (v) => v + "%", onInput: (v) => engine.setParam("wobble", v / 100) });
      frictionControl = buildParamRow(row, { label: "Friction", min: 0, max: 100, value: Math.round(p.friction * 100), format: (v) => v + "%", onInput: (v) => engine.setParam("friction", v / 100) });
    },
  });

  return {
    manifest,
    mount(el) { loops.mount(el, "im-polyrhythm"); },
    unmount() { loops.unmount(); },
    start() { loops.start(); },
    stop() { loops.stop(); },
    getAudioOutput() { return output.output; },
    setEffectAmount(kind, amount) { if (output[kind]) output[kind].setAmount(amount); },
    serialize() {
      return { ...loops.serialize(), params: engine.getParams() };
    },
    restore(state) {
      if (!state) return;
      loops.restore(state);
      if (state.params) {
        engine.setParam("wobble", state.params.wobble);
        engine.setParam("friction", state.params.friction);
        engine.setParam("pitch", state.params.pitch);
        wobbleControl?.setValue(Math.round(state.params.wobble * 100));
        frictionControl?.setValue(Math.round(state.params.friction * 100));
      }
    },
    dispose() {
      this.stop();
      this.unmount();
      try { output.output.disconnect(); } catch (e) {}
    },
  };
}
