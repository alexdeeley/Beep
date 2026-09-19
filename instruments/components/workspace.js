import { getContext, getMasterBus, ensureStarted, isStarted } from "../core/audio-engine.js";
import { createInstance, getManifest } from "../core/registry.js";
import { setBpm, getBpm } from "../core/transport.js";
import { createPanel } from "./instrument-panel.js";
import { createLibraryView } from "./library.js";
import { createTransportBar } from "./transport.js";
import { computeLayoutPositions, clampGeometryToViewport } from "./layout-manager.js";
import { saveWorkspace, loadWorkspace } from "../core/persistence.js";

export const MAX_INSTANCES = 4;

// Wires the transport bar, the stage of draggable/resizable instrument
// panels, and the add-instrument library together into the shared
// workspace. All instrument state, panel geometry, layout mode and BPM
// round-trip through core/persistence.js so a reload restores exactly
// what was there - this is the one place that decides how those pieces
// fit, everything else (panel, library, transport, layout math) stays
// ignorant of the others.
export function createWorkspace(rootEl) {
  const ctx = getContext();
  const masterBus = getMasterBus();

  rootEl.innerHTML = "";
  rootEl.classList.add("im-workspace-root");

  const stage = document.createElement("div");
  stage.className = "im-stage";

  const libraryOverlay = document.createElement("div");
  libraryOverlay.className = "im-library-overlay";
  libraryOverlay.style.display = "none";
  const libraryPanel = document.createElement("div");
  libraryPanel.className = "im-library-modal";
  const libraryHeader = document.createElement("div");
  libraryHeader.className = "im-library-modal-header";
  const libraryTitle = document.createElement("span");
  libraryTitle.textContent = "Add an instrument";
  const libraryClose = document.createElement("button");
  libraryClose.type = "button";
  libraryClose.className = "im-btn";
  libraryClose.textContent = "Close";
  libraryClose.addEventListener("click", closeLibrary);
  libraryHeader.appendChild(libraryTitle);
  libraryHeader.appendChild(libraryClose);
  libraryPanel.appendChild(libraryHeader);
  const libraryView = createLibraryView({ onPick: (manifest) => { addInstrument(manifest.id); closeLibrary(); }, actionLabel: "Add" });
  libraryPanel.appendChild(libraryView.el);
  libraryOverlay.appendChild(libraryPanel);
  libraryOverlay.addEventListener("click", (e) => {
    if (e.target === libraryOverlay) closeLibrary();
  });

  function openLibrary() {
    if (panels.size >= MAX_INSTANCES) {
      alert("The workspace already has 4 instruments - the most it can run at once. Remove one first.");
      return;
    }
    libraryView.refresh();
    libraryOverlay.style.display = "flex";
  }
  function closeLibrary() {
    libraryOverlay.style.display = "none";
  }

  const startOverlay = document.createElement("div");
  startOverlay.className = "im-start-overlay";
  const startBtn = document.createElement("button");
  startBtn.type = "button";
  startBtn.className = "im-btn im-start-btn";
  startBtn.textContent = "Tap to start audio";
  startOverlay.appendChild(startBtn);
  startBtn.addEventListener("click", async () => {
    await ensureStarted();
    startOverlay.style.display = "none";
  });
  if (isStarted()) startOverlay.style.display = "none";

  const panels = new Map();
  let layout = "freeform";
  let zCounter = 1;
  let isPlaying = false;
  let seq = 1;
  let persistTimer = null;

  const saved = loadWorkspace();
  if (saved?.bpm) setBpm(saved.bpm);
  if (saved?.layout) layout = saved.layout;

  const transportBar = createTransportBar({
    onAdd: openLibrary,
    onLayoutChange: (next) => { layout = next; applyLayoutPositions(); schedulePersist(); },
    onPlayStateChange: (playing) => { isPlaying = playing; for (const p of panels.values()) (playing ? p.start() : p.stop()); },
    initialLayout: layout,
  });

  rootEl.appendChild(transportBar.el);
  rootEl.appendChild(stage);
  rootEl.appendChild(libraryOverlay);
  rootEl.appendChild(startOverlay);

  function viewportSize() {
    const rect = stage.getBoundingClientRect();
    return { width: rect.width || 800, height: rect.height || 500 };
  }

  function bringToFront(instanceId) {
    const panel = panels.get(instanceId);
    if (!panel) return;
    zCounter += 1;
    panel.setZIndex(zCounter);
  }

  function updateSoloState() {
    const anySolo = [...panels.values()].some((p) => p.isSolo());
    for (const p of panels.values()) p.setForcedSilent(anySolo && !p.isSolo());
  }

  function applyLayoutPositions() {
    transportBar.setLayout(layout);
    if (layout === "freeform" || panels.size === 0) return;
    const ids = [...panels.keys()];
    const positions = computeLayoutPositions(layout, ids.length, viewportSize());
    ids.forEach((id, i) => panels.get(id).setGeometry(positions[i]));
  }

  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persist, 150);
  }

  function persist() {
    saveWorkspace({
      layout,
      bpm: getBpm(),
      instances: [...panels.values()].map((p) => p.serialize()),
    });
  }

  function addInstrument(instrumentId, savedState) {
    if (panels.size >= MAX_INSTANCES) return null;
    const manifest = getManifest(instrumentId);
    if (!manifest) return null;

    const instance = createInstance(instrumentId, ctx);
    const instanceId = savedState?.instanceId || `${instrumentId}-${Date.now().toString(36)}-${seq++}`;
    const cascade = panels.size % MAX_INSTANCES;

    const panel = createPanel({
      instanceId,
      instrumentId,
      manifest,
      instance,
      ctx,
      masterBus,
      x: savedState?.x ?? 24 + cascade * 32,
      y: savedState?.y ?? 24 + cascade * 32,
      width: savedState?.width ?? manifest.defaultWidth,
      height: savedState?.height ?? manifest.defaultHeight,
      volume: savedState?.volume,
      muted: savedState?.muted,
      solo: savedState?.solo,
      effects: savedState?.effects,
      onFocus: bringToFront,
      onRemove: removeInstrument,
      onSoloChange: () => { updateSoloState(); schedulePersist(); },
      onGeometryChange: schedulePersist,
    });

    if (savedState?.instrumentState) panel.restoreInstrumentState(savedState.instrumentState);

    panels.set(instanceId, panel);
    stage.appendChild(panel.el);
    bringToFront(instanceId);
    if (isPlaying) panel.start();
    updateSoloState();
    if (layout !== "freeform") applyLayoutPositions();
    schedulePersist();
    return panel;
  }

  function removeInstrument(instanceId) {
    const panel = panels.get(instanceId);
    if (!panel) return;
    panel.dispose();
    panels.delete(instanceId);
    updateSoloState();
    if (layout !== "freeform") applyLayoutPositions();
    schedulePersist();
  }

  for (const inst of (saved?.instances || []).slice(0, MAX_INSTANCES)) {
    addInstrument(inst.instrumentId, inst);
  }
  applyLayoutPositions();

  window.addEventListener("resize", () => {
    if (layout !== "freeform") {
      applyLayoutPositions();
      return;
    }
    const vp = viewportSize();
    for (const panel of panels.values()) {
      const manifest = getManifest(panel.instrumentId);
      const clamped = clampGeometryToViewport(panel.getGeometry(), vp, manifest?.minimumWidth || 220, manifest?.minimumHeight || 220);
      panel.setGeometry(clamped);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.isContentEditable)) return;
    if (e.code === "Space") {
      e.preventDefault();
      transportBar.el.querySelector(".im-transport-play")?.click();
    }
  });

  return {
    addInstrument,
    getInstanceCount: () => panels.size,
  };
}
