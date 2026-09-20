import { createEffectsChain } from "../../core/effects.js";
import { buildParamRow } from "../../core/param-controls.js";

export const manifest = {
  id: "scatter",
  name: "Scatter",
  shortName: "Scatter",
  description: "Tap a note and it explodes into a cloud of rhythmically scattered copies - pitch, pan, and timing all jittered.",
  category: "Generative",
  tags: ["generative", "repeater", "granular", "played", "polyphonic"],
  version: "1.0.0",
  icon: "\u{2728}",
  supportsSequencer: false,
  supportsLivePlay: true,
  supportsEffects: true,
  supportsTempo: false,
  polyphony: 20,
  defaultWidth: 340,
  defaultHeight: 340,
  minimumWidth: 260,
  minimumHeight: 280,
};

const NOTE_NAMES = ["C", "D", "E", "F", "G", "A", "B"];
const SCALE = [0, 2, 4, 5, 7, 9, 11];

// One tap schedules `density` short pings within a jittered time window,
// each with its own random pitch offset (within `spread` semitones) and
// random pan - the whole cloud is scheduled at once from a single trigger,
// not built up note by note.
function createScatterEngine(ctx, dest) {
  let params = { density: 8, spread: 6, decay: 0.15, windowMs: 300 };

  function ping(freq, time, gainScale, pan) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainScale, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + params.decay);
    osc.connect(p);
    p.connect(g);
    g.connect(dest);
    osc.start(time);
    osc.stop(time + params.decay + 0.03);
  }

  function scatter(note) {
    const baseFreq = 440 * Math.pow(2, (60 + note - 69) / 12);
    const now = ctx.currentTime;
    for (let i = 0; i < params.density; i++) {
      const t = now + Math.random() * (params.windowMs / 1000);
      const semis = (Math.random() * 2 - 1) * params.spread;
      const freq = baseFreq * Math.pow(2, semis / 12);
      const pan = Math.random() * 2 - 1;
      const g = 0.12 + Math.random() * 0.14;
      ping(freq, t, g, pan);
    }
  }

  return {
    scatter,
    setParam(key, value) { params[key] = value; },
    getParams: () => ({ ...params }),
  };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createScatterEngine(ctx, output.input);
  let container = null;

  function buildUI() {
    container.innerHTML = "";
    container.classList.add("im-scatter");

    const notepad = document.createElement("div");
    notepad.className = "im-notepad-row";
    SCALE.forEach((note, i) => {
      const btn = document.createElement("button");
      btn.className = "im-notepad-btn";
      btn.textContent = NOTE_NAMES[i];
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        engine.scatter(note);
      });
      notepad.appendChild(btn);
    });
    container.appendChild(notepad);

    const controls = document.createElement("div");
    controls.className = "im-controls-row";
    controls.style.flexDirection = "column";
    controls.style.alignItems = "stretch";
    const p = engine.getParams();
    buildParamRow(controls, { label: "Density", min: 1, max: 20, value: p.density, onInput: (v) => engine.setParam("density", v) });
    buildParamRow(controls, { label: "Spread", min: 0, max: 24, value: p.spread, format: (v) => v + "st", onInput: (v) => engine.setParam("spread", v) });
    buildParamRow(controls, { label: "Decay", min: 5, max: 60, value: Math.round(p.decay * 100), format: (v) => (v / 100).toFixed(2) + "s", onInput: (v) => engine.setParam("decay", v / 100) });
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
    stop() {},
    getAudioOutput() { return output.output; },
    setEffectAmount(kind, amount) { if (output[kind]) output[kind].setAmount(amount); },
    serialize() {
      return { params: engine.getParams() };
    },
    restore(state) {
      if (state?.params) {
        for (const [k, v] of Object.entries(state.params)) engine.setParam(k, v);
      }
      if (container) buildUI();
    },
    dispose() {
      this.unmount();
      try { output.output.disconnect(); } catch (e) {}
    },
  };
}
