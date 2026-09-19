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
  stage.className = "im-stage im-stage-standalone";

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

  const panel = createPanel({
    instanceId: "standalone",
    instrumentId,
    manifest,
    instance,
    ctx,
    masterBus: getMasterBus(),
    volume: savedState?.volume,
    muted: savedState?.muted,
    effects: savedState?.effects,
    onRemove: () => {},
    onSoloChange: () => {},
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

  document.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.isContentEditable)) return;
    if (e.code === "Space") {
      e.preventDefault();
      transportBar.el.querySelector(".im-transport-play")?.click();
    }
  });
}
