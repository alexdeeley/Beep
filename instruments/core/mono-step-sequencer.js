import { subscribe as transportSubscribe, getCurrentStep, isRunning as transportRunning } from "./transport.js";

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Shared pitch math for every engine built on this sequencer: `baseMidi`
// picks the octave-0 anchor (45 = A2, a reasonable low bass anchor; pass a
// higher anchor for lead/keys-register instruments).
export function noteToFreq(note, octave, baseMidi = 45, tuningSemis = 0) {
  const midi = baseMidi + note + octave * 12 + tuningSemis;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Shared engine for every monophonic, note/octave/accent/slide, 16-step
// instrument (most of the bass/synth modules). One implementation of the
// step grid, the step editor, and the transport/glide wiring, so each
// instrument only has to bring its own synthesis engine and default
// pattern - not another copy of this UI. Percussive/one-shot engines are
// welcome too: they just treat `glideIn` as a no-op, which is the honest
// behavior for a voice that's already decaying by the time the next note
// would glide into it.
export function createMonoStepSequencer({ steps = 16, defaultPattern, trigger, extraControls, onBarComplete }) {
  let pattern = defaultPattern ? defaultPattern() : Array.from({ length: steps }, () => ({ active: false, note: 0, octave: 0, accent: false, slide: false }));
  let container = null;
  let unsubTransport = null;
  let rafId = null;
  let lastPaintedStep = -1;
  let pendingGlideIn = false;
  let selectedStep = 0;

  function onTransportStep({ step, time }) {
    if (step === 0 && onBarComplete) {
      onBarComplete(pattern);
      refreshStepsUI();
    }
    const s = pattern[step];
    if (!s.active) {
      pendingGlideIn = false;
      return;
    }
    trigger(time, { note: s.note, octave: s.octave, accent: s.accent, glideIn: pendingGlideIn });
    pendingGlideIn = s.slide;
  }

  function stepLabel(s) {
    if (!s.active) return "·";
    return NOTE_NAMES[s.note] + (s.octave !== 0 ? (s.octave > 0 ? "+" + s.octave : s.octave) : "");
  }

  function paintStep() {
    if (container) {
      const step = transportRunning() ? getCurrentStep() : -1;
      if (step !== lastPaintedStep) {
        container.querySelectorAll(".im-step-mono").forEach((c) => c.classList.toggle("im-step-current", Number(c.dataset.step) === step));
        lastPaintedStep = step;
      }
    }
    rafId = requestAnimationFrame(paintStep);
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
    container.querySelectorAll(".im-step-mono").forEach((cell) => renderStepCell(cell, Number(cell.dataset.step)));
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
    noteDown.addEventListener("click", () => {
      step.note = (step.note + 11) % 12;
      afterEdit();
    });
    const noteLabel = document.createElement("span");
    noteLabel.className = "im-label";
    noteLabel.textContent = NOTE_NAMES[step.note];
    const noteUp = document.createElement("button");
    noteUp.className = "im-btn";
    noteUp.textContent = "Note ›";
    noteUp.addEventListener("click", () => {
      step.note = (step.note + 1) % 12;
      afterEdit();
    });
    row1.appendChild(noteDown);
    row1.appendChild(noteLabel);
    row1.appendChild(noteUp);
    editor.appendChild(row1);

    const row2 = document.createElement("div");
    row2.className = "im-controls-row";
    const octDown = document.createElement("button");
    octDown.className = "im-btn";
    octDown.textContent = "‹ Oct";
    octDown.addEventListener("click", () => {
      step.octave = Math.max(-1, step.octave - 1);
      afterEdit();
    });
    const octLabel = document.createElement("span");
    octLabel.className = "im-label";
    octLabel.textContent = "Oct " + (step.octave >= 0 ? "+" + step.octave : step.octave);
    const octUp = document.createElement("button");
    octUp.className = "im-btn";
    octUp.textContent = "Oct ›";
    octUp.addEventListener("click", () => {
      step.octave = Math.min(2, step.octave + 1);
      afterEdit();
    });
    row2.appendChild(octDown);
    row2.appendChild(octLabel);
    row2.appendChild(octUp);
    editor.appendChild(row2);

    const row3 = document.createElement("div");
    row3.className = "im-controls-row";
    const accentBtn = document.createElement("button");
    accentBtn.className = "im-btn" + (step.accent ? " im-btn-on" : "");
    accentBtn.textContent = "Accent";
    accentBtn.addEventListener("click", () => {
      step.accent = !step.accent;
      afterEdit();
    });
    const slideBtn = document.createElement("button");
    slideBtn.className = "im-btn" + (step.slide ? " im-btn-on" : "");
    slideBtn.textContent = "Slide";
    slideBtn.addEventListener("click", () => {
      step.slide = !step.slide;
      afterEdit();
    });
    row3.appendChild(accentBtn);
    row3.appendChild(slideBtn);
    editor.appendChild(row3);
  }

  function afterEdit() {
    refreshStepsUI();
    renderEditor();
  }

  function buildUI(rootClass) {
    container.innerHTML = "";
    container.classList.add(rootClass);

    const stepsWrap = document.createElement("div");
    stepsWrap.className = "im-steps im-steps-mono";
    for (let s = 0; s < steps; s++) {
      const cell = document.createElement("button");
      cell.className = "im-step im-step-mono" + (s % 4 === 0 ? " im-step-beat" : "");
      cell.dataset.step = String(s);
      renderStepCell(cell, s);
      cell.addEventListener("click", () => {
        selectedStep = s;
        renderEditor();
        container.querySelectorAll(".im-step-mono").forEach((c) => c.classList.toggle("im-step-selected", Number(c.dataset.step) === s));
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
    if (extraControls) extraControls(controls);
    container.appendChild(controls);

    renderEditor();
  }

  return {
    mount(el, rootClass) {
      container = el;
      buildUI(rootClass || "im-mono-synth");
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
    serialize() {
      return { pattern };
    },
    restore(state) {
      if (!state?.pattern) return;
      pattern = state.pattern;
      refreshStepsUI();
      renderEditor();
    },
  };
}
