import { createEffectsChain } from "../../core/effects.js";
import { subscribe as transportSubscribe, getCurrentStep, isRunning as transportRunning } from "../../core/transport.js";

export const manifest = {
  id: "drum-machine",
  name: "Drum Machine",
  shortName: "Drums",
  description: "A no-frills 808-style sequencer: four synthesized voices, sixteen steps, nothing else.",
  category: "Drums",
  tags: ["drums", "sequencer", "rhythm", "808", "synthesized"],
  version: "1.0.0",
  icon: "\u{1F941}",
  supportsSequencer: true,
  supportsLivePlay: true,
  supportsEffects: false,
  supportsTempo: true,
  polyphony: 4,
  defaultWidth: 380,
  defaultHeight: 420,
  minimumWidth: 260,
  minimumHeight: 300,
};

const VOICES = ["kick", "snare", "closedHat", "openHat"];
const VOICE_LABEL = { kick: "KICK", snare: "SNARE", closedHat: "CH", openHat: "OH" };
const STEPS = 16;

function defaultPattern() {
  // A plausible seed pattern, not silence and not noise: four-on-the-floor
  // kick, backbeat snare, straight closed hats, one open-hat accent.
  const p = { kick: new Array(STEPS).fill(false), snare: new Array(STEPS).fill(false), closedHat: new Array(STEPS).fill(false), openHat: new Array(STEPS).fill(false) };
  [0, 4, 8, 12].forEach((i) => (p.kick[i] = true));
  [4, 12].forEach((i) => (p.snare[i] = true));
  for (let i = 0; i < STEPS; i += 2) p.closedHat[i] = true;
  p.openHat[14] = true;
  return p;
}

function defaultVoiceParams() {
  return {
    kick: { tune: 0, decay: 0.32, punch: 0.55 },
    snare: { tune: 0, snap: 0.5, decay: 0.18 },
    closedHat: { tone: 0.5, decay: 0.06 },
    openHat: { tone: 0.5, decay: 0.35 },
  };
}

function makeNoiseBuffer(ctx) {
  const dur = 1.0;
  const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

// ---------- synthesis ----------
// All four voices are built from oscillators/noise + envelopes - no
// samples, per spec. Each is tuned by ear for a specific character rather
// than left as a single flat beep.
function createVoiceEngine(ctx, dest) {
  const noiseBuffer = makeNoiseBuffer(ctx);
  let activeOpenHatEnv = null; // for closed-hat choke

  function playKick(time, { tune = 0, decay = 0.32, punch = 0.55 } = {}) {
    const startFreq = 150 * Math.pow(2, tune / 12);
    const endFreq = Math.max(30, 42 * Math.pow(2, tune / 12));
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(startFreq, time);
    osc.frequency.exponentialRampToValueAtTime(endFreq, time + 0.085);

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(1, time + 0.003);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + Math.max(0.08, decay));

    osc.connect(amp);
    amp.connect(dest);
    osc.start(time);
    osc.stop(time + decay + 0.1);

    if (punch > 0) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 900;
      const clickGain = ctx.createGain();
      clickGain.gain.setValueAtTime(punch * 0.4, time);
      clickGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.018);
      src.connect(hp);
      hp.connect(clickGain);
      clickGain.connect(dest);
      src.start(time);
      src.stop(time + 0.03);
    }
  }

  function playSnare(time, { tune = 0, snap = 0.5, decay = 0.18 } = {}) {
    const bodyFreq = 190 * Math.pow(2, tune / 12);
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.55, time);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, time + Math.max(0.08, decay * 0.55));
    [1, 1.6].forEach((mult) => {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = bodyFreq * mult;
      osc.connect(bodyGain);
      osc.start(time);
      osc.stop(time + decay + 0.08);
    });
    bodyGain.connect(dest);

    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1600 + snap * 2200;
    bp.Q.value = 0.8;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.35 + snap * 0.5, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + Math.max(0.06, decay));
    src.connect(bp);
    bp.connect(noiseGain);
    noiseGain.connect(dest);
    src.start(time);
    src.stop(time + decay + 0.08);
  }

  // Classic 808-style metallic hat: six square oscillators at inharmonic
  // ratios, summed through band/high-pass filtering. Closed and open hats
  // share this same timbre generator; only the envelope length differs -
  // and a closed-hat hit always chokes whatever open-hat envelope is
  // still ringing, same as a real hi-hat's two cymbals physically touching.
  const HAT_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21];
  function playHat(time, { tone = 0.5, decay = 0.06 } = {}, isOpen) {
    if (!isOpen && activeOpenHatEnv) {
      const env = activeOpenHatEnv;
      env.gain.cancelScheduledValues(time);
      env.gain.setValueAtTime(env.gain.value, time);
      env.gain.exponentialRampToValueAtTime(0.0001, time + 0.035);
      activeOpenHatEnv = null;
    }

    const mix = ctx.createGain();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 9000;
    bp.Q.value = 1;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 3500 + tone * 6500;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.5, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + Math.max(0.03, decay));

    mix.connect(bp);
    bp.connect(hp);
    hp.connect(env);
    env.connect(dest);

    HAT_RATIOS.forEach((r) => {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = 40 * r;
      osc.connect(mix);
      osc.start(time);
      osc.stop(time + decay + 0.08);
    });

    if (isOpen) activeOpenHatEnv = env;
  }

  return {
    kick: (time, params) => playKick(time, params),
    snare: (time, params) => playSnare(time, params),
    closedHat: (time, params) => playHat(time, params, false),
    openHat: (time, params) => playHat(time, params, true),
  };
}

// ---------- instrument instance ----------
export function create(ctx) {
  const output = createEffectsChain(ctx);
  const voices = createVoiceEngine(ctx, output.input);

  let pattern = defaultPattern();
  let voiceParams = defaultVoiceParams();
  let container = null;
  let els = {};
  let unsubTransport = null;
  let rafId = null;
  let lastPaintedStep = -1;

  function triggerVoice(name, time) {
    voices[name](time, voiceParams[name]);
    flashPad(name);
  }

  function flashPad(name) {
    const pad = els.pads && els.pads[name];
    if (!pad) return;
    pad.classList.remove("im-flash");
    // reflow to restart the animation even on rapid re-triggers
    void pad.offsetWidth;
    pad.classList.add("im-flash");
  }

  function onTransportStep({ step, time }) {
    for (const v of VOICES) {
      if (pattern[v][step]) triggerVoice(v, time);
    }
  }

  function paintStep() {
    if (container) {
      const step = transportRunning() ? getCurrentStep() : -1;
      if (step !== lastPaintedStep) {
        const cells = container.querySelectorAll(".im-step");
        cells.forEach((c) => c.classList.toggle("im-step-current", Number(c.dataset.step) === step));
        lastPaintedStep = step;
      }
    }
    rafId = requestAnimationFrame(paintStep);
  }

  function buildUI() {
    container.innerHTML = "";
    container.classList.add("im-drum-machine");

    const padsRow = document.createElement("div");
    padsRow.className = "im-pads";
    els.pads = {};
    for (const v of VOICES) {
      const pad = document.createElement("button");
      pad.className = "im-pad";
      pad.textContent = VOICE_LABEL[v];
      pad.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        triggerVoice(v, ctx.currentTime);
      });
      pad.addEventListener("animationend", () => pad.classList.remove("im-flash"));
      els.pads[v] = pad;
      padsRow.appendChild(pad);
    }
    container.appendChild(padsRow);

    const grid = document.createElement("div");
    grid.className = "im-grid";
    for (const v of VOICES) {
      const row = document.createElement("div");
      row.className = "im-row";
      const label = document.createElement("div");
      label.className = "im-row-label";
      label.textContent = VOICE_LABEL[v];
      row.appendChild(label);
      const stepsWrap = document.createElement("div");
      stepsWrap.className = "im-steps";
      for (let s = 0; s < STEPS; s++) {
        const cell = document.createElement("button");
        cell.className = "im-step" + (pattern[v][s] ? " im-step-on" : "") + (s % 4 === 0 ? " im-step-beat" : "");
        cell.dataset.step = String(s);
        cell.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          pattern[v][s] = !pattern[v][s];
          cell.classList.toggle("im-step-on", pattern[v][s]);
        });
        stepsWrap.appendChild(cell);
      }
      row.appendChild(stepsWrap);
      grid.appendChild(row);
    }
    container.appendChild(grid);

    const controls = document.createElement("div");
    controls.className = "im-controls-row";
    const clearBtn = document.createElement("button");
    clearBtn.className = "im-btn";
    clearBtn.textContent = "Clear";
    clearBtn.addEventListener("click", () => {
      pattern = { kick: new Array(STEPS).fill(false), snare: new Array(STEPS).fill(false), closedHat: new Array(STEPS).fill(false), openHat: new Array(STEPS).fill(false) };
      refreshGridUI();
    });
    controls.appendChild(clearBtn);
    container.appendChild(controls);
  }

  function refreshGridUI() {
    if (!container) return;
    const rows = container.querySelectorAll(".im-row");
    rows.forEach((row, i) => {
      const v = VOICES[i];
      row.querySelectorAll(".im-step").forEach((cell) => {
        const s = Number(cell.dataset.step);
        cell.classList.toggle("im-step-on", pattern[v][s]);
      });
    });
  }

  return {
    manifest,
    mount(el) {
      container = el;
      buildUI();
      rafId = requestAnimationFrame(paintStep);
    },
    unmount() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      if (container) container.innerHTML = "";
      container = null;
      els = {};
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
    getAudioOutput() {
      return output.output;
    },
    setEffectAmount(kind, amount) {
      if (output[kind]) output[kind].setAmount(amount);
    },
    serialize() {
      return { pattern, voiceParams };
    },
    restore(state) {
      if (!state) return;
      if (state.pattern) pattern = state.pattern;
      if (state.voiceParams) voiceParams = state.voiceParams;
      refreshGridUI();
    },
    dispose() {
      this.stop();
      this.unmount();
      try {
        output.output.disconnect();
      } catch (e) {}
    },
  };
}
