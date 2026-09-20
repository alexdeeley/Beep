import { getContext, getMasterBus, ensureStarted, isStarted } from "../core/audio-engine.js";
import { createInstance, getManifest } from "../core/registry.js";
import { getBpm, setBpm } from "../core/transport.js";
import { createPanel } from "./instrument-panel.js";
import { createLibraryView } from "./library.js";
import { createTransportBar } from "./transport.js";
import { saveWorkspace, loadWorkspace } from "../core/persistence.js";

export const MAX_INSTANCES = 4;

// A fixed field of four quadrants, each outlined with a dashed border.
// There's nothing to drag or resize - an instrument just fills whichever
// quadrant it's placed in. The one way in is the circular "+" at the
// center: tap it, pick an instrument from the library, then tap one of
// the highlighted empty quadrants to drop it there. All instrument state,
// which quadrant it's in, and BPM round-trip through core/persistence.js.
export function createWorkspace(rootEl) {
  const ctx = getContext();
  const masterBus = getMasterBus();

  rootEl.innerHTML = "";
  rootEl.classList.add("im-workspace-root");

  const stage = document.createElement("div");
  stage.className = "im-stage";

  const grid = document.createElement("div");
  grid.className = "im-quadrant-grid";
  const quadrantEls = [];
  for (let i = 0; i < MAX_INSTANCES; i++) {
    const q = document.createElement("div");
    q.className = "im-quadrant";
    q.dataset.quadrant = String(i);
    q.addEventListener("click", () => onQuadrantClick(i));
    grid.appendChild(q);
    quadrantEls.push(q);
  }

  const addCenterBtn = document.createElement("button");
  addCenterBtn.type = "button";
  addCenterBtn.className = "im-add-center";
  addCenterBtn.setAttribute("aria-label", "Add an instrument");
  addCenterBtn.textContent = "+";
  addCenterBtn.addEventListener("click", onAddCenterClick);
  grid.appendChild(addCenterBtn);

  stage.appendChild(grid);

  const libraryOverlay = document.createElement("div");
  libraryOverlay.className = "im-library-overlay";
  libraryOverlay.style.display = "none";
  const libraryPanel = document.createElement("div");
  libraryPanel.className = "im-library-modal";
  const libraryHeader = document.createElement("div");
  libraryHeader.className = "im-library-modal-header";
  const libraryTitle = document.createElement("span");
  libraryTitle.textContent = "Pick an instrument";
  const libraryClose = document.createElement("button");
  libraryClose.type = "button";
  libraryClose.className = "im-btn";
  libraryClose.textContent = "Close";
  libraryClose.addEventListener("click", closeLibrary);
  libraryHeader.appendChild(libraryTitle);
  libraryHeader.appendChild(libraryClose);
  libraryPanel.appendChild(libraryHeader);
  const libraryView = createLibraryView({ onPick: (manifest) => { closeLibrary(); beginPlacement(manifest.id); }, actionLabel: "Pick" });
  libraryPanel.appendChild(libraryView.el);
  libraryOverlay.appendChild(libraryPanel);
  libraryOverlay.addEventListener("click", (e) => {
    if (e.target === libraryOverlay) closeLibrary();
  });

  function openLibrary() {
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

  const panels = new Map(); // quadrant index -> panel
  let isPlaying = false;
  let seq = 1;
  let persistTimer = null;
  let pendingInstrumentId = null;

  const saved = loadWorkspace();
  if (saved?.bpm) setBpm(saved.bpm);

  const transportBar = createTransportBar({
    onPlayStateChange: (playing) => { isPlaying = playing; for (const p of panels.values()) (playing ? p.start() : p.stop()); },
  });

  rootEl.appendChild(transportBar.el);
  rootEl.appendChild(stage);
  rootEl.appendChild(libraryOverlay);
  rootEl.appendChild(startOverlay);

  function emptyQuadrants() {
    const empty = [];
    for (let i = 0; i < MAX_INSTANCES; i++) if (!panels.has(i)) empty.push(i);
    return empty;
  }

  function onAddCenterClick() {
    if (pendingInstrumentId) {
      cancelPlacement();
      return;
    }
    if (emptyQuadrants().length === 0) {
      alert("The workspace already has 4 instruments - the most it can run at once. Remove one first.");
      return;
    }
    openLibrary();
  }

  function beginPlacement(instrumentId) {
    pendingInstrumentId = instrumentId;
    addCenterBtn.textContent = "×";
    addCenterBtn.classList.add("im-add-center-cancel");
    addCenterBtn.setAttribute("aria-label", "Cancel placing instrument");
    for (const i of emptyQuadrants()) quadrantEls[i].classList.add("im-quadrant-placeable");
  }

  function cancelPlacement() {
    pendingInstrumentId = null;
    addCenterBtn.textContent = "+";
    addCenterBtn.classList.remove("im-add-center-cancel");
    addCenterBtn.setAttribute("aria-label", "Add an instrument");
    quadrantEls.forEach((q) => q.classList.remove("im-quadrant-placeable"));
  }

  function onQuadrantClick(index) {
    if (!pendingInstrumentId || panels.has(index)) return;
    const instrumentId = pendingInstrumentId;
    cancelPlacement();
    addInstrument(instrumentId, undefined, index);
  }

  function updateSoloState() {
    const anySolo = [...panels.values()].some((p) => p.isSolo());
    for (const p of panels.values()) p.setForcedSilent(anySolo && !p.isSolo());
  }

  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persist, 150);
  }

  function persist() {
    saveWorkspace({
      bpm: getBpm(),
      instances: [...panels.entries()].map(([quadrant, p]) => ({ quadrant, ...p.serialize() })),
    });
  }

  function addInstrument(instrumentId, savedState, requestedQuadrant) {
    if (panels.size >= MAX_INSTANCES) return null;
    const manifest = getManifest(instrumentId);
    if (!manifest) return null;

    let quadrant = requestedQuadrant ?? savedState?.quadrant;
    if (quadrant === undefined || quadrant === null || panels.has(quadrant)) {
      quadrant = emptyQuadrants()[0];
    }
    if (quadrant === undefined) return null;

    const instance = createInstance(instrumentId, ctx);
    const instanceId = savedState?.instanceId || `${instrumentId}-${Date.now().toString(36)}-${seq++}`;

    const panel = createPanel({
      instanceId,
      instrumentId,
      manifest,
      instance,
      ctx,
      masterBus,
      volume: savedState?.volume,
      muted: savedState?.muted,
      solo: savedState?.solo,
      effects: savedState?.effects,
      onRemove: () => removeInstrument(quadrant),
      onSoloChange: () => { updateSoloState(); schedulePersist(); },
    });

    if (savedState?.instrumentState) panel.restoreInstrumentState(savedState.instrumentState);

    panels.set(quadrant, panel);
    quadrantEls[quadrant].appendChild(panel.el);
    quadrantEls[quadrant].classList.add("im-quadrant-filled");
    if (isPlaying) panel.start();
    updateSoloState();
    schedulePersist();
    return panel;
  }

  function removeInstrument(quadrant) {
    const panel = panels.get(quadrant);
    if (!panel) return;
    panel.dispose();
    panels.delete(quadrant);
    quadrantEls[quadrant].classList.remove("im-quadrant-filled");
    updateSoloState();
    schedulePersist();
  }

  for (const inst of (saved?.instances || []).slice(0, MAX_INSTANCES)) {
    addInstrument(inst.instrumentId, inst);
  }

  document.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.isContentEditable)) return;
    if (e.code === "Space") {
      e.preventDefault();
      transportBar.el.querySelector(".im-transport-play")?.click();
    } else if (e.code === "Escape" && pendingInstrumentId) {
      cancelPlacement();
    }
  });

  return {
    addInstrument,
    getInstanceCount: () => panels.size,
  };
}
