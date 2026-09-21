import { createEffectsChain } from "../../core/effects.js";
import { buildParamRow } from "../../core/param-controls.js";

export const manifest = {
  id: "pure-tone",
  name: "Pure Tone",
  shortName: "Tone",
  description: "A single oscillator, nothing else - pick a waveform, set a frequency, that's the whole instrument.",
  category: "Experimental",
  tags: ["tone", "oscillator", "frequency", "waveform", "test-tone", "simple"],
  version: "1.0.0",
  icon: "\u{1F30A}",
  supportsSequencer: true,
  supportsLivePlay: false,
  supportsEffects: true,
  supportsTempo: false,
  polyphony: 1,
  defaultWidth: 340,
  defaultHeight: 260,
  minimumWidth: 260,
  minimumHeight: 220,
};

const FREQ_MIN = 20;
const FREQ_MAX = 8000;
const WAVES = [
  { type: "sine", label: "Sine" },
  { type: "triangle", label: "Triangle" },
  { type: "sawtooth", label: "Saw" },
  { type: "square", label: "Square" },
];

function sliderToFreq(v) {
  return FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, v / 100);
}
function freqToSlider(freq) {
  return (100 * Math.log(freq / FREQ_MIN)) / Math.log(FREQ_MAX / FREQ_MIN);
}

function createPureToneEngine(ctx, dest) {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = 220;
  const bus = ctx.createGain();
  bus.gain.value = 0;
  osc.connect(bus);
  bus.connect(dest);
  osc.start();

  let freq = 220;

  function start() {
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setTargetAtTime(0.5, ctx.currentTime, 0.2);
  }
  function stop() {
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
  }
  function dispose() {
    try {
      osc.stop();
      osc.disconnect();
      bus.disconnect();
    } catch (e) {}
  }

  return {
    start,
    stop,
    dispose,
    setFrequency(hz) {
      freq = hz;
      osc.frequency.setTargetAtTime(hz, ctx.currentTime, 0.02);
    },
    setWave(type) { osc.type = type; },
    getFrequency: () => freq,
    getWave: () => osc.type,
  };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createPureToneEngine(ctx, output.input);
  let container = null;

  function buildUI() {
    container.innerHTML = "";
    container.classList.add("im-pure-tone");

    const waveRow = document.createElement("div");
    waveRow.className = "im-controls-row";
    const label = document.createElement("span");
    label.className = "im-label";
    label.textContent = "Wave";
    waveRow.appendChild(label);
    const waveButtons = {};
    WAVES.forEach(({ type, label: waveLabel }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "im-btn" + (type === engine.getWave() ? " im-btn-on" : "");
      btn.textContent = waveLabel;
      btn.addEventListener("click", () => {
        engine.setWave(type);
        Object.entries(waveButtons).forEach(([t, b]) => b.classList.toggle("im-btn-on", t === type));
      });
      waveButtons[type] = btn;
      waveRow.appendChild(btn);
    });
    container.appendChild(waveRow);

    const controls = document.createElement("div");
    controls.className = "im-controls-row";
    controls.style.flexDirection = "column";
    controls.style.alignItems = "stretch";
    buildParamRow(controls, {
      label: "Frequency",
      min: 0,
      max: 100,
      step: 0.1,
      value: freqToSlider(engine.getFrequency()),
      format: (v) => Math.round(sliderToFreq(v)) + " Hz",
      onInput: (v) => engine.setFrequency(sliderToFreq(v)),
    });
    container.appendChild(controls);
  }

  return {
    manifest,
    mount(el) { container = el; buildUI(); },
    unmount() { if (container) container.innerHTML = ""; container = null; },
    start() { engine.start(); },
    stop() { engine.stop(); },
    getAudioOutput() { return output.output; },
    setEffectAmount(kind, amount) { if (output[kind]) output[kind].setAmount(amount); },
    serialize() { return { frequency: engine.getFrequency(), wave: engine.getWave() }; },
    restore(state) {
      if (!state) return;
      if (typeof state.frequency === "number") engine.setFrequency(state.frequency);
      if (typeof state.wave === "string") engine.setWave(state.wave);
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
