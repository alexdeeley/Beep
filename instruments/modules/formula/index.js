import { createEffectsChain } from "../../core/effects.js";
import { buildParamRow } from "../../core/param-controls.js";

export const manifest = {
  id: "formula",
  name: "Formula",
  shortName: "Formula",
  description: "Oscillator frequencies derived straight from math - harmonic, odd, prime, or Fibonacci ratios over a base tone.",
  category: "Generative",
  tags: ["math", "generative", "harmonic", "drone", "oscillators"],
  version: "1.0.0",
  icon: "\u{1F9EE}",
  supportsSequencer: true,
  supportsLivePlay: false,
  supportsEffects: true,
  supportsTempo: false,
  polyphony: 8,
  defaultWidth: 360,
  defaultHeight: 340,
  minimumWidth: 280,
  minimumHeight: 280,
};

const MAX_VOICES = 8;
const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19];
const FIB = [1, 1, 2, 3, 5, 8, 13, 21];

const FORMULAS = {
  harmonic: { label: "Harmonic", fn: (n) => n },
  odd: { label: "Odd", fn: (n) => 2 * n - 1 },
  prime: { label: "Prime", fn: (n) => PRIMES[n - 1] / PRIMES[0] },
  fibonacci: { label: "Fibonacci", fn: (n) => FIB[n - 1] },
};

// Every voice's frequency is baseFreq * formula(n)^spread - the formula
// picks which sequence of integers/ratios generates the overtone
// structure, and spread bends that sequence's growth curve (spread=1 is
// the formula's own ratios; above/below 1 compresses or stretches them).
// Amplitude rolls off as 1/n like a real harmonic series so it stays
// listenable at any voice count instead of getting harsher as voices grow.
function createFormulaEngine(ctx, dest) {
  const bus = ctx.createGain();
  bus.gain.value = 0;
  bus.connect(dest);

  const voices = Array.from({ length: MAX_VOICES }, () => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 220;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(bus);
    osc.start();
    return { osc, gain };
  });

  let params = { baseFreq: 110, voiceCount: 5, formula: "harmonic", spread: 1 };

  function apply() {
    const now = ctx.currentTime;
    const formulaFn = FORMULAS[params.formula].fn;
    voices.forEach((v, i) => {
      const n = i + 1;
      if (n > params.voiceCount) {
        v.gain.gain.setTargetAtTime(0, now, 0.1);
        return;
      }
      const ratio = Math.pow(formulaFn(n), params.spread);
      const freq = params.baseFreq * ratio;
      if (freq > 20 && freq < 18000) {
        v.osc.frequency.setTargetAtTime(freq, now, 0.08);
        v.gain.gain.setTargetAtTime(0.9 / n, now, 0.15);
      } else {
        v.gain.gain.setTargetAtTime(0, now, 0.1);
      }
    });
  }
  apply();

  function start() {
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setTargetAtTime(0.5, ctx.currentTime, 0.3);
  }
  function stop() {
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
  }
  function dispose() {
    voices.forEach((v) => {
      try {
        v.osc.stop();
        v.osc.disconnect();
        v.gain.disconnect();
      } catch (e) {}
    });
    try {
      bus.disconnect();
    } catch (e) {}
  }

  return {
    start,
    stop,
    dispose,
    setBaseFreq(hz) { params.baseFreq = hz; apply(); },
    setVoiceCount(n) { params.voiceCount = n; apply(); },
    setFormula(key) { params.formula = key; apply(); },
    setSpread(v) { params.spread = v; apply(); },
    getParams: () => ({ ...params }),
  };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createFormulaEngine(ctx, output.input);
  let container = null;

  function buildUI() {
    container.innerHTML = "";
    container.classList.add("im-formula");
    const p = engine.getParams();

    const formulaRow = document.createElement("div");
    formulaRow.className = "im-controls-row";
    const label = document.createElement("span");
    label.className = "im-label";
    label.textContent = "Formula";
    formulaRow.appendChild(label);
    const formulaButtons = {};
    Object.entries(FORMULAS).forEach(([key, def]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "im-btn" + (key === p.formula ? " im-btn-on" : "");
      btn.textContent = def.label;
      btn.addEventListener("click", () => {
        engine.setFormula(key);
        Object.entries(formulaButtons).forEach(([k, b]) => b.classList.toggle("im-btn-on", k === key));
      });
      formulaButtons[key] = btn;
      formulaRow.appendChild(btn);
    });
    container.appendChild(formulaRow);

    const controls = document.createElement("div");
    controls.className = "im-controls-row";
    controls.style.flexDirection = "column";
    controls.style.alignItems = "stretch";

    buildParamRow(controls, {
      label: "Base Freq",
      min: 30,
      max: 400,
      value: p.baseFreq,
      format: (v) => Math.round(v) + " Hz",
      onInput: (v) => engine.setBaseFreq(v),
    });
    buildParamRow(controls, {
      label: "Voices",
      min: 1,
      max: MAX_VOICES,
      value: p.voiceCount,
      onInput: (v) => engine.setVoiceCount(v),
    });
    buildParamRow(controls, {
      label: "Spread",
      min: 25,
      max: 250,
      value: Math.round(p.spread * 100),
      format: (v) => (v / 100).toFixed(2) + "x",
      onInput: (v) => engine.setSpread(v / 100),
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
      return engine.getParams();
    },
    restore(state) {
      if (!state) return;
      if (typeof state.baseFreq === "number") engine.setBaseFreq(state.baseFreq);
      if (typeof state.voiceCount === "number") engine.setVoiceCount(state.voiceCount);
      if (typeof state.formula === "string" && FORMULAS[state.formula]) engine.setFormula(state.formula);
      if (typeof state.spread === "number") engine.setSpread(state.spread);
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
