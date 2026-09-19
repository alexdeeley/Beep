import { createEffectsChain } from "../../core/effects.js";
import { makeNoiseBuffer } from "../../core/dsp-utils.js";

export const manifest = {
  id: "bloom",
  name: "Bloom",
  shortName: "Bloom",
  description: "Press a note and it unfolds - one tone, then octave, detune, noise, and fifth layers fade in over several seconds.",
  category: "Keys",
  tags: ["chord", "growth", "ambient", "played", "polyphonic"],
  version: "1.0.0",
  icon: "\u{1F338}",
  supportsSequencer: false,
  supportsLivePlay: true,
  supportsEffects: true,
  supportsTempo: false,
  polyphony: 5,
  defaultWidth: 340,
  defaultHeight: 320,
  minimumWidth: 260,
  minimumHeight: 260,
};

// Every layer is scheduled at note-on: it's not a synth voice with a
// growing filter envelope, it's five actual voices (sine root, octave
// triangle, detuned saw, filtered noise, sine fifth) each with its own
// start time and fade-in, so the timbre itself gets richer over time
// rather than just getting louder or brighter.
const LAYER_DEFS = [
  { type: "sine", ratio: 1, delayS: 0, targetGain: 0.32 },
  { type: "triangle", ratio: 2, delayS: 0.6, targetGain: 0.16 },
  { type: "sawtooth", ratio: 1.004, delayS: 1.4, targetGain: 0.12 },
  { type: "noise", ratio: 1, delayS: 2.4, targetGain: 0.07 },
  { type: "sine", ratio: 1.5, delayS: 3.3, targetGain: 0.1 },
];

function createBloomEngine(ctx, dest) {
  const noiseBuffer = makeNoiseBuffer(ctx, 2);
  let activeLayers = [];

  function makeLayer(def, freq, startAt) {
    let src;
    if (def.type === "noise") {
      src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      src.loop = true;
    } else {
      src = ctx.createOscillator();
      src.type = def.type;
      src.frequency.value = freq * def.ratio;
    }
    const filter = ctx.createBiquadFilter();
    filter.type = def.type === "noise" ? "bandpass" : "lowpass";
    filter.frequency.value = def.type === "noise" ? freq * 2 : 4000;
    if (def.type === "noise") filter.Q.value = 3;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    src.start(startAt);
    return { src, gain };
  }

  function bloom(note) {
    stopAll(0.4);
    const freq = 440 * Math.pow(2, (57 + note - 69) / 12);
    const now = ctx.currentTime;
    activeLayers = LAYER_DEFS.map((def) => {
      const startAt = now + def.delayS;
      const layer = makeLayer(def, freq, startAt);
      layer.gain.gain.setValueAtTime(0.0001, startAt);
      layer.gain.gain.exponentialRampToValueAtTime(def.targetGain, startAt + 1.1);
      return layer;
    });
  }

  function stopAll(fade = 1.2) {
    const now = ctx.currentTime;
    activeLayers.forEach((layer) => {
      layer.gain.gain.cancelScheduledValues(now);
      layer.gain.gain.setTargetAtTime(0.0001, now, fade / 3);
      try { layer.src.stop(now + fade + 0.5); } catch (e) {}
    });
    activeLayers = [];
  }

  return { bloom, stopAll };
}

const NOTE_NAMES = ["C", "D", "E", "F", "G", "A", "B"];
const SCALE = [0, 2, 4, 5, 7, 9, 11];

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createBloomEngine(ctx, output.input);
  let container = null;

  function buildUI() {
    container.innerHTML = "";
    container.classList.add("im-bloom");

    const notepad = document.createElement("div");
    notepad.className = "im-notepad-row";
    SCALE.forEach((note, i) => {
      const btn = document.createElement("button");
      btn.className = "im-notepad-btn";
      btn.textContent = NOTE_NAMES[i];
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        container.querySelectorAll(".im-notepad-btn").forEach((b) => b.classList.remove("im-btn-on"));
        btn.classList.add("im-btn-on");
        engine.bloom(note);
      });
      notepad.appendChild(btn);
    });
    container.appendChild(notepad);

    const controls = document.createElement("div");
    controls.className = "im-controls-row";
    const stopBtn = document.createElement("button");
    stopBtn.className = "im-btn";
    stopBtn.textContent = "Stop";
    stopBtn.addEventListener("click", () => {
      container.querySelectorAll(".im-notepad-btn").forEach((b) => b.classList.remove("im-btn-on"));
      engine.stopAll();
    });
    controls.appendChild(stopBtn);
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
    start() {},
    stop() {
      engine.stopAll();
    },
    getAudioOutput() { return output.output; },
    setEffectAmount(kind, amount) { if (output[kind]) output[kind].setAmount(amount); },
    serialize() { return {}; },
    restore() {},
    dispose() {
      this.stop();
      this.unmount();
      try { output.output.disconnect(); } catch (e) {}
    },
  };
}
