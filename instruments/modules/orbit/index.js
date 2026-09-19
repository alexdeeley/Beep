import { createEffectsChain } from "../../core/effects.js";
import { buildParamRow } from "../../core/param-controls.js";

export const manifest = {
  id: "orbit",
  name: "Orbit",
  shortName: "Orbit",
  description: "Four voices rotate around a root pitch via slow independent LFOs - a played, evolving drone rather than a sequence.",
  category: "Generative",
  tags: ["generative", "drone", "ambient", "played", "polyphonic"],
  version: "1.0.0",
  icon: "\u{1FA90}",
  supportsSequencer: false,
  supportsLivePlay: true,
  supportsEffects: true,
  supportsTempo: false,
  polyphony: 4,
  defaultWidth: 340,
  defaultHeight: 340,
  minimumWidth: 260,
  minimumHeight: 280,
};

const NOTE_NAMES = ["C", "D", "E", "F", "G", "A", "B"];
const SCALE = [0, 2, 4, 5, 7, 9, 11];

// Four persistent sine voices at fixed harmonic ratios above the root,
// each panned by its own slow LFO at a slightly different rate. Nothing
// here is a fixed pattern - the "orbit" is literally four independent
// clocks that drift in and out of phase with each other forever.
function createOrbitEngine(ctx, dest) {
  const ratios = [1, 1.5, 2, 0.5];
  const voices = ratios.map((ratio, i) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 220 * ratio;
    const panner = ctx.createStereoPanner();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.03 + i * 0.02;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.6;
    lfo.connect(lfoGain);
    lfoGain.connect(panner.pan);
    osc.connect(panner);
    panner.connect(gain);
    gain.connect(dest);
    osc.start();
    lfo.start();
    return { osc, gain, lfo, ratio };
  });

  let speed = 0.5;

  function setSpeed(v) {
    speed = v;
    voices.forEach((voice, i) => voice.lfo.frequency.setTargetAtTime(0.015 + (i + 1) * 0.02 * (0.3 + speed), ctx.currentTime, 0.6));
  }

  function playRoot(note) {
    const freq = 440 * Math.pow(2, (57 + note - 69) / 12);
    const now = ctx.currentTime;
    voices.forEach((voice) => {
      voice.osc.frequency.setTargetAtTime(freq * voice.ratio, now, 0.2);
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(0.16, now, 0.7);
    });
  }

  function stopAll() {
    const now = ctx.currentTime;
    voices.forEach((voice) => voice.gain.gain.setTargetAtTime(0.0001, now, 0.8));
  }

  function dispose() {
    voices.forEach((voice) => {
      try {
        voice.osc.stop();
        voice.lfo.stop();
        voice.osc.disconnect();
        voice.lfo.disconnect();
        voice.gain.disconnect();
      } catch (e) {}
    });
  }

  setSpeed(speed);
  return { playRoot, stopAll, setSpeed, getSpeed: () => speed, dispose };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createOrbitEngine(ctx, output.input);
  let container = null;

  function buildUI() {
    container.innerHTML = "";
    container.classList.add("im-orbit");

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
        engine.playRoot(note);
      });
      notepad.appendChild(btn);
    });
    container.appendChild(notepad);

    const controls = document.createElement("div");
    controls.className = "im-controls-row";
    buildParamRow(controls, {
      label: "Rotation",
      min: 0,
      max: 100,
      value: Math.round(engine.getSpeed() * 100),
      format: (v) => v + "%",
      onInput: (v) => engine.setSpeed(v / 100),
    });
    container.appendChild(controls);

    const stopRow = document.createElement("div");
    stopRow.className = "im-controls-row";
    const stopBtn = document.createElement("button");
    stopBtn.className = "im-btn";
    stopBtn.textContent = "Stop";
    stopBtn.addEventListener("click", () => {
      container.querySelectorAll(".im-notepad-btn").forEach((b) => b.classList.remove("im-btn-on"));
      engine.stopAll();
    });
    stopRow.appendChild(stopBtn);
    container.appendChild(stopRow);
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
    serialize() {
      return { speed: engine.getSpeed() };
    },
    restore(state) {
      if (state && typeof state.speed === "number") engine.setSpeed(state.speed);
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
