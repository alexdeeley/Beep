import { getContext, getMasterBus, ensureStarted, isStarted } from "../core/audio-engine.js";
import { createInstance, getManifest } from "../core/registry.js";
import { createPanel } from "./instrument-panel.js";
import { createTransportBar } from "./transport.js";

const STORAGE_PREFIX = "deeley_instruments_standalone_";

// Every instrument's own page is this same generic shell around the exact
// same instrument module the workspace uses - a single-panel workspace of
// one, essentially. Adding a standalone page for instrument #20 means
// copying the two-line HTML shell and changing one id string, not writing
// new mounting logic.
export function mountStandalone(instrumentId, rootEl) {
  const manifest = getManifest(instrumentId);
  if (!manifest) {
    rootEl.textContent = "Unknown instrument: " + instrumentId;
    return;
  }
  document.title = manifest.name + " — Instruments — Deeley.org";

  const ctx = getContext();
  rootEl.innerHTML = "";
  rootEl.classList.add("im-workspace-root");

  const stage = document.createElement("div");
  stage.className = "im-stage";

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

  const transportBar = createTransportBar({
    showAdd: false,
    showLayouts: false,
    onPlayStateChange: (playing) => (playing ? panel.start() : panel.stop()),
  });

  rootEl.appendChild(transportBar.el);
  rootEl.appendChild(stage);
  rootEl.appendChild(startOverlay);

  const instance = createInstance(instrumentId, ctx);
  const storageKey = STORAGE_PREFIX + instrumentId;
  let savedState = null;
  try {
    savedState = JSON.parse(localStorage.getItem(storageKey) || "null");
  } catch (e) {}

  function computeGeometry() {
    const rect = stage.getBoundingClientRect();
    const width = Math.max(manifest.minimumWidth, Math.min(rect.width - 32, Math.max(manifest.defaultWidth, 340)));
    const height = Math.max(manifest.minimumHeight, rect.height - 32);
    return { x: 16, y: 16, width, height };
  }

  const initialGeometry = computeGeometry();
  const panel = createPanel({
    instanceId: "standalone",
    instrumentId,
    manifest,
    instance,
    ctx,
    masterBus: getMasterBus(),
    x: initialGeometry.x,
    y: initialGeometry.y,
    width: savedState?.width ?? initialGeometry.width,
    height: savedState?.height ?? initialGeometry.height,
    volume: savedState?.volume,
    muted: savedState?.muted,
    effects: savedState?.effects,
    onFocus: () => {},
    onRemove: () => {},
    onSoloChange: () => {},
    onGeometryChange: persist,
  });
  stage.appendChild(panel.el);

  if (savedState?.instrumentState) panel.restoreInstrumentState(savedState.instrumentState);

  function persist() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(panel.serialize()));
    } catch (e) {}
  }
  window.addEventListener("beforeunload", persist);
  setInterval(persist, 5000);

  window.addEventListener("resize", () => {
    const g = computeGeometry();
    panel.setGeometry({ x: g.x, y: g.y });
  });

  document.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.isContentEditable)) return;
    if (e.code === "Space") {
      e.preventDefault();
      transportBar.el.querySelector(".im-transport-play")?.click();
    }
  });
}
