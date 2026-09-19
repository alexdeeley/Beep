import { createEffectsChain } from "../../core/effects.js";
import { subscribe as transportSubscribe, getCurrentStep, isRunning as transportRunning } from "../../core/transport.js";

export const manifest = {
  id: "acid-303",
  name: "Acid 303",
  shortName: "303",
  description: "A no-frills acid bass line sequencer: sixteen steps, real accent, real slide, nothing else.",
  category: "Bass",
  tags: ["bass", "synth", "acid", "303", "sequencer", "monophonic"],
  version: "1.0.0",
  icon: "\u{1F70A}",
  supportsSequencer: true,
  supportsLivePlay: false,
  supportsEffects: false,
  supportsTempo: true,
  polyphony: 1,
  defaultWidth: 380,
  defaultHeight: 460,
  minimumWidth: 260,
  minimumHeight: 320,
};

const STEPS = 16;
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const PORTAMENTO_TIME = 0.07;

function defaultPattern() {
  // A simple, plausible acid line: root-heavy with one octave jump and one
  // slide, not silence and not a wall of notes.
  const steps = Array.from({ length: STEPS }, () => ({ active: false, note: 0, octave: 0, accent: false, slide: false }));
  const on = (i, note, octave, accent, slide) => {
    steps[i] = { active: true, note, octave, accent: !!accent, slide: !!slide };
  };
  on(0, 0, 0, true, false);
  on(2, 0, 0, false, true);
  on(3, 0, 0, false, false);
  on(6, 3, 0, false, false);
  on(8, 0, 0, true, false);
  on(11, 7, 0, false, false);
  on(12, 0, 1, true, false);
  on(14, 0, 0, false, false);
  return steps;
}

function defaultSynthParams() {
  return { waveform: "sawtooth", cutoff: 500, resonance: 9, envMod: 0.55, decay: 0.22, accentAmount: 0.5, tuning: 0 };
}

function noteToFreq(note, octave, tuningSemis) {
  // MIDI 45 = A2, a reasonable low anchor for an acid bass line.
  const midi = 45 + note + octave * 12 + tuningSemis;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ---------- monophonic acid engine ----------
// One oscillator, one filter, one amp envelope, all persistent - never
// recreated per note. That's what makes slide a real thing: a "slide"
// note only ramps osc.frequency (and the filter) into the new pitch, it
// never stops/restarts the oscillator or retriggers the amp envelope.
function createAcidEngine(ctx, dest) {
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = 110;

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 500;
  filter.Q.value = 9;

  const ampEnv = ctx.createGain();
  ampEnv.gain.value = 0;

  osc.connect(filter);
  filter.connect(ampEnv);
  ampEnv.connect(dest);
  osc.start();

  let params = defaultSynthParams();

  function setParam(key, value) {
    params[key] = value;
    if (key === "waveform") osc.type = value;
    if (key === "resonance") filter.Q.setTargetAtTime(value, ctx.currentTime, 0.01);
  }

  function trigger(time, { note, octave, accent, glideIn }) {
    const freq = noteToFreq(note, octave, params.tuning);
    osc.frequency.cancelScheduledValues(time);
    if (glideIn) {
      osc.frequency.setValueAtTime(osc.frequency.value, time);
      osc.frequency.linearRampToValueAtTime(freq, time + PORTAMENTO_TIME);
    } else {
      osc.frequency.setValueAtTime(freq, time);
    }

    const decayTime = Math.max(0.05, params.decay) * (accent ? 0.75 : 1);
    const envAmount = params.envMod * (accent ? 1 + params.accentAmount : 1) * 4500;
    const peakCutoff = Math.min(9500, params.cutoff + envAmount);

    filter.frequency.cancelScheduledValues(time);
    filter.frequency.setValueAtTime(Math.max(80, params.cutoff), time);
    filter.frequency.linearRampToValueAtTime(peakCutoff, time + 0.01);
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, params.cutoff * 0.9), time + decayTime);

    ampEnv.gain.cancelScheduledValues(time);
    if (glideIn) {
      // Legato: don't retrigger from silence, just carry the amplitude
      // through into this note's own decay - the pitch move is the only
      // thing that happens at the boundary.
      const holdLevel = Math.max(ampEnv.gain.value, accent ? 0.9 : 0.65);
      ampEnv.gain.setValueAtTime(holdLevel, time);
      ampEnv.gain.exponentialRampToValueAtTime(0.0001, time + decayTime * 1.4);
    } else {
      const peakGain = accent ? 0.95 : 0.7;
      ampEnv.gain.setValueAtTime(0.0001, time);
      ampEnv.gain.exponentialRampToValueAtTime(peakGain, time + 0.004);
      ampEnv.gain.exponentialRampToValueAtTime(0.0001, time + decayTime * 1.4);
    }
  }

  function dispose() {
    try {
      osc.stop();
      osc.disconnect();
      filter.disconnect();
      ampEnv.disconnect();
    } catch (e) {}
  }

  return { trigger, setParam, getParams: () => ({ ...params }), setAllParams: (p) => { params = { ...params, ...p }; osc.type = params.waveform; filter.Q.value = params.resonance; }, dispose };
}

// ---------- instrument instance ----------
export function create(ctx) {
  const output = createEffectsChain(ctx);
  const engine = createAcidEngine(ctx, output.input);

  let pattern = defaultPattern();
  let container = null;
  let unsubTransport = null;
  let rafId = null;
  let lastPaintedStep = -1;
  let pendingGlideIn = false;
  let selectedStep = 0;

  function onTransportStep({ step, time }) {
    const s = pattern[step];
    if (!s.active) {
      pendingGlideIn = false;
      return;
    }
    engine.trigger(time, { note: s.note, octave: s.octave, accent: s.accent, glideIn: pendingGlideIn });
    pendingGlideIn = s.slide;
    flashStepAudio(step);
  }

  function flashStepAudio() {
    // visual confirmation handled by the rAF step painter below; kept as a
    // named hook in case a future instrument wants a distinct "hit" flash.
  }

  function paintStep() {
    if (container) {
      const step = transportRunning() ? getCurrentStep() : -1;
      if (step !== lastPaintedStep) {
        container.querySelectorAll(".im-step").forEach((c) => c.classList.toggle("im-step-current", Number(c.dataset.step) === step));
        lastPaintedStep = step;
      }
    }
    rafId = requestAnimationFrame(paintStep);
  }

  function stepLabel(s) {
    if (!s.active) return "·";
    return NOTE_NAMES[s.note] + (s.octave !== 0 ? (s.octave > 0 ? "+" + s.octave : s.octave) : "");
  }

  function buildUI() {
    container.innerHTML = "";
    container.classList.add("im-acid303");

    // step sequencer
    const stepsWrap = document.createElement("div");
    stepsWrap.className = "im-steps im-steps-303";
    for (let s = 0; s < STEPS; s++) {
      const cell = document.createElement("button");
      cell.className = "im-step im-step-303" + (s % 4 === 0 ? " im-step-beat" : "");
      cell.dataset.step = String(s);
      renderStepCell(cell, s);
      cell.addEventListener("click", () => {
        selectedStep = s;
        renderEditor();
        container.querySelectorAll(".im-step-303").forEach((c) => c.classList.toggle("im-step-selected", Number(c.dataset.step) === s));
      });
      stepsWrap.appendChild(cell);
    }
    container.appendChild(stepsWrap);

    const editor = document.createElement("div");
    editor.className = "im-step-editor";
    container.appendChild(editor);

    const controls = document.createElement("div");
    controls.className = "im-controls-row";
    const clearBtn = document.createElement("button");
    clearBtn.className = "im-btn";
    clearBtn.textContent = "Clear";
    clearBtn.addEventListener("click", () => {
      pattern = pattern.map(() => ({ active: false, note: 0, octave: 0, accent: false, slide: false }));
      refreshStepsUI();
      renderEditor();
    });
    controls.appendChild(clearBtn);
    container.appendChild(controls);

    renderEditor();
  }

  function renderStepCell(cell, s) {
    const step = pattern[s];
    cell.textContent = stepLabel(step);
    cell.classList.toggle("im-step-on", step.active);
    cell.classList.toggle("im-step-accent", step.active && step.accent);
    cell.classList.toggle("im-step-slide", step.active && step.slide);
    cell.classList.toggle("im-step-selected", s === selectedStep);
  }

  function refreshStepsUI() {
    if (!container) return;
    container.querySelectorAll(".im-step-303").forEach((cell) => renderStepCell(cell, Number(cell.dataset.step)));
  }

  function renderEditor() {
    if (!container) return;
    const editor = container.querySelector(".im-step-editor");
    if (!editor) return;
    const step = pattern[selectedStep];
    editor.innerHTML = "";

    const title = document.createElement("div");
    title.className = "im-label";
    title.textContent = "Step " + (selectedStep + 1);
    editor.appendChild(title);

    const row1 = document.createElement("div");
    row1.className = "im-controls-row";
    const activeBtn = document.createElement("button");
    activeBtn.className = "im-btn" + (step.active ? " im-btn-on" : "");
    activeBtn.textContent = step.active ? "Active" : "Rest";
    activeBtn.addEventListener("click", () => {
      step.active = !step.active;
      afterEdit();
    });
    row1.appendChild(activeBtn);

    const noteDown = document.createElement("button");
    noteDown.className = "im-btn";
    noteDown.textContent = "‹ Note";
    noteDown.addEventListener("click", () => { step.note = (step.note + 11) % 12; afterEdit(); });
    const noteLabel = document.createElement("span");
    noteLabel.className = "im-label";
    noteLabel.textContent = NOTE_NAMES[step.note];
    const noteUp = document.createElement("button");
    noteUp.className = "im-btn";
    noteUp.textContent = "Note ›";
    noteUp.addEventListener("click", () => { step.note = (step.note + 1) % 12; afterEdit(); });
    row1.appendChild(noteDown);
    row1.appendChild(noteLabel);
    row1.appendChild(noteUp);
    editor.appendChild(row1);

    const row2 = document.createElement("div");
    row2.className = "im-controls-row";
    const octDown = document.createElement("button");
    octDown.className = "im-btn";
    octDown.textContent = "‹ Oct";
    octDown.addEventListener("click", () => { step.octave = Math.max(-1, step.octave - 1); afterEdit(); });
    const octLabel = document.createElement("span");
    octLabel.className = "im-label";
    octLabel.textContent = "Oct " + (step.octave >= 0 ? "+" + step.octave : step.octave);
    const octUp = document.createElement("button");
    octUp.className = "im-btn";
    octUp.textContent = "Oct ›";
    octUp.addEventListener("click", () => { step.octave = Math.min(2, step.octave + 1); afterEdit(); });
    row2.appendChild(octDown);
    row2.appendChild(octLabel);
    row2.appendChild(octUp);
    editor.appendChild(row2);

    const row3 = document.createElement("div");
    row3.className = "im-controls-row";
    const accentBtn = document.createElement("button");
    accentBtn.className = "im-btn" + (step.accent ? " im-btn-on" : "");
    accentBtn.textContent = "Accent";
    accentBtn.addEventListener("click", () => { step.accent = !step.accent; afterEdit(); });
    const slideBtn = document.createElement("button");
    slideBtn.className = "im-btn" + (step.slide ? " im-btn-on" : "");
    slideBtn.textContent = "Slide";
    slideBtn.addEventListener("click", () => { step.slide = !step.slide; afterEdit(); });
    row3.appendChild(accentBtn);
    row3.appendChild(slideBtn);
    editor.appendChild(row3);
  }

  function afterEdit() {
    refreshStepsUI();
    renderEditor();
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
    },
    start() {
      if (unsubTransport) return;
      pendingGlideIn = false;
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
      return { pattern, synthParams: engine.getParams() };
    },
    restore(state) {
      if (!state) return;
      if (state.pattern) pattern = state.pattern;
      if (state.synthParams) engine.setAllParams(state.synthParams);
      refreshStepsUI();
      renderEditor();
    },
    dispose() {
      this.stop();
      this.unmount();
      engine.dispose();
      try {
        output.output.disconnect();
      } catch (e) {}
    },
  };
}
