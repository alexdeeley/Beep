import { createEffectsChain } from "../../core/effects.js";
import { subscribe as transportSubscribe } from "../../core/transport.js";
import { makeNoiseBuffer } from "../../core/dsp-utils.js";
import { buildParamRow } from "../../core/param-controls.js";

export const manifest = {
  id: "rain",
  name: "Rain",
  shortName: "Rain",
  description: "A generative droplet instrument - density and pitch-field controls decide how often resonant plucks fall, not a fixed pattern.",
  category: "Generative",
  tags: ["generative", "droplet", "ambient", "probability", "synthesized"],
  version: "1.0.0",
  icon: "\u{1F327}\u{FE0F}",
  supportsSequencer: true,
  supportsLivePlay: false,
  supportsEffects: true,
  supportsTempo: true,
  polyphony: 8,
  defaultWidth: 340,
  defaultHeight: 340,
  minimumWidth: 260,
  minimumHeight: 280,
};

// No pattern grid at all - each shared-transport tick just rolls the dice
// against `density`, and a hit fires a short resonant noise burst at a
// random pitch inside the field. `clustering` is a second roll for an
// immediate follow-up droplet, which is what turns sparse rain into a
// flurry without ever becoming a fixed rhythm.
function createRainEngine(ctx, dest) {
  const noiseBuffer = makeNoiseBuffer(ctx, 0.03);

  function droplet(time, freq, gainScale) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = 28;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainScale, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.28);
    src.connect(bp);
    bp.connect(g);
    g.connect(dest);
    src.start(time);
    src.stop(time + 0.32);
  }

  return { droplet };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createRainEngine(ctx, output.input);
  let params = { density: 0.35, pitchLow: 500, pitchHigh: 2400, clustering: 0.15 };
  let unsubTransport = null;
  let container = null;

  function onTransportStep({ time }) {
    if (Math.random() < params.density) {
      const freq = params.pitchLow + Math.random() * (params.pitchHigh - params.pitchLow);
      engine.droplet(time, freq, 0.22 + Math.random() * 0.18);
      if (Math.random() < params.clustering) {
        engine.droplet(time + 0.03 + Math.random() * 0.06, freq * (1 + (Math.random() * 0.3 - 0.15)), 0.12);
      }
    }
  }

  function buildUI() {
    container.innerHTML = "";
    container.classList.add("im-rain");
    const wrap = document.createElement("div");
    wrap.className = "im-controls-row";
    wrap.style.flexDirection = "column";
    wrap.style.alignItems = "stretch";

    buildParamRow(wrap, { label: "Density", min: 0, max: 100, value: Math.round(params.density * 100), format: (v) => v + "%", onInput: (v) => (params.density = v / 100) });
    buildParamRow(wrap, { label: "Pitch Low", min: 100, max: 2000, value: params.pitchLow, format: (v) => v + "Hz", onInput: (v) => (params.pitchLow = Math.min(v, params.pitchHigh - 50)) });
    buildParamRow(wrap, { label: "Pitch High", min: 500, max: 6000, value: params.pitchHigh, format: (v) => v + "Hz", onInput: (v) => (params.pitchHigh = Math.max(v, params.pitchLow + 50)) });
    buildParamRow(wrap, { label: "Clustering", min: 0, max: 100, value: Math.round(params.clustering * 100), format: (v) => v + "%", onInput: (v) => (params.clustering = v / 100) });

    container.appendChild(wrap);
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
    start() {
      if (unsubTransport) return;
      unsubTransport = transportSubscribe(onTransportStep);
    },
    stop() {
      if (unsubTransport) {
        unsubTransport();
        unsubTransport = null;
      }
    },
    getAudioOutput() { return output.output; },
    setEffectAmount(kind, amount) { if (output[kind]) output[kind].setAmount(amount); },
    serialize() {
      return { params };
    },
    restore(state) {
      if (state?.params) params = { ...params, ...state.params };
      if (container) buildUI();
    },
    dispose() {
      this.stop();
      this.unmount();
      try { output.output.disconnect(); } catch (e) {}
    },
  };
}
