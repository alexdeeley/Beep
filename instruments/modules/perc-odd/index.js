import { createEffectsChain } from "../../core/effects.js";
import { createDrumSequencer } from "../../core/drum-grid-ui.js";
import { makeNoiseBuffer } from "../../core/dsp-utils.js";

export const manifest = {
  id: "perc-odd",
  name: "Odd Meter Percussion",
  shortName: "OddPerc",
  description: "Hand percussion in 5-step or 15-step measures instead of the usual 16 - layer it against a standard kit for a pattern that keeps sliding out of phase.",
  category: "Drums",
  tags: ["percussion", "polyrhythm", "odd-meter", "synthesized"],
  version: "1.0.0",
  icon: "\u{1FA98}",
  supportsSequencer: true,
  supportsLivePlay: true,
  supportsEffects: true,
  supportsTempo: true,
  polyphony: 3,
  defaultWidth: 380,
  defaultHeight: 420,
  minimumWidth: 260,
  minimumHeight: 300,
};

const VOICES = [
  { id: "shaker", label: "SHAKE" },
  { id: "clave", label: "CLAVE" },
  { id: "conga", label: "CONGA" },
];

function defaultPatternForLength(steps) {
  const p = Object.fromEntries(VOICES.map((v) => [v.id, new Array(steps).fill(false)]));
  if (steps === 5) {
    for (let i = 0; i < steps; i++) p.shaker[i] = true;
    p.clave[0] = true;
    p.conga[2] = true;
  } else {
    for (let i = 0; i < steps; i += 2) p.shaker[i] = true;
    [0, 5, 10].forEach((i) => (p.clave[i] = true));
    [3, 7, 12].forEach((i) => (p.conga[i] = true));
  }
  return p;
}

// Warm hand-percussion timbres (tuned thump, resonant click, filtered
// noise) rather than the brittle/electronic character of the other kits -
// this one earns its place by playing in a different measure length, not
// by sounding harsher.
function createPercEngine(ctx, dest) {
  const noiseBuffer = makeNoiseBuffer(ctx, 0.3);

  function playShaker(time) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 6500;
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
    src.connect(bp);
    bp.connect(g);
    g.connect(dest);
    src.start(time);
    src.stop(time + 0.07);
  }

  function playClave(time) {
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = 2500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(g);
    g.connect(dest);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  function playConga(time) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(310, time);
    osc.frequency.exponentialRampToValueAtTime(180, time + 0.12);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(0.7, time + 0.004);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
    osc.connect(amp);
    amp.connect(dest);
    osc.start(time);
    osc.stop(time + 0.24);
  }

  return {
    shaker: (time) => playShaker(time),
    clave: (time) => playClave(time),
    conga: (time) => playConga(time),
  };
}

export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createPercEngine(ctx, output.input);
  let container = null;
  let seq = null;
  let stepCount = 5;
  let isPlaying = false;
  let lengthButtons = {};

  function buildSeq() {
    return createDrumSequencer({
      voices: VOICES,
      steps: stepCount,
      defaultPattern: () => defaultPatternForLength(stepCount),
      trigger: (id, time) => engine[id](time ?? ctx.currentTime),
      now: () => ctx.currentTime,
      extraControls: (row) => {
        const label = document.createElement("span");
        label.className = "im-label";
        label.textContent = "Measure";
        row.appendChild(label);
        [5, 15].forEach((len) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "im-btn" + (len === stepCount ? " im-btn-on" : "");
          btn.textContent = len + " steps";
          btn.addEventListener("click", () => switchLength(len));
          lengthButtons[len] = btn;
          row.appendChild(btn);
        });
      },
    });
  }

  function switchLength(newLength) {
    if (newLength === stepCount || !container) return;
    if (seq) {
      seq.stop();
      seq.unmount();
    }
    stepCount = newLength;
    lengthButtons = {};
    seq = buildSeq();
    seq.mount(container, "im-drum-kit");
    if (isPlaying) seq.start();
  }

  return {
    manifest,
    mount(el) {
      container = el;
      seq = buildSeq();
      seq.mount(el, "im-drum-kit");
    },
    unmount() {
      if (seq) seq.unmount();
      container = null;
      seq = null;
    },
    start() {
      isPlaying = true;
      seq?.start();
    },
    stop() {
      isPlaying = false;
      seq?.stop();
    },
    getAudioOutput() { return output.output; },
    setEffectAmount(kind, amount) { if (output[kind]) output[kind].setAmount(amount); },
    serialize() {
      return { stepCount, ...(seq ? seq.serialize() : {}) };
    },
    restore(state) {
      if (!state) return;
      if (state.stepCount && state.stepCount !== stepCount && container) {
        if (seq) {
          seq.stop();
          seq.unmount();
        }
        stepCount = state.stepCount;
        lengthButtons = {};
        seq = buildSeq();
        seq.mount(container, "im-drum-kit");
        if (isPlaying) seq.start();
      }
      seq?.restore(state);
    },
    dispose() {
      this.stop();
      this.unmount();
      try { output.output.disconnect(); } catch (e) {}
    },
  };
}
