import { ensureStarted } from "../core/audio-engine.js";
import { start as transportStart, stop as transportStop, isRunning, getBpm, setBpm, tapTempo, getCurrentStep } from "../core/transport.js";
import { LAYOUTS } from "./layout-manager.js";

const LAYOUT_LABELS = { split: "Split", grid: "Grid", performance: "Performance", freeform: "Freeform" };

// The compact header bar: Library/Add, Play/Stop, BPM, Tap Tempo, layout
// picker, and a step-position readout. Deliberately small - the
// instruments themselves are the visual stars of the workspace, not this
// chrome. The step readout polls the transport via requestAnimationFrame
// rather than being driven by the audio clock itself, keeping render
// timing separate from audio timing as the shared clock requires.
export function createTransportBar({ onAdd, onLayoutChange, onPlayStateChange, initialLayout = "freeform", showAdd = true, showLayouts = true }) {
  const el = document.createElement("div");
  el.className = "im-transport-bar";

  if (showAdd) {
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "im-btn im-transport-add";
    addBtn.textContent = "+ Add";
    addBtn.addEventListener("click", () => onAdd?.());
    el.appendChild(addBtn);
  }

  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "im-btn im-transport-play";
  playBtn.textContent = "▶ Play";
  playBtn.addEventListener("click", async () => {
    await ensureStarted();
    if (isRunning()) {
      transportStop();
    } else {
      transportStart();
    }
    syncPlayButton();
    onPlayStateChange?.(isRunning());
  });
  el.appendChild(playBtn);

  const bpmWrap = document.createElement("div");
  bpmWrap.className = "im-transport-bpm";
  const bpmLabel = document.createElement("span");
  bpmLabel.className = "im-label";
  bpmLabel.textContent = "BPM";
  const bpmInput = document.createElement("input");
  bpmInput.type = "number";
  bpmInput.min = "40";
  bpmInput.max = "240";
  bpmInput.value = String(Math.round(getBpm()));
  bpmInput.className = "im-transport-bpm-input";
  bpmInput.addEventListener("change", () => {
    const next = setBpm(Number(bpmInput.value));
    bpmInput.value = String(Math.round(next));
  });
  bpmWrap.appendChild(bpmLabel);
  bpmWrap.appendChild(bpmInput);
  el.appendChild(bpmWrap);

  const tapBtn = document.createElement("button");
  tapBtn.type = "button";
  tapBtn.className = "im-btn im-transport-tap";
  tapBtn.textContent = "Tap";
  tapBtn.addEventListener("click", () => {
    const next = tapTempo();
    if (next) bpmInput.value = String(Math.round(next));
  });
  el.appendChild(tapBtn);

  let currentLayout = initialLayout;
  const layoutButtons = {};
  if (showLayouts) {
    const layoutWrap = document.createElement("div");
    layoutWrap.className = "im-transport-layouts";
    for (const layout of LAYOUTS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "im-btn im-transport-layout-btn" + (layout === currentLayout ? " im-btn-on" : "");
      btn.textContent = LAYOUT_LABELS[layout];
      btn.addEventListener("click", () => {
        currentLayout = layout;
        for (const [key, b] of Object.entries(layoutButtons)) b.classList.toggle("im-btn-on", key === layout);
        onLayoutChange?.(layout);
      });
      layoutButtons[layout] = btn;
      layoutWrap.appendChild(btn);
    }
    el.appendChild(layoutWrap);
  }

  const stepReadout = document.createElement("span");
  stepReadout.className = "im-transport-step";
  el.appendChild(stepReadout);

  function syncPlayButton() {
    playBtn.textContent = isRunning() ? "■ Stop" : "▶ Play";
    playBtn.classList.toggle("im-btn-on", isRunning());
  }

  let rafId = null;
  function paint() {
    if (isRunning()) {
      const step = getCurrentStep();
      stepReadout.textContent = "Step " + (step >= 0 ? step + 1 : "-") + " / 16";
    } else {
      stepReadout.textContent = "";
    }
    rafId = requestAnimationFrame(paint);
  }
  rafId = requestAnimationFrame(paint);

  syncPlayButton();

  return {
    el,
    setLayout(layout) {
      currentLayout = layout;
      for (const [key, b] of Object.entries(layoutButtons)) b.classList.toggle("im-btn-on", key === layout);
    },
    dispose() {
      if (rafId) cancelAnimationFrame(rafId);
    },
  };
}
