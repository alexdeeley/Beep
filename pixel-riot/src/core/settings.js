// Persistent user settings (preferences that are NOT part of an instrument preset):
// audio volume, accessibility, performance, grid resolution, UI.
//
// Settings are declared with a schema so the settings UI, validation, import and
// extensions can all reason about them. Extensions may add their own keys with
// `defineSettings(namespace, schema)`; keys become `${namespace}.${key}`.
//
// Schema entry: { type: 'bool'|'number'|'enum'|'string', default, min?, max?, step?,
//                 options?: [values], label?, group?, persist?: true }

import { clamp } from './rng.js';

export const CORE_SETTINGS_SCHEMA = {
  'audio.enabled':      { type: 'bool',   default: true,  label: 'SOUND', group: 'sound' },
  'audio.volume':       { type: 'number', default: 0.7, min: 0, max: 1, step: 0.01, label: 'VOLUME', group: 'sound' },
  'audio.space':        { type: 'number', default: 0.35, min: 0, max: 1, step: 0.01, label: 'SPACE', group: 'sound' },
  'music.enabled':      { type: 'bool',   default: false, label: 'MUSICAL MODE', group: 'music' },
  'music.tempo':        { type: 'number', default: 112, min: 40, max: 220, step: 1, label: 'TEMPO', group: 'music' },
  'music.quantize':     { type: 'bool',   default: true,  label: 'QUANTIZE TIME', group: 'music' },
  'music.subdivision':  { type: 'enum',   default: 4, options: [1, 2, 3, 4, 6, 8], label: 'SUBDIVISION', group: 'music' },
  'music.scale':        { type: 'enum',   default: 'pentatonic-minor', options: ['pentatonic-major', 'pentatonic-minor', 'major', 'minor', 'dorian', 'lydian', 'whole-tone', 'chromatic'], label: 'SCALE', group: 'music' },
  'music.root':         { type: 'number', default: 2, min: 0, max: 11, step: 1, label: 'ROOT', group: 'music' },
  'music.freePitch':    { type: 'bool',   default: false, label: 'FREE PITCH', group: 'music' },
  'grid.resolution':    { type: 'enum',   default: 'adaptive', options: ['coarse', 'standard', 'detailed', 'dense', 'adaptive'], label: 'GRID', group: 'visual' },
  'grid.cellAspect':    { type: 'enum',   default: 'square', options: ['square', 'stretch'], label: 'CELLS', group: 'visual' },
  'visual.intensity':   { type: 'number', default: 1.0, min: 0.1, max: 1.5, step: 0.01, label: 'INTENSITY', group: 'visual' },
  'visual.trails':      { type: 'number', default: 0.35, min: 0, max: 0.92, step: 0.01, label: 'TRAILS', group: 'visual' },
  'visual.animate':     { type: 'bool',   default: true,  label: 'ANIMATE', group: 'visual' },
  'a11y.reducedMotion': { type: 'bool',   default: false, label: 'REDUCED MOTION', group: 'a11y' },
  'a11y.reducedFlash':  { type: 'bool',   default: false, label: 'REDUCED FLASHING', group: 'a11y' },
  'a11y.largeUI':       { type: 'bool',   default: false, label: 'LARGE CONTROLS', group: 'a11y' },
  'ui.hidden':          { type: 'bool',   default: false, label: 'HIDE CONTROLS', group: 'ui' },
  'perf.quality':       { type: 'enum',   default: 'auto', options: ['auto', 'high', 'medium', 'low'], label: 'QUALITY', group: 'perf' },
  'perf.diagnostics':   { type: 'bool',   default: false, label: 'DIAGNOSTICS', group: 'perf' },
};

export class Settings {
  constructor({ storage, events, schema = CORE_SETTINGS_SCHEMA }) {
    this.storage = storage; this.events = events;
    this.schema = { ...schema };
    this.values = {};
    for (const [k, s] of Object.entries(this.schema)) this.values[k] = s.default;
    const saved = storage?.get('settings', null);
    if (saved && typeof saved === 'object') {
      for (const [k, v] of Object.entries(saved)) if (k in this.schema) this.values[k] = this.coerce(k, v);
    }
    this._subs = new Map();
  }

  defineSettings(namespace, schema) {
    const saved = this.storage?.get('settings', {}) || {};
    for (const [key, s] of Object.entries(schema)) {
      const full = `${namespace}.${key}`;
      if (this.schema[full]) throw new Error(`setting "${full}" already defined`);
      this.schema[full] = { ...s, group: s.group || namespace };
      this.values[full] = full in saved ? this.coerce(full, saved[full]) : s.default;
    }
  }

  coerce(key, v) {
    const s = this.schema[key];
    if (!s) return v;
    switch (s.type) {
      case 'bool': return !!v;
      case 'number': {
        const n = Number(v);
        if (!Number.isFinite(n)) return s.default;
        return clamp(n, s.min ?? -Infinity, s.max ?? Infinity);
      }
      case 'enum': return s.options.includes(v) ? v : s.default;
      case 'string': return typeof v === 'string' ? v.slice(0, 200) : s.default;
      default: return v;
    }
  }

  get(key) { return this.values[key]; }

  set(key, value) {
    if (!(key in this.schema)) throw new Error(`unknown setting "${key}"`);
    const v = this.coerce(key, value);
    if (this.values[key] === v) return v;
    this.values[key] = v;
    this._persist();
    this.events?.emit('settings:changed', { key, value: v });
    for (const fn of this._subs.get(key) || []) { try { fn(v, key); } catch (e) { console.error(e); } }
    return v;
  }

  toggle(key) { return this.set(key, !this.get(key)); }

  subscribe(key, fn) {
    if (!this._subs.has(key)) this._subs.set(key, new Set());
    this._subs.get(key).add(fn);
    return () => this._subs.get(key)?.delete(fn);
  }

  restoreDefaults({ keepGroups = [] } = {}) {
    for (const [k, s] of Object.entries(this.schema)) if (!keepGroups.includes(s.group)) this.set(k, s.default);
  }

  snapshot() { return { ...this.values }; }

  _persist() {
    if (!this.storage) return;
    clearTimeout(this._t);
    this._t = setTimeout(() => this.storage.set('settings', this.values), 150);
  }
}
