// Plugin manager: validates manifests, orders by dependency, runs the lifecycle with
// error isolation, and cleans up everything a plugin registered.
//
// Lifecycle (every stage optional):
//   register(api)          -> add registry entries (effects, shapes, sounds, ...)
//   init(api, config)      -> one-time setup with the merged config (defaults + saved)
//   activate(api)          -> start doing work (subscribe to events, schedule jobs)
//   ... responds through its event subscriptions / registered definitions ...
//   deactivate(api)        -> stop work; the manager ALSO auto-removes its subscriptions,
//                             scheduled jobs, timers and registry entries
//   dispose(api)           -> release anything else (called on removal)
//
// A failure in any stage marks the plugin 'failed', records diagnostics, rolls back its
// registrations, and never propagates — one broken extension cannot crash the app.

import { validateManifest } from '../extensions/manifest-schema.js';

export class PluginManager {
  constructor({ events, storage, makeScopedApi }) {
    this.events = events; this.storage = storage;
    this.makeScopedApi = makeScopedApi;   // (ownerId, plugin) => { api, cleanup() }
    this.plugins = new Map();             // id -> record
    this.disabled = new Set(storage?.get('extensions.disabled', []) || []);
  }

  // Accepts a plugin module object ({ manifest, register?, init?, activate?, ... }).
  add(plugin, { source = 'explicit' } = {}) {
    const m = plugin && plugin.manifest;
    const errors = validateManifest(m);
    const id = m?.id || `invalid-${this.plugins.size}`;
    if (this.plugins.has(id)) errors.push(`duplicate plugin id "${id}"`);
    for (const stage of ['register', 'init', 'activate', 'deactivate', 'dispose']) {
      if (plugin && plugin[stage] !== undefined && typeof plugin[stage] !== 'function') errors.push(`${stage} must be a function`);
    }
    const rec = {
      id, plugin, manifest: m, source, status: errors.length ? 'invalid' : 'added',
      errors: [...errors], scope: null, config: null, core: !!m?.core,
    };
    this.plugins.set(id, rec);
    if (errors.length) this._report(rec, 'validate', new Error(errors.join('; ')));
    return rec;
  }

  // Resolve dependency order; returns [records] or marks missing/cyclic deps as failed.
  _ordered() {
    const out = []; const state = new Map();
    const visit = (rec, stack) => {
      if (state.get(rec.id) === 2) return true;
      if (state.get(rec.id) === 1) { this._fail(rec, 'dependencies', new Error(`circular dependency: ${[...stack, rec.id].join(' -> ')}`)); return false; }
      state.set(rec.id, 1);
      for (const dep of rec.manifest?.dependencies || []) {
        const d = this.plugins.get(dep);
        if (!d) { this._fail(rec, 'dependencies', new Error(`missing dependency "${dep}"`)); state.set(rec.id, 2); return false; }
        if (!visit(d, [...stack, rec.id]) || d.status === 'failed' || d.status === 'invalid') {
          this._fail(rec, 'dependencies', new Error(`dependency "${dep}" is unavailable`)); state.set(rec.id, 2); return false;
        }
      }
      state.set(rec.id, 2); out.push(rec); return true;
    };
    for (const rec of this.plugins.values()) if (rec.status !== 'invalid') visit(rec, []);
    return out;
  }

  startAll() {
    for (const rec of this._ordered()) {
      if (rec.status === 'failed' || rec.status === 'invalid') continue;
      if (this.disabled.has(rec.id) && !rec.core) { rec.status = 'disabled'; continue; }
      this.start(rec.id);
    }
    this.events?.emit('plugins:changed', this.diagnostics());
  }

  start(id) {
    const rec = this.plugins.get(id);
    if (!rec || rec.status === 'invalid' || rec.status === 'active') return false;
    for (const dep of rec.manifest.dependencies || []) {
      if (this.plugins.get(dep)?.status !== 'active') { this._fail(rec, 'dependencies', new Error(`dependency "${dep}" is not active`)); return false; }
    }
    rec.errors = [];
    const { api, cleanup } = this.makeScopedApi(rec.id, rec);
    rec.scope = { api, cleanup };
    const saved = this.storage?.get(`ext.${rec.id}.config`, {}) || {};
    rec.config = { ...(rec.manifest.defaults || {}), ...saved };
    const p = rec.plugin;
    if (!this._stage(rec, 'register', () => p.register?.(api))) return false;
    if (!this._stage(rec, 'init', () => p.init?.(api, rec.config))) return false;
    if (!this._stage(rec, 'activate', () => p.activate?.(api))) return false;
    rec.status = 'active';
    return true;
  }

  stop(id, { dispose = false } = {}) {
    const rec = this.plugins.get(id);
    if (!rec || !rec.scope) return false;
    // Dependents go first.
    for (const other of this.plugins.values()) {
      if (other.status === 'active' && (other.manifest?.dependencies || []).includes(id)) this.stop(other.id, { dispose });
    }
    const api = rec.scope.api;
    if (rec.status === 'active') this._safe(rec, 'deactivate', () => rec.plugin.deactivate?.(api));
    if (dispose) this._safe(rec, 'dispose', () => rec.plugin.dispose?.(api));
    rec.scope.cleanup();
    rec.scope = null;
    if (rec.status !== 'failed') rec.status = 'stopped';
    return true;
  }

  setEnabled(id, enabled) {
    const rec = this.plugins.get(id);
    if (!rec) return false;
    if (enabled) { this.disabled.delete(id); if (rec.status !== 'active') { rec.status = 'stopped'; this.start(id); } }
    else { this.disabled.add(id); this.stop(id); rec.status = 'disabled'; }
    this.storage?.set('extensions.disabled', [...this.disabled]);
    this.events?.emit('plugins:changed', this.diagnostics());
    return true;
  }

  remove(id) { this.stop(id, { dispose: true }); return this.plugins.delete(id); }

  saveConfig(id, config) {
    const rec = this.plugins.get(id);
    if (!rec) return;
    rec.config = { ...rec.config, ...config };
    this.storage?.set(`ext.${id}.config`, rec.config);
  }

  _stage(rec, stage, fn) {
    try { fn(); return true; }
    catch (err) {
      this._fail(rec, stage, err);
      if (rec.scope) { try { rec.scope.cleanup(); } catch {} rec.scope = null; }
      return false;
    }
  }
  _safe(rec, stage, fn) { try { fn(); } catch (err) { this._report(rec, stage, err); } }
  _fail(rec, stage, err) { rec.status = 'failed'; this._report(rec, stage, err); }
  _report(rec, stage, err) {
    const msg = `${stage}: ${err && err.message ? err.message : err}`;
    rec.errors.push(msg);
    console.warn(`[plugin ${rec.id}] ${msg}`);
    this.events?.emit('plugin:error', { id: rec.id, stage, error: err });
  }

  // Called by the app when a plugin's runtime code (event handler, effect update) throws.
  reportRuntimeError(owner, err, where = 'runtime') {
    const rec = this.plugins.get(owner);
    if (!rec) return false;
    rec.runtimeErrors = (rec.runtimeErrors || 0) + 1;
    this._report(rec, where, err);
    if (rec.runtimeErrors >= 5 && !rec.core) {   // repeated failures: quarantine it
      this.stop(owner);
      rec.status = 'failed';
      rec.errors.push('quarantined after repeated runtime errors');
      this.events?.emit('plugins:changed', this.diagnostics());
    }
    return true;
  }

  diagnostics() {
    return [...this.plugins.values()].map((r) => ({
      id: r.id, name: r.manifest?.name || r.id, type: r.manifest?.type, version: r.manifest?.version,
      status: r.status, core: r.core, errors: [...r.errors], disabled: this.disabled.has(r.id),
    }));
  }
}
