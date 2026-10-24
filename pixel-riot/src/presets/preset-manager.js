// Preset manager: built-in + user presets, persistence, apply, import/export.
//
// Built-in presets live in a Registry (extensions can add more). User presets live in
// storage under 'presets.user' (an array of validated preset objects). The CURRENT
// instrument configuration is always `manager.current` (a validated preset object) and is
// persisted under 'presets.current' so a session resumes where it left off.
//
// Operations are deliberately separate and never destroy each other's data:
//   apply(preset)            change the instrument (artwork untouched)
//   saveCurrent(name)        new user preset from the current config
//   rename / duplicate / remove (user presets only; built-ins are read-only)
//   exportPreset / importPreset  JSON text, validated, data-only

import { Registry } from '../core/registry.js';
import { validatePreset, PRESET_FORMAT } from './preset-schema.js';

export class PresetManager {
  constructor({ events, storage, registries, applyFn }) {
    this.events = events; this.storage = storage; this.registries = registries;
    this.applyFn = applyFn;   // (validatedPreset) => void   (installed by the app)
    this.builtins = new Registry('presets', {
      events,
      validate: (d) => { const r = validatePreset(d, this.registries); return r.ok ? [] : r.errors; },
    });
    this.user = this._loadUser();
    this.current = null;
    this.currentSource = null;   // id of the preset the current config came from
  }

  _loadUser() {
    const raw = this.storage?.get('presets.user', []) || [];
    const out = [];
    for (const p of Array.isArray(raw) ? raw : []) {
      const r = validatePreset(p, this.registries);
      if (r.ok) out.push({ ...r.value, user: true });
    }
    return out;
  }
  _saveUser() { this.storage?.set('presets.user', this.user); this.events?.emit('presets:changed', {}); }

  list() {
    return [
      ...this.builtins.list().map((p) => ({ id: p.id, name: p.name, builtin: true })),
      ...this.user.map((p) => ({ id: p.id, name: p.name, builtin: false })),
    ];
  }
  get(id) { return this.user.find((p) => p.id === id) || this.builtins.get(id) || null; }

  // Validate and apply. Returns { ok, warnings, errors }.
  apply(preset, { source = preset?.id, persist = true } = {}) {
    const r = validatePreset(preset, this.registries);
    if (!r.ok) return r;
    this.current = r.value;
    this.currentSource = source;
    this.applyFn?.(r.value);
    if (persist) this.storage?.set('presets.current', { preset: r.value, source });
    this.events?.emit('preset:applied', { id: r.value.id, name: r.value.name, source, warnings: r.warnings });
    return r;
  }
  load(id) { const p = this.get(id); return p ? this.apply(p, { source: id }) : { ok: false, errors: [`no preset "${id}"`], warnings: [] }; }

  // Update a section of the current config (e.g. palette from the quick bar).
  patch(changes) {
    if (!this.current) return null;
    const next = { ...this.current, ...changes, look: { ...this.current.look, ...(changes.look || {}) }, chain: { ...this.current.chain, ...(changes.chain || {}) }, energy: { ...this.current.energy, ...(changes.energy || {}) } };
    return this.apply(next, { source: this.currentSource });
  }

  restoreSession() {
    const saved = this.storage?.get('presets.current', null);
    if (saved?.preset) { const r = this.apply(saved.preset, { source: saved.source }); if (r.ok) return true; }
    return false;
  }

  _uniqueId(base) {
    let id = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'preset';
    id = 'user.' + id;
    let n = 1, out = id;
    while (this.get(out)) out = `${id}-${++n}`;
    return out;
  }

  saveCurrent(name) {
    if (!this.current) return null;
    const nm = (name || `MY RIOT ${this.user.length + 1}`).toUpperCase().slice(0, 40);
    const p = { ...JSON.parse(JSON.stringify(this.current)), id: this._uniqueId(nm), name: nm, user: true };
    delete p.builtin;
    this.user.push(p); this._saveUser();
    this.currentSource = p.id;
    return p;
  }
  rename(id, name) {
    const p = this.user.find((q) => q.id === id); if (!p) return false;
    p.name = String(name || p.name).toUpperCase().slice(0, 40); this._saveUser(); return true;
  }
  duplicate(id) {
    const src = this.get(id); if (!src) return null;
    const nm = (src.name + ' COPY').slice(0, 40);
    const p = { ...JSON.parse(JSON.stringify(src)), id: this._uniqueId(nm), name: nm, user: true };
    delete p.builtin;
    this.user.push(p); this._saveUser(); return p;
  }
  remove(id) {
    const n = this.user.length;
    this.user = this.user.filter((p) => p.id !== id);
    if (this.user.length !== n) { this._saveUser(); return true; }
    return false;   // built-ins cannot be deleted
  }

  exportPreset(id) {
    const p = id ? this.get(id) : this.current;
    if (!p) return null;
    const { user, builtin, ...clean } = p; void user; void builtin;
    return JSON.stringify({ ...clean, format: PRESET_FORMAT }, null, 2);
  }
  importPreset(text) {
    let obj;
    try { obj = JSON.parse(text); } catch { return { ok: false, errors: ['not valid JSON'], warnings: [] }; }
    const r = validatePreset(obj, this.registries);
    if (!r.ok) return r;
    const p = { ...r.value, id: this._uniqueId(r.value.name), user: true };
    this.user.push(p); this._saveUser();
    return { ...r, value: p };
  }
}
