// Versioned localStorage persistence. Bumping STORAGE_VERSION when the
// shape of saved state changes means old saves are simply discarded
// (fresh defaults) rather than crashing the app trying to interpret a
// shape they don't recognize.
const STORAGE_KEY = "deeley_instruments_workspace";
const STORAGE_VERSION = 1;

export function saveWorkspace(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, state, savedAt: Date.now() }));
  } catch (e) {}
}

export function loadWorkspace() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== STORAGE_VERSION) return null;
    return parsed.state ?? null;
  } catch (e) {
    return null;
  }
}

export function clearWorkspace() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {}
}
