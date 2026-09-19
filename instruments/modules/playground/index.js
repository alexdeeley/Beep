import { createEffectsChain } from "../../core/effects.js";
import { buildParamRow } from "../../core/param-controls.js";

export const manifest = {
  id: "playground",
  name: "Sonic Playground",
  shortName: "Playground",
  description: "A pure tone you drag anywhere across the audible range in real time - no notes, no grid, just frequency to explore.",
  category: "Experimental",
  tags: ["ambient", "tone", "frequency", "drone", "exploration"],
  version: "1.0.0",
  icon: "\u{1F3A2}",
  supportsSequencer: true,
  supportsLivePlay: false,
  supportsEffects: true,
  supportsTempo: false,
  polyphony: 3,
  defaultWidth: 360,
  defaultHeight: 300,
  minimumWidth: 280,
  minimumHeight: 260,
};

const FREQ_MIN = 40;
const FREQ_MAX = 2000;

function sliderToFreq(v) {
  return FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, v / 100);
}
function freqToSlider(freq) {
  return (100 * Math.log(freq / FREQ_MIN)) / Math.log(FREQ_MAX / FREQ_MIN);
}

// Deliberately unquantized - the frequency slider maps continuously (log
// scale, so low and high ends both feel proportional) rather than
// snapping to notes, so dragging it is a genuine glissando across the
// whole audible range instead of a scale. A second, slightly detuned
// oscillator gives the tone width/beating; the harmonic layer and slow
// drift LFO are there to explore, not required for it to make sound.
function createPlaygroundEngine(ctx, dest) {
  const osc1 = ctx.createOscillator();
  osc1.type = "sine";
  const osc2 = ctx.createOscillator();
  osc2.type = "sine";
  const harmOsc = ctx.createOscillator();
  harmOsc.type = "sine";
  const harmGain = ctx.createGain();
  harmGain.gain.value = 0;

  const drift = ctx.createOscillator();
  drift.type = "sine";
  drift.frequency.value = 0.06;
  const driftGain = ctx.createGain();
  driftGain.gain.value = 0;

  const bus = ctx.createGain();
  bus.gain.value = 0;

  osc1.connect(bus);
  osc2.connect(bus);
  harmOsc.connect(harmGain);
  harmGain.connect(bus);
  drift.connect(driftGain);
  driftGain.connect(osc1.frequency);
  driftGain.connect(osc2.frequency);
  driftGain.connect(harmOsc.frequency);
  bus.connect(dest);

  osc1.start();
  osc2.start();
  harmOsc.start();
  drift.start();

  let baseFreq = 220;
  let harmonics = 0.2;
  let driftAmount = 0;

  function applyFreq() {
    const now = ctx.currentTime;
    osc1.frequency.setTargetAtTime(baseFreq, now, 0.03);
    osc2.frequency.setTargetAtTime(baseFreq * 1.006, now, 0.03);
    harmOsc.frequency.setTargetAtTime(baseFreq * 2, now, 0.03);
  }
  applyFreq();

  function start() {
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setTargetAtTime(0.45, ctx.currentTime, 0.4);
  }
  function stop() {
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
  }
  function dispose() {
    [osc1, osc2, harmOsc, drift].forEach((o) => {
      try {
        o.stop();
        o.disconnect();
      } catch (e) {}
    });
    try {
      bus.disconnect();
      harmGain.disconnect();
      driftGain.disconnect();
    } catch (e) {}
  }

  return {
    start,
    stop,
    dispose,
    setFrequency(hz) { baseFreq = hz; applyFreq(); },
    setHarmonics(v) {
      harmonics = v;
      harmGain.gain.setTargetAtTime(v * 0.4, ctx.currentTime, 0.05);
    },
    setDrift(v) {
      driftAmount = v;
      driftGain.gain.setTargetAtTime(v * 40, ctx.currentTime, 0.1);
    },
    getFrequency: () => baseFreq,
    getHarmonics: () => harmonics,
    getDrift: () => driftAmount,
  };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createPlaygroundEngine(ctx, output.input);
  let container = null;

  function buildUI() {
    container.innerHTML = "";
    container.classList.add("im-playground");

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
    buildParamRow(controls, {
      label: "Harmonics",
      min: 0,
      max: 100,
      value: Math.round(engine.getHarmonics() * 100),
      format: (v) => v + "%",
      onInput: (v) => engine.setHarmonics(v / 100),
    });
    buildParamRow(controls, {
      label: "Drift",
      min: 0,
      max: 100,
      value: Math.round(engine.getDrift() * 100),
      format: (v) => v + "%",
      onInput: (v) => engine.setDrift(v / 100),
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
      return { frequency: engine.getFrequency(), harmonics: engine.getHarmonics(), drift: engine.getDrift() };
    },
    restore(state) {
      if (!state) return;
      if (typeof state.frequency === "number") engine.setFrequency(state.frequency);
      if (typeof state.harmonics === "number") engine.setHarmonics(state.harmonics);
      if (typeof state.drift === "number") engine.setDrift(state.drift);
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
