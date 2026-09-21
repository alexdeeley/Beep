import { createEffectsChain } from "../../core/effects.js";
import { buildParamRow } from "../../core/param-controls.js";
import { subscribe as transportSubscribe, getBpm } from "../../core/transport.js";

export const manifest = {
  id: "pulse-bass",
  name: "Pulse Bass",
  shortName: "Pulse",
  description: "A relentless bass that triggers itself on every 16th note - no pattern to program, just Pitch, Gate, and Tone.",
  category: "Bass",
  tags: ["bass", "pulse", "16th-note", "rhythmic", "edm", "simple"],
  version: "1.0.0",
  icon: "\u{1F493}",
  supportsSequencer: true,
  supportsLivePlay: false,
  supportsEffects: true,
  supportsTempo: true,
  polyphony: 1,
  defaultWidth: 340,
  defaultHeight: 260,
  minimumWidth: 240,
  minimumHeight: 220,
};

// No step grid at all - the whole point is that it just pulses, driven
// directly off the shared transport's 16th-note clock. Every step gets a
// short envelope "gate" rather than a full glide-capable note, and the
// downbeat of each bar lands a little louder for a felt groove rather
// than a flat mechanical stutter.
function createPulseBassEngine(ctx, dest) {
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = 55;

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 2;

  const amp = ctx.createGain();
  amp.gain.value = 0;

  osc.connect(filter);
  filter.connect(amp);
  osc.start();

  let params = { freq: 55, gate: 0.5, tone: 0.5 };
  let unsub = null;

  function applyTone() {
    filter.frequency.setTargetAtTime(150 + params.tone * 4000, ctx.currentTime, 0.02);
  }
  applyTone();

  function pulse({ time, isBeat }) {
    const stepDur = 60 / getBpm() / 4;
    const gateTime = Math.max(0.02, stepDur * params.gate);
    osc.frequency.setValueAtTime(params.freq, time);
    amp.gain.cancelScheduledValues(time);
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(isBeat ? 0.9 : 0.62, time + 0.004);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + gateTime);
  }

  function start() {
    if (unsub) return;
    unsub = transportSubscribe(pulse);
  }
  function stop() {
    if (unsub) {
      unsub();
      unsub = null;
    }
    amp.gain.cancelScheduledValues(ctx.currentTime);
    amp.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
  }
  function dispose() {
    stop();
    try {
      osc.stop();
      osc.disconnect();
      filter.disconnect();
      amp.disconnect();
    } catch (e) {}
  }

  amp.connect(dest);

  return {
    start,
    stop,
    dispose,
    setFrequency(hz) { params.freq = hz; },
    setGate(v) { params.gate = v; },
    setTone(v) { params.tone = v; applyTone(); },
    getFrequency: () => params.freq,
    getGate: () => params.gate,
    getTone: () => params.tone,
  };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createPulseBassEngine(ctx, output.input);
  let container = null;

  function buildUI() {
    container.innerHTML = "";
    container.classList.add("im-pulse-bass");

    const controls = document.createElement("div");
    controls.className = "im-controls-row";
    controls.style.flexDirection = "column";
    controls.style.alignItems = "stretch";

    buildParamRow(controls, {
      label: "Pitch",
      min: 30,
      max: 200,
      value: Math.round(engine.getFrequency()),
      format: (v) => Math.round(v) + " Hz",
      onInput: (v) => engine.setFrequency(v),
    });
    buildParamRow(controls, {
      label: "Gate",
      min: 5,
      max: 100,
      value: Math.round(engine.getGate() * 100),
      format: (v) => v + "%",
      onInput: (v) => engine.setGate(v / 100),
    });
    buildParamRow(controls, {
      label: "Tone",
      min: 0,
      max: 100,
      value: Math.round(engine.getTone() * 100),
      format: (v) => v + "%",
      onInput: (v) => engine.setTone(v / 100),
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
    serialize() {
      return { frequency: engine.getFrequency(), gate: engine.getGate(), tone: engine.getTone() };
    },
    restore(state) {
      if (!state) return;
      if (typeof state.frequency === "number") engine.setFrequency(state.frequency);
      if (typeof state.gate === "number") engine.setGate(state.gate);
      if (typeof state.tone === "number") engine.setTone(state.tone);
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
