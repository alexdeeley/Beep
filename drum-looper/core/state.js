import { VOICE_IDS } from "./voices.js";

const STORAGE_KEY = "deeley_drumloop_v1";

// Plain JSON-compatible snapshot of everything: six voice configs (+
// their tonality attachment), global tonality, effects sends already
// live inside voice params, loop events/layers, transforms, humanize,
// macros, automation, and the two morph snapshots. Nothing here is an
// AudioNode or a function - safe to JSON.stringify directly.
export function buildStateSnapshot({ looper, voices, morph, effects }) {
  const voiceState = {};
  for (const id of VOICE_IDS) {
    voiceState[id] = { params: voices[id].getParams(), tonality: voices[id].getTonality() };
  }
  const looperState = looper.getState();
  return {
    version: 1,
    voices: voiceState,
    tonality: looperState.tonality,
    transforms: looperState.transforms,
    humanize: looperState.humanize,
    macros: looperState.macros,
    bpm: looperState.bpm,
    loop: {
      durationMs: looperState.durationMs,
      events: looperState.events,
      layers: looperState.layers,
    },
    automation: {
      events: looperState.automationEvents,
      enabled: looperState.automationEnabled,
    },
    morph: morph ? { a: morph.a, b: morph.b, t: morph.t } : null,
    effects: effects || null,
  };
}

export function applyStateSnapshot(data, { looper, voices, morph, effects }) {
  if (!data || typeof data !== "object") return;
  if (data.voices) {
    for (const id of VOICE_IDS) {
      const v = data.voices[id];
      if (!v) continue;
      if (v.params) voices[id].setParams(v.params);
      if (v.tonality) voices[id].setTonality(v.tonality);
    }
  }
  looper._restore({
    events: data.loop?.events || [],
    layers: data.loop?.layers || [],
    durationMs: data.loop?.durationMs || 0,
    transforms: data.transforms,
    humanize: data.humanize,
    macros: data.macros,
    tonality: data.tonality,
    automationEvents: data.automation?.events || [],
    automationEnabled: data.automation?.enabled !== false,
    bpm: data.bpm,
  });
  if (morph && data.morph) {
    morph.a = data.morph.a || null;
    morph.b = data.morph.b || null;
    morph.t = typeof data.morph.t === "number" ? data.morph.t : 0;
  }
  if (effects && data.effects) Object.assign(effects, data.effects);
}

export function saveToStorage(snapshot) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch (e) {
    return false;
  }
}

export function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function clearStorage() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
}
