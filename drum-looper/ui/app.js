import { getContext, ensureStarted, isStarted, getMasterFilter, getDelayBus, getReverbBus, getDistortionBus } from "../core/audio.js";
import { createLooper } from "../core/looper.js";
import { VOICE_IDS, VOICE_LABELS, PARAM_META, VOICE_PARAM_KEYS, clampParam } from "../core/voices.js";
import { PRESETS, PRESET_KEYS, applyPresetToVoices, applyPresetToVoice } from "../core/presets.js";
import { SCALES, MODES, NOTE_NAMES } from "../core/tonality.js";
import { buildStateSnapshot, applyStateSnapshot, saveToStorage, loadFromStorage } from "../core/state.js";

const root = document.getElementById("dl-root");
const looper = createLooper();
const voices = looper.voices;
const morph = { a: null, b: null, t: 0 };
let selectedVoiceId = "kick";

// ---------------------------------------------------------------------
// Generic slider-row builder (the one control primitive every panel is
// built from) - matches the label+slider+live-value pattern used
// throughout the site's other instruments.
// ---------------------------------------------------------------------
function el(tag, className, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const c of children) if (c !== null && c !== undefined) node.append(c);
  return node;
}

function buildSliderRow(container, { label, min, max, step = 1, value, format, onInput }) {
  const row = el("div", "dl-row");
  row.append(el("span", "dl-row-label", label));
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(value);
  const valueEl = el("span", "dl-row-value");
  const fmt = format || ((v) => String(Math.round(v)));
  valueEl.textContent = fmt(Number(slider.value));
  slider.addEventListener("input", () => {
    const v = Number(slider.value);
    valueEl.textContent = fmt(v);
    onInput(v);
  });
  row.append(slider, valueEl);
  container.append(row);
  return { slider, setValue(v) { slider.value = String(v); valueEl.textContent = fmt(v); } };
}

function buildChipRow(container, { options, active, onPick, altClass }) {
  const row = el("div", "dl-chip-row");
  const buttons = {};
  options.forEach(({ key, label, danger }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dl-chip" + (key === active ? " " + (altClass || "dl-active") : "") + (danger ? " dl-danger" : "");
    btn.textContent = label;
    btn.addEventListener("click", () => {
      onPick(key);
      Object.entries(buttons).forEach(([k, b]) => b.classList.toggle(altClass || "dl-active", k === key));
    });
    buttons[key] = btn;
    row.append(btn);
  });
  container.append(row);
  return buttons;
}

const pct = (v) => Math.round(v) + "%";
function logToSlider(real, min, max) { return (100 * Math.log(real / min)) / Math.log(max / min); }
function sliderToLog(raw, min, max) { return min * Math.pow(max / min, raw / 100); }

// ---------------------------------------------------------------------
// Effects state - the bus nodes in audio.js only expose setters, so this
// object is the single source of truth the Effects tab reads from (its
// sliders would otherwise reset to hardcoded defaults on every re-render)
// and what gets included in the saved/restored state snapshot.
// ---------------------------------------------------------------------
const effectsState = {
  masterTone: 20000,
  delayTime: 0.28, delayFeedback: 0.35, delayFilter: 4000,
  reverbSize: 0.6, reverbDecay: 2.2, reverbTone: 6000, reverbMix: 0.9,
  distortionDrive: 0.3, distortionCharacter: "soft", distortionMix: 0.8,
};
function applyEffectsState() {
  getMasterFilter().frequency.setTargetAtTime(effectsState.masterTone, getContext().currentTime, 0.02);
  const delay = getDelayBus();
  delay.setTime(effectsState.delayTime);
  delay.setFeedback(effectsState.delayFeedback);
  delay.setFilter(effectsState.delayFilter);
  const reverb = getReverbBus();
  reverb.setSize(effectsState.reverbSize);
  reverb.setDecay(effectsState.reverbDecay);
  reverb.setTone(effectsState.reverbTone);
  reverb.setMix(effectsState.reverbMix);
  getDistortionBus().setDrive(effectsState.distortionDrive, effectsState.distortionCharacter);
  getDistortionBus().setMix(effectsState.distortionMix);
}

// ---------------------------------------------------------------------
// Boot overlay - AudioContext must start from a real user gesture.
// ---------------------------------------------------------------------
const startOverlay = el(
  "div", "dl-start-overlay",
  el("button", "dl-start-btn", "TAP TO START"),
  el("div", "dl-start-sub", "Record a rhythm on six pads, loop it, then keep changing the sound underneath.")
);
if (isStarted()) startOverlay.remove();
startOverlay.querySelector(".dl-start-btn").addEventListener("click", async () => {
  await ensureStarted();
  startOverlay.remove();
});
document.body.append(startOverlay);

// ---------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------
const bpmInput = document.createElement("input");
bpmInput.type = "number";
bpmInput.min = "40";
bpmInput.max = "300";
bpmInput.value = String(looper.getBpm());
bpmInput.addEventListener("change", () => {
  const next = looper.setBpm(Number(bpmInput.value));
  bpmInput.value = String(next);
});
const tapBtn = el("button", "dl-taptempo", "TAP");
tapBtn.addEventListener("click", () => { bpmInput.value = String(looper.tapTempo()); });
const loopLenEl = el("span", "dl-loop-len", "No loop yet");
const saveIndicator = el("span", "dl-save-indicator", "");
const tweakBtn = el("button", "dl-tweak-btn", "TWEAK ▲");

const header = el(
  "div", "dl-header",
  el("span", "dl-title", "DRUM LOOPER"),
  el("div", "dl-bpm", "BPM", bpmInput, tapBtn),
  loopLenEl,
  el("div", "dl-spacer"),
  saveIndicator,
  tweakBtn
);

const playheadTrack = el("div", "dl-playhead-track", el("div", "dl-playhead-fill"));
const playheadFill = playheadTrack.querySelector(".dl-playhead-fill");

// ---------------------------------------------------------------------
// Pads
// ---------------------------------------------------------------------
const KEY_TO_VOICE = { a: "kick", s: "snare", d: "tom", f: "clap", g: "closedHat", h: "openHat" };
const VOICE_TO_KEY = Object.fromEntries(Object.entries(KEY_TO_VOICE).map(([k, v]) => [v, k.toUpperCase()]));

const padEls = {};
const padsGrid = el("div", "dl-pads");
for (const voiceId of VOICE_IDS) {
  const pad = el(
    "button", "dl-pad",
    el("span", "dl-pad-key", VOICE_TO_KEY[voiceId]),
    el("span", "dl-pad-label", VOICE_LABELS[voiceId]),
    el("span", "dl-pad-sub", "tap to play · hold to edit")
  );
  pad.type = "button";
  pad.dataset.voice = voiceId;
  const editBtn = el("button", "dl-pad-edit", "✎");
  editBtn.type = "button";
  editBtn.addEventListener("click", (e) => { e.stopPropagation(); openSheet("edit", voiceId); });
  pad.append(editBtn);
  padEls[voiceId] = pad;
  padsGrid.append(pad);
}

// Pointer Events multitouch: each active pointer gets its own pad
// association so simultaneous hits on different pads (or rapid
// retriggers of the same pad) never interfere with each other. The
// long-press-to-edit timer is likewise keyed per pointerId - a single
// shared timer variable would leak every pointer's timer except the
// last one touched whenever two pads are held down together.
const activePointers = new Map();
const longPressTimers = new Map();

function pressureToVelocity(e) {
  // Most browsers report 0.5 for devices with no real pressure sensor -
  // treat that as "no data" and fall back rather than always landing at
  // a flat mid velocity. Apple Pencil / pressure-capable touch report a
  // genuine 0..1 value here via the same Pointer Events API.
  if (typeof e.pressure === "number" && e.pressure > 0 && e.pressure !== 0.5) return e.pressure;
  if (e.width && e.width > 1) return Math.max(0.5, Math.min(1, e.width / 45));
  return 0.85;
}

function attachPad(voiceId, padEl) {
  padEl.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    try { padEl.setPointerCapture(e.pointerId); } catch (err) {}
    const velocity = pressureToVelocity(e);
    activePointers.set(e.pointerId, voiceId);
    padEl.classList.add("dl-pad-live");
    looper.hitPad(voiceId, velocity, accentHeld);
    longPressTimers.set(e.pointerId, setTimeout(() => openSheet("edit", voiceId), 550));
  });
  const release = (e) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.delete(e.pointerId);
    padEl.classList.remove("dl-pad-live");
    const timer = longPressTimers.get(e.pointerId);
    if (timer) { clearTimeout(timer); longPressTimers.delete(e.pointerId); }
  };
  padEl.addEventListener("pointerup", release);
  padEl.addEventListener("pointercancel", release);
  padEl.addEventListener("pointerleave", (e) => { if (e.buttons === 0) release(e); });
}
for (const voiceId of VOICE_IDS) attachPad(voiceId, padEls[voiceId]);

looper.onHit((voiceId, kind) => {
  const pad = padEls[voiceId];
  if (!pad) return;
  if (kind === "recorded" || kind === "overdub") {
    const cls = kind === "recorded" ? "dl-pad-flash-recorded" : "dl-pad-flash-overdub";
    pad.classList.remove(cls);
    void pad.offsetWidth;
    pad.classList.add(cls);
  }
});

// ---------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------
let accentHeld = false;
const recordBtn = el("button", "dl-tbtn dl-tbtn-record", "RECORD");
const stopBtn = el("button", "dl-tbtn", "STOP");
const playBtn = el("button", "dl-tbtn", "PLAY");
const overdubBtn = el("button", "dl-tbtn dl-tbtn-overdub", "OVERDUB");
const undoBtn = el("button", "dl-tbtn", "UNDO");
const clearBtn = el("button", "dl-tbtn", "CLEAR");
const accentBtn = el("button", "dl-tbtn dl-tbtn-accent", "ACCENT");
[recordBtn, stopBtn, playBtn, overdubBtn, undoBtn, clearBtn, accentBtn].forEach((b) => (b.type = "button"));

recordBtn.addEventListener("click", async () => { await ensureStarted(); looper.record(); });
stopBtn.addEventListener("click", () => looper.stop());
playBtn.addEventListener("click", async () => { await ensureStarted(); looper.play(); });
overdubBtn.addEventListener("click", async () => { await ensureStarted(); looper.overdub(); });
undoBtn.addEventListener("click", () => looper.undo());
clearBtn.addEventListener("click", () => { if (confirm("Clear the recorded loop? This can't be undone.")) looper.clear(); });
accentBtn.addEventListener("click", () => { accentHeld = !accentHeld; accentBtn.classList.toggle("dl-active", accentHeld); });

const transport = el("div", "dl-transport", recordBtn, stopBtn, playBtn, overdubBtn, undoBtn, clearBtn, accentBtn);

function refreshTransportUI() {
  const state = looper.getPlaybackState();
  recordBtn.classList.toggle("dl-armed", state === "armed");
  recordBtn.classList.toggle("dl-recording", state === "recording");
  recordBtn.textContent = state === "recording" ? "● REC…" : state === "armed" ? "● WAITING…" : "RECORD";
  overdubBtn.classList.toggle("dl-active", state === "overdubbing");
  overdubBtn.disabled = !(state === "looping" || state === "overdubbing");
  stopBtn.disabled = !(state === "looping" || state === "overdubbing" || state === "recording" || state === "armed");
  playBtn.disabled = !(state === "stopped");
  undoBtn.disabled = looper.getState().layers.length <= 1;
  clearBtn.disabled = looper.getState().events.length === 0 && state === "idle";
  loopLenEl.textContent = looper.getDurationMs() > 0 ? `${(looper.getDurationMs() / 1000).toFixed(2)}s loop` : "No loop yet";
}
looper.onChange(refreshTransportUI);
refreshTransportUI();

function tickPlayhead() {
  const frac = looper.getPlayheadFraction();
  playheadFill.style.width = frac === null ? "0%" : Math.round(frac * 1000) / 10 + "%";
  requestAnimationFrame(tickPlayhead);
}
requestAnimationFrame(tickPlayhead);

// ---------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------
document.addEventListener("keydown", (e) => {
  if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.isContentEditable)) return;
  if (e.repeat) return;
  const key = e.key.toLowerCase();
  if (KEY_TO_VOICE[key]) {
    e.preventDefault();
    ensureStarted();
    looper.hitPad(KEY_TO_VOICE[key], 0.9, accentHeld);
    padEls[KEY_TO_VOICE[key]].classList.add("dl-pad-live");
    return;
  }
  if (key === "r") { e.preventDefault(); ensureStarted(); looper.record(); }
  else if (key === "o") { e.preventDefault(); ensureStarted(); looper.overdub(); }
  else if (key === "z") { e.preventDefault(); looper.undo(); }
  else if (key === " ") { e.preventDefault(); looper.getPlaybackState() === "stopped" ? looper.play() : looper.stop(); }
  else if (key === "shift") { accentHeld = true; accentBtn.classList.add("dl-active"); }
});
document.addEventListener("keyup", (e) => {
  const key = e.key.toLowerCase();
  if (KEY_TO_VOICE[key]) padEls[KEY_TO_VOICE[key]].classList.remove("dl-pad-live");
  if (key === "shift") { accentHeld = false; accentBtn.classList.remove("dl-active"); }
});

// ---------------------------------------------------------------------
// Bottom sheet scaffold + tabs
// ---------------------------------------------------------------------
const sheetOverlay = el("div", "dl-sheet-overlay");
const sheetBody = el("div", "dl-sheet-body");
const sheetTabsEl = el("div", "dl-sheet-tabs");
const sheetClose = el("button", "dl-sheet-close", "✕");
sheetClose.type = "button";
const sheet = el("div", "dl-sheet", el("div", "dl-sheet-handle"), sheetClose, sheetTabsEl, sheetBody);
sheetOverlay.addEventListener("click", closeSheet);
sheetClose.addEventListener("click", closeSheet);
tweakBtn.addEventListener("click", () => (sheet.classList.contains("dl-open") ? closeSheet() : openSheet("edit", selectedVoiceId)));

const TABS = [
  { key: "edit", label: "EDIT" },
  { key: "tonality", label: "TONALITY" },
  { key: "macros", label: "MACROS" },
  { key: "transform", label: "TRANSFORM" },
  { key: "humanize", label: "HUMANIZE" },
  { key: "effects", label: "EFFECTS" },
  { key: "morph", label: "MORPH" },
  { key: "presets", label: "PRESETS" },
  { key: "random", label: "RANDOM" },
  { key: "automation", label: "AUTOMATION" },
];
let activeTab = "edit";
const tabButtons = {};
TABS.forEach(({ key, label }) => {
  const btn = el("button", "dl-sheet-tab", label);
  btn.type = "button";
  btn.addEventListener("click", () => renderTab(key));
  tabButtons[key] = btn;
  sheetTabsEl.append(btn);
});

function openSheet(tabKey, voiceId) {
  if (voiceId) selectedVoiceId = voiceId;
  sheet.classList.add("dl-open");
  sheetOverlay.classList.add("dl-open");
  renderTab(tabKey || activeTab);
}
function closeSheet() {
  sheet.classList.remove("dl-open");
  sheetOverlay.classList.remove("dl-open");
}
function renderTab(key) {
  activeTab = key;
  Object.entries(tabButtons).forEach(([k, b]) => b.classList.toggle("dl-active", k === key));
  sheetBody.innerHTML = "";
  RENDERERS[key](sheetBody);
}

// ---------------------------------------------------------------------
// EDIT tab - per-voice deep editing, generated from PARAM_META.
// ---------------------------------------------------------------------
function renderEditTab(container) {
  const tabs = el("div", "dl-voice-tabs");
  VOICE_IDS.forEach((id) => {
    const b = el("button", "dl-voice-tab" + (id === selectedVoiceId ? " dl-active" : ""), VOICE_LABELS[id]);
    b.type = "button";
    b.addEventListener("click", () => { selectedVoiceId = id; renderTab("edit"); });
    tabs.append(b);
  });
  container.append(tabs);

  const voiceId = selectedVoiceId;
  const voice = voices[voiceId];

  container.append(el("div", "dl-section-title", "Tonality"));
  const tonalityState = voice.getTonality();
  const followRow = el("div", "dl-row", el("span", "dl-row-label", "Follow Tonality"));
  const followBtn = el("button", "dl-chip" + (tonalityState.follow ? " dl-active" : ""), tonalityState.follow ? "ON" : "OFF");
  followBtn.type = "button";
  followBtn.addEventListener("click", () => {
    const next = !voice.getTonality().follow;
    voice.setTonality({ follow: next });
    followBtn.classList.toggle("dl-active", next);
    followBtn.textContent = next ? "ON" : "OFF";
  });
  followRow.append(followBtn);
  container.append(followRow);
  buildSliderRow(container, { label: "Scale Degree", min: 1, max: 7, step: 1, value: tonalityState.degree, format: (v) => String(v), onInput: (v) => voice.setTonality({ degree: v }) });
  buildSliderRow(container, { label: "Octave Offset", min: -2, max: 2, step: 1, value: tonalityState.octaveOffset, format: (v) => (v > 0 ? "+" + v : String(v)), onInput: (v) => voice.setTonality({ octaveOffset: v }) });

  container.append(el("div", "dl-section-title", "Synthesis"));
  for (const key of VOICE_PARAM_KEYS[voiceId]) buildParamMetaRow(container, voiceId, key);

  container.append(el("div", "dl-section-title", "Load Preset (this voice only)"));
  const grid = el("div", "dl-preset-grid");
  PRESET_KEYS.forEach((key) => {
    const btn = el("button", "dl-preset-btn", PRESETS[key].label);
    btn.type = "button";
    btn.addEventListener("click", () => { applyPresetToVoice(voices, key, voiceId); renderTab("edit"); });
    grid.append(btn);
  });
  container.append(grid);
}

function buildParamMetaRow(container, voiceId, key) {
  const meta = PARAM_META[key];
  const voice = voices[voiceId];
  const path = `voice.${voiceId}.${key}`;
  if (meta.type === "enum") {
    const row = el("div", "dl-row", el("span", "dl-row-label", meta.label));
    const chipRow = el("div", "dl-chip-row");
    const buttons = {};
    meta.options.forEach((opt) => {
      const btn = el("button", "dl-chip" + (opt === voice.getParams()[key] ? " dl-active" : ""), opt);
      btn.type = "button";
      btn.addEventListener("click", () => {
        voice.setParam(key, opt);
        looper.recordAutomation(path, opt);
        Object.entries(buttons).forEach(([k, b]) => b.classList.toggle("dl-active", k === opt));
      });
      buttons[opt] = btn;
      chipRow.append(btn);
    });
    row.append(chipRow);
    container.append(row);
    looper.registerAutomationSetter(path, (v) => {
      voice.setParam(key, v);
      Object.entries(buttons).forEach(([k, b]) => b.classList.toggle("dl-active", k === v));
    });
    return;
  }
  const isLog = meta.curve === "log";
  const current = voice.getParams()[key];
  const toReal = (raw) => (isLog ? sliderToLog(raw, meta.min, meta.max) : raw);
  const toSlider = (real) => (isLog ? logToSlider(real, meta.min, meta.max) : real);
  const step = isLog ? 0.1 : meta.step || 1;
  const ctl = buildSliderRow(container, {
    label: meta.label,
    min: isLog ? 0 : meta.min,
    max: isLog ? 100 : meta.max,
    step,
    value: toSlider(current),
    format: (raw) => { const real = toReal(raw); return (step < 1 ? real.toFixed(1) : Math.round(real)) + (meta.unit ? " " + meta.unit : ""); },
    onInput: (raw) => { const real = toReal(raw); voice.setParam(key, real); looper.recordAutomation(path, real); },
  });
  looper.registerAutomationSetter(path, (real) => { voice.setParam(key, real); ctl.setValue(toSlider(real)); });
}

// ---------------------------------------------------------------------
// TONALITY tab
// ---------------------------------------------------------------------
function renderTonalityTab(container) {
  container.append(el("div", "dl-section-title", "Global Mode"));
  const tonalityState = looper.getTonality();
  buildChipRow(container, {
    options: MODES.map((m) => ({ key: m, label: SCALES[m]?.label || m.toUpperCase() })),
    active: tonalityState.mode,
    onPick: (m) => looper.setTonality({ mode: m }),
  });

  container.append(el("div", "dl-section-title", "Root Note"));
  buildChipRow(container, {
    options: NOTE_NAMES.map((n, i) => ({ key: i, label: n })),
    active: tonalityState.rootSemitone,
    onPick: (i) => looper.setTonality({ rootSemitone: Number(i) }),
  });

  if (tonalityState.mode === "custom") {
    container.append(el("div", "dl-section-title", "Custom Scale (tap semitones to include)"));
    const grid = el("div", "dl-chip-row");
    const custom = new Set(tonalityState.customDegrees || [0, 2, 4, 5, 7, 9, 11]);
    NOTE_NAMES.forEach((n, i) => {
      const btn = el("button", "dl-chip" + (custom.has(i) ? " dl-active" : ""), n);
      btn.type = "button";
      btn.addEventListener("click", () => {
        custom.has(i) ? custom.delete(i) : custom.add(i);
        btn.classList.toggle("dl-active", custom.has(i));
        looper.setTonality({ customDegrees: [...custom].sort((a, b) => a - b) });
      });
      grid.append(btn);
    });
    container.append(grid);
  }

  container.append(el("div", "dl-section-title", "Per-Voice Attachment"));
  container.append(el("div", "dl-help", "Each voice can follow the global root/scale above, or ignore it and use its own Pitch from the Edit tab."));
  for (const voiceId of VOICE_IDS) {
    const voice = voices[voiceId];
    const t = voice.getTonality();
    const row = el("div", "dl-row", el("span", "dl-row-label", VOICE_LABELS[voiceId]));
    const followBtn = el("button", "dl-chip" + (t.follow ? " dl-active" : ""), t.follow ? "FOLLOWING" : "FREE");
    followBtn.type = "button";
    followBtn.addEventListener("click", () => {
      const next = !voice.getTonality().follow;
      voice.setTonality({ follow: next });
      followBtn.classList.toggle("dl-active", next);
      followBtn.textContent = next ? "FOLLOWING" : "FREE";
    });
    row.append(followBtn);
    container.append(row);
  }
}

// ---------------------------------------------------------------------
// MACROS tab
// ---------------------------------------------------------------------
const MACRO_META = {
  pitch: { label: "Pitch", min: -24, max: 24, step: 1, format: (v) => (v > 0 ? "+" : "") + v + " st" },
  tone: { label: "Tone", min: -1, max: 1, step: 0.02, format: (v) => (v > 0 ? "+" : "") + Math.round(v * 100) + "%" },
  decay: { label: "Decay", min: -0.9, max: 3, step: 0.02, format: (v) => (v > 0 ? "+" : "") + Math.round(v * 100) + "%" },
  drive: { label: "Drive", min: 0, max: 1, step: 0.02, format: pct100 },
  filter: { label: "Filter", min: -1, max: 1, step: 0.02, format: (v) => (v > 0 ? "+" : "") + Math.round(v * 100) + "%" },
  space: { label: "Space", min: 0, max: 1, step: 0.02, format: pct100 },
  chaos: { label: "Chaos", min: 0, max: 1, step: 0.02, format: pct100 },
  metal: { label: "Metal", min: 0, max: 1, step: 0.02, format: pct100 },
};
function pct100(v) { return Math.round(v * 100) + "%"; }

function renderMacrosTab(container) {
  container.append(el("div", "dl-help", "Macros never overwrite each voice's own settings - they're applied live on top of them, so resetting a macro to its neutral position always returns to your individually tuned sound."));
  const m = looper.getMacros();
  for (const [key, meta] of Object.entries(MACRO_META)) {
    buildSliderRow(container, {
      label: meta.label, min: meta.min, max: meta.max, step: meta.step, value: m[key], format: meta.format,
      onInput: (v) => { looper.setMacro(key, v); looper.recordAutomation(`macro.${key}`, v); },
    });
    looper.registerAutomationSetter(`macro.${key}`, (v) => { looper.setMacro(key, v); if (activeTab === "macros") renderTab("macros"); });
  }
}

// ---------------------------------------------------------------------
// TRANSFORM tab
// ---------------------------------------------------------------------
function renderTransformTab(container) {
  const t = looper.getTransforms();
  container.append(el("div", "dl-section-title", "Direction & Length"));
  const revRow = el("div", "dl-row", el("span", "dl-row-label", "Reverse"));
  const revBtn = el("button", "dl-chip" + (t.reverse ? " dl-active" : ""), t.reverse ? "ON" : "OFF");
  revBtn.type = "button";
  revBtn.addEventListener("click", () => {
    const next = !looper.getTransforms().reverse;
    looper.setTransform("reverse", next);
    revBtn.classList.toggle("dl-active", next);
    revBtn.textContent = next ? "ON" : "OFF";
  });
  revRow.append(revBtn);
  container.append(revRow);

  const speedRow = el("div", "dl-row", el("span", "dl-row-label", "Length"));
  buildChipRow(speedRow, {
    options: [{ key: "orig", label: "ORIGINAL" }, { key: 0.5, label: "×0.5" }, { key: 1, label: "×1" }, { key: 2, label: "×2" }],
    active: t.speedMultiplier,
    onPick: (k) => {
      if (k === "orig") { looper.setTransform("speedMultiplier", 1); looper.setTransform("stretchMultiplier", 1); }
      else looper.setTransform("speedMultiplier", Number(k));
    },
  });
  container.append(speedRow);

  buildSliderRow(container, { label: "Timing Stretch", min: 25, max: 400, step: 1, value: Math.round(t.stretchMultiplier * 100), format: (v) => (v / 100).toFixed(2) + "×", onInput: (v) => looper.setTransform("stretchMultiplier", v / 100) });
  buildSliderRow(container, { label: "Rotate", min: 0, max: 100, step: 0.5, value: looper.getDurationMs() ? (t.rotateMs / looper.getDurationMs()) * 100 : 0, format: pct, onInput: (v) => looper.setTransform("rotateMs", (v / 100) * looper.getDurationMs()) });
  buildSliderRow(container, { label: "Swing", min: 0, max: 100, step: 1, value: t.swing * 100, format: pct, onInput: (v) => looper.setTransform("swing", v / 100) });

  container.append(el("div", "dl-section-title", "Quantize (optional, never automatic)"));
  buildChipRow(container, {
    options: [{ key: 0, label: "Off" }, { key: 0.25, label: "25%" }, { key: 0.5, label: "50%" }, { key: 0.75, label: "75%" }, { key: 1, label: "100%" }],
    active: t.quantizeStrength,
    onPick: (k) => looper.setTransform("quantizeStrength", Number(k)),
  });

  container.append(el("div", "dl-section-title", "Velocity Scale"));
  buildSliderRow(container, { label: "Velocity", min: 10, max: 200, step: 1, value: t.velocityScale * 100, format: pct, onInput: (v) => looper.setTransform("velocityScale", v / 100) });

  container.append(el("div", "dl-section-title", "Per-Voice"));
  for (const voiceId of VOICE_IDS) {
    const wrap = el("div", "dl-row", el("span", "dl-row-label", VOICE_LABELS[voiceId]));
    const dropBtn = el("button", "dl-chip" + (t.dropped[voiceId] ? " dl-active-alt" : ""), t.dropped[voiceId] ? "DROPPED" : "DROP");
    dropBtn.type = "button";
    dropBtn.addEventListener("click", () => {
      const next = !looper.getTransforms().dropped[voiceId];
      looper.setVoiceTransform("dropped", voiceId, next);
      dropBtn.classList.toggle("dl-active-alt", next);
      dropBtn.textContent = next ? "DROPPED" : "DROP";
      padEls[voiceId].classList.toggle("dl-pad-dropped", next);
    });
    wrap.append(dropBtn);
    container.append(wrap);
    buildChipRow(container, {
      options: [{ key: 0.5, label: "Len ×0.5" }, { key: 1, label: "Len ×1" }, { key: 2, label: "Len ×2" }],
      active: t.voiceLengthMultiplier[voiceId],
      onPick: (k) => looper.setVoiceTransform("voiceLengthMultiplier", voiceId, Number(k)),
    });
    buildSliderRow(container, { label: "Probability", min: 0, max: 100, step: 1, value: t.probability[voiceId] * 100, format: pct, onInput: (v) => looper.setVoiceTransform("probability", voiceId, v / 100) });
    buildSliderRow(container, { label: "Stutter", min: 0, max: 3, step: 1, value: t.stutter[voiceId], format: (v) => String(v), onInput: (v) => looper.setVoiceTransform("stutter", voiceId, v) });
  }
}

// ---------------------------------------------------------------------
// HUMANIZE tab
// ---------------------------------------------------------------------
function renderHumanizeTab(container) {
  container.append(el("div", "dl-help", "At zero, every hit plays back exactly as you recorded it. These add fresh, non-repeating per-hit variation on top - never destructive to the underlying event."));
  const h = looper.getHumanize();
  const rows = [["velocity", "Velocity"], ["pitch", "Pitch"], ["timing", "Timing"], ["decay", "Decay"], ["pan", "Pan"], ["tone", "Tone"]];
  for (const [key, label] of rows) {
    buildSliderRow(container, { label, min: 0, max: 100, step: 1, value: h[key] * 100, format: pct, onInput: (v) => looper.setHumanize(key, v / 100) });
  }
}

// ---------------------------------------------------------------------
// EFFECTS tab
// ---------------------------------------------------------------------
function renderEffectsTab(container) {
  container.append(el("div", "dl-section-title", "Master"));
  buildSliderRow(container, {
    label: "Master Tone", min: 0, max: 100, step: 0.5, value: logToSlider(effectsState.masterTone, 200, 20000),
    format: (raw) => Math.round(sliderToLog(raw, 200, 20000)) + " Hz",
    onInput: (raw) => {
      effectsState.masterTone = sliderToLog(raw, 200, 20000);
      getMasterFilter().frequency.setTargetAtTime(effectsState.masterTone, getContext().currentTime, 0.02);
      looper.recordAutomation("fx.masterTone", effectsState.masterTone);
    },
  });
  container.append(el("div", "dl-help", "Compression and a safety limiter are always active on the master bus to keep six live voices from clipping."));

  const delay = getDelayBus();
  container.append(el("div", "dl-section-title", "Delay"));
  buildSliderRow(container, { label: "Time", min: 10, max: 1200, step: 5, value: effectsState.delayTime * 1000, format: (v) => Math.round(v) + " ms", onInput: (v) => { effectsState.delayTime = v / 1000; delay.setTime(effectsState.delayTime); looper.recordAutomation("fx.delayTime", effectsState.delayTime); } });
  buildSliderRow(container, { label: "Feedback", min: 0, max: 92, step: 1, value: effectsState.delayFeedback * 100, format: pct, onInput: (v) => { effectsState.delayFeedback = v / 100; delay.setFeedback(effectsState.delayFeedback); looper.recordAutomation("fx.delayFeedback", effectsState.delayFeedback); } });
  buildSliderRow(container, { label: "Filter", min: 0, max: 100, step: 0.5, value: logToSlider(effectsState.delayFilter, 300, 12000), format: (raw) => Math.round(sliderToLog(raw, 300, 12000)) + " Hz", onInput: (raw) => { effectsState.delayFilter = sliderToLog(raw, 300, 12000); delay.setFilter(effectsState.delayFilter); } });

  const reverb = getReverbBus();
  container.append(el("div", "dl-section-title", "Reverb"));
  buildSliderRow(container, { label: "Size", min: 5, max: 100, step: 1, value: effectsState.reverbSize * 100, format: pct, onInput: (v) => { effectsState.reverbSize = v / 100; reverb.setSize(effectsState.reverbSize); } });
  buildSliderRow(container, { label: "Decay", min: 30, max: 600, step: 5, value: effectsState.reverbDecay * 100, format: (v) => (v / 100).toFixed(1) + " s", onInput: (v) => { effectsState.reverbDecay = v / 100; reverb.setDecay(effectsState.reverbDecay); } });
  buildSliderRow(container, { label: "Tone", min: 0, max: 100, step: 0.5, value: logToSlider(effectsState.reverbTone, 500, 14000), format: (raw) => Math.round(sliderToLog(raw, 500, 14000)) + " Hz", onInput: (raw) => { effectsState.reverbTone = sliderToLog(raw, 500, 14000); reverb.setTone(effectsState.reverbTone); } });
  buildSliderRow(container, { label: "Mix", min: 0, max: 100, step: 1, value: effectsState.reverbMix * 100, format: pct, onInput: (v) => { effectsState.reverbMix = v / 100; reverb.setMix(effectsState.reverbMix); looper.recordAutomation("fx.reverbMix", effectsState.reverbMix); } });

  const dist = getDistortionBus();
  container.append(el("div", "dl-section-title", "Distortion"));
  const driveCtl = buildSliderRow(container, { label: "Drive", min: 0, max: 100, step: 1, value: effectsState.distortionDrive * 100, format: pct, onInput: (v) => { effectsState.distortionDrive = v / 100; dist.setDrive(effectsState.distortionDrive, effectsState.distortionCharacter); looper.recordAutomation("fx.distortionDrive", effectsState.distortionDrive); } });
  buildChipRow(container, {
    options: [{ key: "soft", label: "SOFT" }, { key: "hard", label: "HARD" }],
    active: effectsState.distortionCharacter,
    onPick: (k) => { effectsState.distortionCharacter = k; dist.setDrive(Number(driveCtl.slider.value) / 100, k); },
  });
  buildSliderRow(container, { label: "Mix", min: 0, max: 100, step: 1, value: effectsState.distortionMix * 100, format: pct, onInput: (v) => { effectsState.distortionMix = v / 100; dist.setMix(effectsState.distortionMix); } });

  container.append(el("div", "dl-help", "Each voice's own send amounts into these buses are in its Edit panel (Delay Send / Reverb Send / Distortion Send)."));

  looper.registerAutomationSetter("fx.masterTone", (v) => { effectsState.masterTone = v; getMasterFilter().frequency.setTargetAtTime(v, getContext().currentTime, 0.02); if (activeTab === "effects") renderTab("effects"); });
  looper.registerAutomationSetter("fx.delayTime", (v) => { effectsState.delayTime = v; delay.setTime(v); if (activeTab === "effects") renderTab("effects"); });
  looper.registerAutomationSetter("fx.delayFeedback", (v) => { effectsState.delayFeedback = v; delay.setFeedback(v); if (activeTab === "effects") renderTab("effects"); });
  looper.registerAutomationSetter("fx.reverbMix", (v) => { effectsState.reverbMix = v; reverb.setMix(v); if (activeTab === "effects") renderTab("effects"); });
  looper.registerAutomationSetter("fx.distortionDrive", (v) => { effectsState.distortionDrive = v; dist.setDrive(v, effectsState.distortionCharacter); if (activeTab === "effects") renderTab("effects"); });
}

// ---------------------------------------------------------------------
// MORPH tab
// ---------------------------------------------------------------------
function snapshotAllVoices() {
  const snap = {};
  for (const id of VOICE_IDS) snap[id] = voices[id].getParams();
  return snap;
}
function applyMorph(t) {
  if (!morph.a || !morph.b) return;
  morph.t = t;
  for (const id of VOICE_IDS) {
    const a = morph.a[id];
    const b = morph.b[id];
    if (!a || !b) continue;
    for (const key of VOICE_PARAM_KEYS[id]) {
      const meta = PARAM_META[key];
      if (meta.type === "enum") { voices[id].setParam(key, t >= 0.5 ? b[key] : a[key]); continue; }
      voices[id].setParam(key, a[key] + (b[key] - a[key]) * t);
    }
  }
  looper.recordAutomation("morph", t);
}
looper.registerAutomationSetter("morph", (v) => { applyMorph(v); if (activeTab === "morph") { const s = document.getElementById("dl-morph-slider"); if (s) s.value = String(Math.round(v * 100)); } });

function renderMorphTab(container) {
  container.append(el("div", "dl-help", "Capture two complete sound states, then blend between them while the recorded rhythm keeps looping unchanged."));
  const capRow = el("div", "dl-chip-row");
  const capA = el("button", "dl-chip" + (morph.a ? " dl-active" : ""), morph.a ? "A ●" : "CAPTURE A");
  const capB = el("button", "dl-chip" + (morph.b ? " dl-active" : ""), morph.b ? "B ●" : "CAPTURE B");
  capA.type = "button"; capB.type = "button";
  capA.addEventListener("click", () => { morph.a = snapshotAllVoices(); capA.textContent = "A ●"; capA.classList.add("dl-active"); });
  capB.addEventListener("click", () => { morph.b = snapshotAllVoices(); capB.textContent = "B ●"; capB.classList.add("dl-active"); });
  capRow.append(capA, capB);
  container.append(capRow);

  const wrap = el("div", "dl-big-slider-wrap");
  wrap.append(el("div", "dl-big-slider-label", el("span", null, "A"), el("span", null, "MORPH"), el("span", null, "B")));
  const bigWrap = el("div", "dl-big-slider");
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0"; slider.max = "100"; slider.value = String(Math.round(morph.t * 100));
  slider.id = "dl-morph-slider";
  slider.addEventListener("input", () => applyMorph(Number(slider.value) / 100));
  bigWrap.append(slider);
  wrap.append(bigWrap);
  container.append(wrap);
}

// ---------------------------------------------------------------------
// PRESETS tab
// ---------------------------------------------------------------------
function renderPresetsTab(container) {
  container.append(el("div", "dl-section-title", "Full Kit"));
  const grid = el("div", "dl-preset-grid");
  PRESET_KEYS.forEach((key) => {
    const btn = el("button", "dl-preset-btn", PRESETS[key].label);
    btn.type = "button";
    btn.addEventListener("click", () => applyPresetToVoices(voices, key));
    grid.append(btn);
  });
  container.append(grid);
}

// ---------------------------------------------------------------------
// RANDOM tab
// ---------------------------------------------------------------------
let randomIntensity = 0.4;
function randomizeVoice(voiceId) {
  for (const key of VOICE_PARAM_KEYS[voiceId]) {
    const meta = PARAM_META[key];
    if (meta.type === "enum") { voices[voiceId].setParam(key, meta.options[Math.floor(Math.random() * meta.options.length)]); continue; }
    if (key === "volume") { voices[voiceId].setParam(key, 40 + Math.random() * 55); continue; }
    voices[voiceId].setParam(key, meta.min + Math.random() * (meta.max - meta.min));
  }
}
function mutateVoice(voiceId, intensity) {
  const current = voices[voiceId].getParams();
  for (const key of VOICE_PARAM_KEYS[voiceId]) {
    const meta = PARAM_META[key];
    if (meta.type === "enum") { if (Math.random() < intensity * 0.5) voices[voiceId].setParam(key, meta.options[Math.floor(Math.random() * meta.options.length)]); continue; }
    const target = meta.min + Math.random() * (meta.max - meta.min);
    voices[voiceId].setParam(key, clampParam(key, current[key] + (target - current[key]) * intensity));
  }
}
function randomizeTonality() {
  const modes = MODES.filter((m) => m !== "free");
  looper.setTonality({ mode: modes[Math.floor(Math.random() * modes.length)], rootSemitone: Math.floor(Math.random() * 12) });
  for (const id of VOICE_IDS) {
    voices[id].setTonality({ follow: Math.random() < 0.6, degree: 1 + Math.floor(Math.random() * 7), octaveOffset: Math.floor(Math.random() * 3) - 1 });
  }
}
function randomizeEffects() {
  getDelayBus().setTime(0.05 + Math.random() * 0.6);
  getDelayBus().setFeedback(Math.random() * 0.7);
  getDelayBus().setFilter(600 + Math.random() * 8000);
  getReverbBus().setSize(Math.random());
  getReverbBus().setDecay(0.4 + Math.random() * 3);
  getReverbBus().setTone(1000 + Math.random() * 9000);
  getReverbBus().setMix(Math.random());
  getDistortionBus().setDrive(Math.random() * 0.7, Math.random() < 0.5 ? "soft" : "hard");
  for (const id of VOICE_IDS) {
    voices[id].setParam("sendDelay", Math.random() * 40);
    voices[id].setParam("sendReverb", Math.random() * 60);
    voices[id].setParam("sendDistortion", Math.random() * 30);
  }
}

function renderRandomTab(container) {
  container.append(el("div", "dl-section-title", "Target: " + VOICE_LABELS[selectedVoiceId]));
  const tabs = el("div", "dl-voice-tabs");
  VOICE_IDS.forEach((id) => {
    const b = el("button", "dl-voice-tab" + (id === selectedVoiceId ? " dl-active" : ""), VOICE_LABELS[id]);
    b.type = "button";
    b.addEventListener("click", () => { selectedVoiceId = id; renderTab("random"); });
    tabs.append(b);
  });
  container.append(tabs);

  buildSliderRow(container, { label: "Mutate Intensity", min: 1, max: 100, step: 1, value: randomIntensity * 100, format: pct, onInput: (v) => (randomIntensity = v / 100) });

  container.append(el("div", "dl-section-title", "Voice"));
  const grid1 = el("div", "dl-chip-row");
  const b1 = el("button", "dl-chip", "Randomize Current Voice"); b1.type = "button";
  b1.addEventListener("click", () => { randomizeVoice(selectedVoiceId); renderTab("random"); });
  const b2 = el("button", "dl-chip", "Randomize All Voices"); b2.type = "button";
  b2.addEventListener("click", () => { VOICE_IDS.forEach(randomizeVoice); renderTab("random"); });
  const b3 = el("button", "dl-chip", "Mutate Current Voice"); b3.type = "button";
  b3.addEventListener("click", () => { mutateVoice(selectedVoiceId, randomIntensity); renderTab("random"); });
  const b4 = el("button", "dl-chip", "Mutate All"); b4.type = "button";
  b4.addEventListener("click", () => { VOICE_IDS.forEach((id) => mutateVoice(id, randomIntensity)); renderTab("random"); });
  grid1.append(b1, b2, b3, b4);
  container.append(grid1);

  container.append(el("div", "dl-section-title", "Tonality & Effects"));
  const grid2 = el("div", "dl-chip-row");
  const b5 = el("button", "dl-chip", "Randomize Tonality"); b5.type = "button";
  b5.addEventListener("click", () => { randomizeTonality(); renderTab("random"); });
  const b6 = el("button", "dl-chip", "Randomize Effects"); b6.type = "button";
  b6.addEventListener("click", () => { randomizeEffects(); renderTab("random"); });
  grid2.append(b5, b6);
  container.append(grid2);
}

// ---------------------------------------------------------------------
// AUTOMATION tab
// ---------------------------------------------------------------------
function renderAutomationTab(container) {
  container.append(el("div", "dl-help", "Separate from the drum performance. When Automation Record is on, moving a macro, morph, or Edit-panel control while the loop plays is captured and replayed alongside it - remove it any time without touching the drum events."));
  const row1 = el("div", "dl-row", el("span", "dl-row-label", "Automation Record"));
  const recBtn = el("button", "dl-chip" + (looper.isAutomationRecording() ? " dl-active-alt" : ""), looper.isAutomationRecording() ? "RECORDING" : "OFF");
  recBtn.type = "button";
  recBtn.addEventListener("click", () => {
    const next = !looper.isAutomationRecording();
    next ? looper.startAutomationRecording() : looper.stopAutomationRecording();
    recBtn.classList.toggle("dl-active-alt", next);
    recBtn.textContent = next ? "RECORDING" : "OFF";
  });
  row1.append(recBtn);
  container.append(row1);

  const row2 = el("div", "dl-row", el("span", "dl-row-label", "Automation Playback"));
  const enBtn = el("button", "dl-chip" + (looper.isAutomationEnabled() ? " dl-active" : ""), looper.isAutomationEnabled() ? "ON" : "OFF");
  enBtn.type = "button";
  enBtn.addEventListener("click", () => {
    const next = !looper.isAutomationEnabled();
    looper.setAutomationEnabled(next);
    enBtn.classList.toggle("dl-active", next);
    enBtn.textContent = next ? "ON" : "OFF";
  });
  row2.append(enBtn);
  container.append(row2);

  const clearAutoBtn = el("button", "dl-chip dl-danger", "Clear Automation");
  clearAutoBtn.type = "button";
  clearAutoBtn.addEventListener("click", () => looper.clearAutomation());
  container.append(el("div", "dl-chip-row", clearAutoBtn));
}

const RENDERERS = {
  edit: renderEditTab,
  tonality: renderTonalityTab,
  macros: renderMacrosTab,
  transform: renderTransformTab,
  humanize: renderHumanizeTab,
  effects: renderEffectsTab,
  morph: renderMorphTab,
  presets: renderPresetsTab,
  random: renderRandomTab,
  automation: renderAutomationTab,
};

// ---------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------
let saveTimer = null;
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveIndicator.textContent = "…";
  saveTimer = setTimeout(() => {
    const snap = buildStateSnapshot({ looper, voices, morph, effects: effectsState });
    saveToStorage(snap);
    saveIndicator.textContent = "saved";
    setTimeout(() => { if (saveIndicator.textContent === "saved") saveIndicator.textContent = ""; }, 1500);
  }, 400);
}
looper.onChange(scheduleSave);

const saved = loadFromStorage();
if (saved) {
  applyStateSnapshot(saved, { looper, voices, morph, effects: effectsState });
}
applyEffectsState();
for (const voiceId of VOICE_IDS) padEls[voiceId].classList.toggle("dl-pad-dropped", !!looper.getTransforms().dropped[voiceId]);

// ---------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------
root.append(header, playheadTrack, padsGrid, transport, sheetOverlay, sheet);
