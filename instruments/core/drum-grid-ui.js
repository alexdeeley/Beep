import { subscribe as transportSubscribe, getCurrentStep, isRunning as transportRunning } from "./transport.js";

// Shared engine for every multi-voice, 16-step, pads-plus-grid drum
// machine. One implementation of the grid/pad UI and transport wiring;
// each kit only brings its own voice list and synthesis. `trigger(voiceId,
// time)` is called once per active step per voice, and once per pad tap.
export function createDrumSequencer({ voices, steps = 16, defaultPattern, trigger, now, extraControls }) {
  let pattern = defaultPattern ? defaultPattern() : Object.fromEntries(voices.map((v) => [v.id, new Array(steps).fill(false)]));
  let container = null;
  let els = {};
  let unsubTransport = null;
  let rafId = null;
  let lastPaintedStep = -1;

  function triggerVoice(id, time) {
    trigger(id, time);
    flashPad(id);
  }

  function flashPad(id) {
    const pad = els.pads && els.pads[id];
    if (!pad) return;
    pad.classList.remove("im-flash");
    void pad.offsetWidth;
    pad.classList.add("im-flash");
  }

  function onTransportStep({ step, time }) {
    for (const v of voices) {
      if (pattern[v.id][step]) triggerVoice(v.id, time);
    }
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

  function buildUI(rootClass) {
    container.innerHTML = "";
    container.classList.add(rootClass);

    const padsRow = document.createElement("div");
    padsRow.className = "im-pads";
    els.pads = {};
    for (const v of voices) {
      const pad = document.createElement("button");
      pad.className = "im-pad";
      pad.textContent = v.label;
      pad.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        triggerVoice(v.id, now ? now() : undefined);
      });
      pad.addEventListener("animationend", () => pad.classList.remove("im-flash"));
      els.pads[v.id] = pad;
      padsRow.appendChild(pad);
    }
    container.appendChild(padsRow);

    const grid = document.createElement("div");
    grid.className = "im-grid";
    for (const v of voices) {
      const row = document.createElement("div");
      row.className = "im-row";
      const label = document.createElement("div");
      label.className = "im-row-label";
      label.textContent = v.label;
      row.appendChild(label);
      const stepsWrap = document.createElement("div");
      stepsWrap.className = "im-steps";
      for (let s = 0; s < steps; s++) {
        const cell = document.createElement("button");
        cell.className = "im-step" + (pattern[v.id][s] ? " im-step-on" : "") + (s % 4 === 0 ? " im-step-beat" : "");
        cell.dataset.step = String(s);
        cell.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          pattern[v.id][s] = !pattern[v.id][s];
          cell.classList.toggle("im-step-on", pattern[v.id][s]);
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
      pattern = Object.fromEntries(voices.map((v) => [v.id, new Array(steps).fill(false)]));
      refreshGridUI();
    });
    controls.appendChild(clearBtn);
    if (extraControls) extraControls(controls);
    container.appendChild(controls);
  }

  function refreshGridUI() {
    if (!container) return;
    const rows = container.querySelectorAll(".im-row");
    rows.forEach((row, i) => {
      const v = voices[i];
      row.querySelectorAll(".im-step").forEach((cell) => {
        const s = Number(cell.dataset.step);
        cell.classList.toggle("im-step-on", pattern[v.id][s]);
      });
    });
  }

  return {
    mount(el, rootClass) {
      container = el;
      buildUI(rootClass || "im-drum-kit");
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
    serialize() {
      return { pattern };
    },
    restore(state) {
      if (!state?.pattern) return;
      pattern = state.pattern;
      refreshGridUI();
    },
  };
}
