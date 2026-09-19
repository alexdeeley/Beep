import { subscribe as transportSubscribe, isRunning as transportRunning } from "./transport.js";

// N independent loops of different step lengths (5, 7, 11...) ticked by the
// shared 16th-note clock but wrapping on their own period, so the combined
// texture keeps recombining before it repeats (Motor's mechanical layers,
// Phase Garden's melodic loops). A cell's value is a fire probability
// (0 = off, 1 = always) rather than a plain boolean, so a layer can be
// "mostly on" without being rigid.
export function createPolyrhythmLoops({ layers, trigger, defaultPatterns, cellLabel, extraControls }) {
  let patterns = defaultPatterns ? defaultPatterns() : Object.fromEntries(layers.map((l) => [l.id, new Array(l.length).fill(0)]));
  const counters = Object.fromEntries(layers.map((l) => [l.id, 0]));
  const lastFiredIndex = Object.fromEntries(layers.map((l) => [l.id, -1]));
  let container = null;
  let unsubTransport = null;
  let rafId = null;

  const PROB_LEVELS = [0, 0.5, 0.85, 1];

  function onTransportStep({ time }) {
    for (const l of layers) {
      const idx = counters[l.id];
      const prob = patterns[l.id][idx];
      if (prob > 0 && Math.random() < prob) {
        trigger(l.id, idx, time);
        lastFiredIndex[l.id] = idx;
      }
      counters[l.id] = (idx + 1) % l.length;
    }
  }

  function paint() {
    if (container) {
      for (const l of layers) {
        const row = container.querySelector(`[data-layer="${l.id}"]`);
        if (row) {
          row.querySelectorAll(".im-poly-cell").forEach((cell) => {
            cell.classList.toggle("im-step-current", transportRunning() && Number(cell.dataset.idx) === counters[l.id]);
          });
        }
      }
    }
    rafId = requestAnimationFrame(paint);
  }

  function cycleCell(layerId, idx) {
    const arr = patterns[layerId];
    const current = arr[idx] || 0;
    const levelIdx = PROB_LEVELS.findIndex((v) => Math.abs(v - current) < 0.001);
    const next = PROB_LEVELS[(Math.max(0, levelIdx) + 1) % PROB_LEVELS.length];
    arr[idx] = next;
  }

  function renderCell(cell, layerId, idx) {
    const prob = patterns[layerId][idx] || 0;
    cell.classList.toggle("im-step-on", prob >= 0.999);
    cell.classList.toggle("im-poly-partial", prob > 0 && prob < 0.999);
    cell.textContent = cellLabel ? cellLabel(prob) : "";
  }

  function buildUI(rootClass) {
    container.innerHTML = "";
    container.classList.add(rootClass);

    for (const l of layers) {
      const row = document.createElement("div");
      row.className = "im-row im-poly-row";
      row.dataset.layer = l.id;
      const label = document.createElement("div");
      label.className = "im-row-label";
      label.textContent = l.label + " · " + l.length;
      row.appendChild(label);
      const cellsWrap = document.createElement("div");
      cellsWrap.className = "im-poly-cells";
      cellsWrap.style.gridTemplateColumns = `repeat(${l.length}, 1fr)`;
      for (let i = 0; i < l.length; i++) {
        const cell = document.createElement("button");
        cell.className = "im-step im-poly-cell";
        cell.dataset.idx = String(i);
        renderCell(cell, l.id, i);
        cell.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          cycleCell(l.id, i);
          renderCell(cell, l.id, i);
        });
        cellsWrap.appendChild(cell);
      }
      row.appendChild(cellsWrap);
      container.appendChild(row);
    }

    const controls = document.createElement("div");
    controls.className = "im-controls-row";
    const clearBtn = document.createElement("button");
    clearBtn.className = "im-btn";
    clearBtn.textContent = "Clear";
    clearBtn.addEventListener("click", () => {
      patterns = Object.fromEntries(layers.map((l) => [l.id, new Array(l.length).fill(0)]));
      refreshUI();
    });
    controls.appendChild(clearBtn);
    if (extraControls) extraControls(controls);
    container.appendChild(controls);
  }

  function refreshUI() {
    if (!container) return;
    for (const l of layers) {
      const row = container.querySelector(`[data-layer="${l.id}"]`);
      if (!row) continue;
      row.querySelectorAll(".im-poly-cell").forEach((cell) => renderCell(cell, l.id, Number(cell.dataset.idx)));
    }
  }

  return {
    mount(el, rootClass) {
      container = el;
      buildUI(rootClass || "im-polyrhythm");
      rafId = requestAnimationFrame(paint);
    },
    unmount() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      if (container) container.innerHTML = "";
      container = null;
    },
    start() {
      if (unsubTransport) return;
      for (const l of layers) counters[l.id] = 0;
      unsubTransport = transportSubscribe(onTransportStep);
    },
    stop() {
      if (unsubTransport) {
        unsubTransport();
        unsubTransport = null;
      }
    },
    serialize() {
      return { patterns };
    },
    restore(state) {
      if (!state?.patterns) return;
      patterns = state.patterns;
      refreshUI();
    },
  };
}
