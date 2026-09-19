import { createEffectsChain } from "../../core/effects.js";
import { makeNoiseBuffer, makeDistortionCurve } from "../../core/dsp-utils.js";
import { buildParamRow } from "../../core/param-controls.js";

export const manifest = {
  id: "noise-wall",
  name: "Noise Wall",
  shortName: "Wall",
  description: "A continuous harsh noise texture - drive and a slow filter sweep, no steps, no notes, just wall.",
  category: "Generative",
  tags: ["noise", "harsh", "drone", "texture", "generative"],
  version: "1.0.0",
  icon: "\u{1F9F1}",
  supportsSequencer: true,
  supportsLivePlay: false,
  supportsEffects: true,
  supportsTempo: false,
  polyphony: 1,
  defaultWidth: 340,
  defaultHeight: 300,
  minimumWidth: 260,
  minimumHeight: 260,
};

// A looping noise source through drive+waveshaping for harshness, then a
// resonant filter slowly swept by an LFO so the wall isn't static - it
// starts/stops with the shared transport's Play/Stop like any other
// instrument, it just has no steps or notes to show for it.
function createNoiseWallEngine(ctx, dest) {
  const buffer = makeNoiseBuffer(ctx, 2.0);
  const drive = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  shaper.oversample = "2x";
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1200;
  filter.Q.value = 4;
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.15;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 800;
  const output = ctx.createGain();
  output.gain.value = 0.6;

  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);
  drive.connect(shaper);
  shaper.connect(filter);
  filter.connect(output);
  output.connect(dest);
  lfo.start();

  let src = null;
  let harshness = 0.5;
  let sweepRate = 0.15;

  function updateDrive() {
    drive.gain.value = 1 + harshness * 20;
    shaper.curve = makeDistortionCurve(harshness * 60);
  }
  updateDrive();

  function start() {
    if (src) return;
    src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(drive);
    src.start();
  }

  function stop() {
    if (!src) return;
    try {
      src.stop();
      src.disconnect();
    } catch (e) {}
    src = null;
  }

  function dispose() {
    stop();
    try {
      lfo.stop();
      lfo.disconnect();
      lfoGain.disconnect();
      drive.disconnect();
      shaper.disconnect();
      filter.disconnect();
      output.disconnect();
    } catch (e) {}
  }

  return {
    start,
    stop,
    setHarshness(v) {
      harshness = Math.max(0, Math.min(1, v));
      updateDrive();
    },
    setSweepRate(v) {
      sweepRate = Math.max(0, Math.min(1, v));
      lfo.frequency.setTargetAtTime(0.02 + sweepRate * 2, ctx.currentTime, 0.15);
    },
    getHarshness: () => harshness,
    getSweepRate: () => sweepRate,
    dispose,
  };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createNoiseWallEngine(ctx, output.input);
  let container = null;

  function buildUI() {
    container.innerHTML = "";
    container.classList.add("im-noisewall");

    const hint = document.createElement("div");
    hint.className = "im-label";
    hint.textContent = "Runs with the shared Play/Stop - no steps, no notes.";
    container.appendChild(hint);

    const controls = document.createElement("div");
    controls.className = "im-controls-row";
    controls.style.flexDirection = "column";
    controls.style.alignItems = "stretch";
    buildParamRow(controls, {
      label: "Harshness",
      min: 0,
      max: 100,
      value: Math.round(engine.getHarshness() * 100),
      format: (v) => v + "%",
      onInput: (v) => engine.setHarshness(v / 100),
    });
    buildParamRow(controls, {
      label: "Sweep",
      min: 0,
      max: 100,
      value: Math.round(engine.getSweepRate() * 100),
      format: (v) => v + "%",
      onInput: (v) => engine.setSweepRate(v / 100),
    });
    container.appendChild(controls);
  }

  return {
    manifest,
    mount(el) {
      container = el;
      buildUI();
    },
    unmount() {
      if (container) container.innerHTML = "";
      container = null;
    },
    start() { engine.start(); },
    stop() { engine.stop(); },
    getAudioOutput() { return output.output; },
    setEffectAmount(kind, amount) { if (output[kind]) output[kind].setAmount(amount); },
    serialize() {
      return { harshness: engine.getHarshness(), sweepRate: engine.getSweepRate() };
    },
    restore(state) {
      if (!state) return;
      if (typeof state.harshness === "number") engine.setHarshness(state.harshness);
      if (typeof state.sweepRate === "number") engine.setSweepRate(state.sweepRate);
      if (container) buildUI();
    },
    dispose() {
      this.stop();
      this.unmount();
      engine.dispose();
      try { output.output.disconnect(); } catch (e) {}
    },
  };
}
