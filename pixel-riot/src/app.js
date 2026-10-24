// PIXEL RIOT — application assembly.
//
// This file wires the services together and owns the frame loop. It contains NO effect,
// sound, pattern or gesture logic: those live in their modules and are registered through
// packs/plugins. To add features, use the extension zones (see EXTENSION_GUIDE.md) —
// you should not need to edit this file.

import { APP_NAME, RESOLUTIONS, ADAPTIVE_STEPS, LIMITS } from './config.js';
import { EventBus } from './core/event-bus.js';
import { Registry } from './core/registry.js';
import { Storage, bytesToBase64, base64ToBytes } from './core/storage.js';
import { Settings } from './core/settings.js';
import { Clock } from './core/clock.js';
import { Rng } from './core/rng.js';
import { PerformanceMonitor } from './core/performance-monitor.js';
import { PluginManager } from './core/plugin-manager.js';
import { History } from './core/history.js';
import { createApiFactory } from './core/api.js';
import { CORE_PACKS } from './core/builtin-packs.js';
import { GridModel } from './grid/grid-model.js';
import { EnergyField } from './grid/energy-field.js';
import * as space from './grid/spatial-query.js';
import { CoordinateMapper } from './input/coordinate-mapper.js';
import { GestureRecognizerHost } from './input/gesture-recognizer.js';
import { PointerManager } from './input/pointer-manager.js';
import { PaletteEngine } from './color/palette-registry.js';
import { createShapeRegistry } from './rendering/shape-registry.js';
import { PatternEngine } from './patterns/pattern-registry.js';
import { Compositor } from './rendering/compositing.js';
import { ParticleSystem } from './rendering/particles.js';
import { validateRenderer } from './rendering/renderer-interface.js';
import { EffectManager } from './effects/effect-manager.js';
import { ChainReactions } from './effects/chain-reaction.js';
import coreEffectsPack from './effects/builtins/index.js';
import { AudioEngine } from './audio/audio-engine.js';
import coreAudioPack from './audio/builtins.js';
import coreUiPack from './ui/panels.js';
import { TapTempo } from './audio/music.js';
import { InteractionRouter } from './interaction/router.js';
import { Looper } from './interaction/looper.js';
import { PresetManager } from './presets/preset-manager.js';
import { randomizePreset } from './presets/randomizer.js';
import { COMPOSITION_FORMAT, PRESET_VERSION, validateComposition } from './presets/preset-schema.js';
import { need } from './core/registry.js';

// ============================================================
// EXTENSION ZONE: OPTIONAL MODULE REGISTRATION
// PURPOSE: Optional extensions are imported and listed in src/extensions/registry.js.
// CONTRACT: Each entry is a plugin module { manifest, register?, init?, activate?,
//           deactivate?, dispose? } — see EXTENSION_GUIDE.md and manifest-schema.js.
// SAFETY: Entries are validated; a failing extension is isolated and reported in
//         SETTINGS > EXTENSIONS, never crashing the app.
// INTEGRATION: Add your module to the EXTENSIONS array in src/extensions/registry.js.
//              Do NOT add imports here.
// ============================================================
import { EXTENSIONS } from './extensions/registry.js';

export class PixelRiot {
  constructor({ canvas, storageBackend = undefined, extensions = EXTENSIONS, now = () => performance.now() } = {}) {
    this.canvas = canvas;
    this.now = now;
    this.extensionList = extensions;
    const s = (this.services = {});
    s.app = this;
    s.events = new EventBus();
    s.storage = storageBackend !== undefined ? new Storage(storageBackend) : new Storage();
    s.settings = new Settings({ storage: s.storage, events: s.events });
    s.rng = new Rng();
    s.clock = new Clock({ events: s.events });
    s.perf = new PerformanceMonitor({ events: s.events });
    s.grid = new GridModel(32, 32);
    s.mapper = new CoordinateMapper(s.grid);
    s.palettes = new PaletteEngine({ events: s.events, rng: s.rng });
    s.shapes = createShapeRegistry(s.events);
    s.patterns = new PatternEngine({ grid: s.grid, events: s.events, rng: s.rng });
    s.comp = new Compositor(s.grid.count);
    s.particles = new ParticleSystem(LIMITS.maxParticles);
    s.energy = new EnergyField({ grid: s.grid, clock: s.clock, events: s.events });
    s.chain = new ChainReactions({ grid: s.grid, clock: s.clock, events: s.events, rng: s.rng, getDefaults: () => s.presets?.current?.chain || {} });
    s.renderers = new Registry('renderers', { events: s.events, validate: validateRenderer });
    s.systems = new Registry('systems', { events: s.events, validate: (d) => { const e = []; need.fn(d, 'update', e); need.optFn(d, 'draw', e); return e; } });
    s.panels = new Registry('uiPanels', { events: s.events, validate: (d) => { const e = []; need.fn(d, 'render', e); need.str(d, 'title', e); return e; } });
    s.history = new History({ depth: LIMITS.undoDepth });
    this.errors = [];

    // Effect context: one object, refreshed per frame (no per-call allocation).
    this.look = { patternGain: 0.42, cellScale: 0.92, gap: 0.86, hueBias: 0, rotateCells: 0, symmetry: 'quad' };
    this.ectx = {
      grid: s.grid, energy: s.energy, comp: s.comp, particles: s.particles, palettes: s.palettes, shapes: s.shapes,
      clock: s.clock, rng: s.rng, space, chain: s.chain,
      spawn: (id, params, opts) => s.effects.spawn(id, params, opts),
      emit: (t, p) => s.events.emit(t, p),
      look: this.look, a11y: { reducedMotion: false, reducedFlash: false }, intensity: 1,
    };
    s.effects = new EffectManager({ events: s.events, makeContext: () => this.ectx, onError: (err, info) => this._runtimeError(err, info.owner, `effect ${info.effectId}`) });

    s.recognizers = new GestureRecognizerHost({ events: s.events, mapper: s.mapper, grid: s.grid, clock: s.clock, now, onError: (err, id, owner) => this._runtimeError(err, owner, `recognizer ${id}`) });
    s.pointers = new PointerManager({ element: canvas, mapper: s.mapper, host: s.recognizers, events: s.events, now });
    s.recognizers.pointerSource = () => s.pointers.pointers;
    s.recognizers.groupSource = () => s.pointers.groupId;

    s.audio = new AudioEngine({ events: s.events, clock: s.clock, settings: s.settings, grid: s.grid });
    s.router = new InteractionRouter({ events: s.events, effects: s.effects, audio: s.audio, energy: s.energy, clock: s.clock, settings: s.settings });
    s.looper = new Looper({ events: s.events, clock: s.clock, pointers: s.pointers });
    s.tapTempo = new TapTempo();

    s.presets = new PresetManager({
      events: s.events, storage: s.storage,
      registries: { palettes: s.palettes.registry, patterns: s.patterns.registry, shapes: s.shapes, interactions: s.router.registry, effects: s.effects.registry, energyBehaviors: s.energy.behaviors },
      applyFn: (p) => this._applyPreset(p),
    });
    s.allRegistries = () => [s.shapes, s.palettes.registry, s.patterns.registry, s.effects.registry, s.energy.behaviors,
      s.recognizers.registry, s.audio.generators, s.audio.sounds, s.audio.mappings, s.router.registry, s.presets.builtins,
      s.renderers, s.systems, s.panels];

    const factory = createApiFactory(s);
    s.pluginManager = new PluginManager({ events: s.events, storage: s.storage, makeScopedApi: factory });
    this.makeScopedApi = factory;

    s.events.onError = (err, info) => this._runtimeError(err, info.owner, `event ${info.type}`);
    s.events.on('app:error', (e) => this._recordError(e));

    this.shapeSet = [];
    this.shapeMode = 'band';
    this.renderer = null; this.rendererId = null;
    this.running = false; this._raf = 0; this._last = 0;
    this.adaptiveN = 32;
    this.cssW = 1; this.cssH = 1; this.dpr = 1;
    this._ambient = [];
  }

  get api() { return this._coreApi; }

  // ---------------------------------------------------------------- boot
  boot() {
    const s = this.services;
    const pm = s.pluginManager;
    for (const p of [...CORE_PACKS, coreEffectsPack, coreAudioPack, coreUiPack]) pm.add(p, { source: 'core' });
    for (const ext of this.extensionList || []) pm.add(ext, { source: 'extension' });
    pm.startAll();

    // The app's own API handle (used by core UI); not a plugin, never auto-removed.
    this._coreApi = this.makeScopedApi('core.app', { config: {} }).api;

    s.router.attach();
    this._wireInput();
    this._wireSettings();

    // Renderer.
    const wanted = s.storage.get('renderer', 'canvas2d');
    if (!this.setRenderer(wanted)) this.setRenderer('canvas2d');

    // Instrument + artwork from the last session (or the default preset).
    if (!s.presets.restoreSession()) s.presets.load('glass-grid');
    this.resize(true);
    this._restoreArt();
    s.events.emit('app:ready', { name: APP_NAME });
    return this;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = this.now();
    const loop = (t) => { if (!this.running) return; this._raf = requestAnimationFrame(loop); this.frame(t); };
    this._raf = requestAnimationFrame(loop);
    this._onVis = () => { if (!document.hidden) this._last = this.now(); else this._saveArtSoon(0); };
    document.addEventListener('visibilitychange', this._onVis);
  }
  stop() { this.running = false; if (this._raf) cancelAnimationFrame(this._raf); if (this._onVis) document.removeEventListener('visibilitychange', this._onVis); }

  // Full teardown: stops the loop, every plugin (their timers/subscriptions), input and audio.
  dispose() {
    const s = this.services;
    this.stop();
    clearTimeout(this._artT);
    s.looper.stop();
    for (const id of [...s.pluginManager.plugins.keys()].reverse()) s.pluginManager.stop(id, { dispose: true });
    s.pointers.detach(); s.router.detach();
    s.clock.clearScheduled();
    try { s.audio.stopAll(); s.audio.ac?.close?.(); } catch {}
    this.renderer?.dispose?.();
  }

  // ---------------------------------------------------------------- input
  _wireInput() {
    const s = this.services;
    s.pointers.attach();
    s.events.on('pointer:down', (p) => {
      if (p.synthetic) return;
      s.audio.unlock();                       // user gesture: allowed to start audio
      if (s.pointers.activeCount() === 1) this.pushUndo('gesture');
    });
    s.events.on('pointer:up', (p) => { if (!p.synthetic) this._saveArtSoon(); });
    s.events.on('perf:resolution-hint', ({ direction }) => this._adaptResolution(direction));
    s.events.on('perf:quality', () => this._applyQuality());
  }

  _wireSettings() {
    const s = this.services, st = s.settings;
    const sync = () => {
      this.ectx.a11y.reducedMotion = st.get('a11y.reducedMotion');
      this.ectx.a11y.reducedFlash = st.get('a11y.reducedFlash');
      this.ectx.intensity = st.get('visual.intensity');
      s.clock.tempo = st.get('music.tempo');
      s.clock.subdivision = st.get('music.subdivision');
      s.clock.musical = st.get('music.enabled');
      s.perf.setRequested(st.get('perf.quality') === 'auto' ? 'auto' : st.get('perf.quality'));
      s.perf.adaptiveResolution = st.get('grid.resolution') === 'adaptive';
      s.audio.applySettings();
      this._applyQuality();
    };
    sync();
    s.events.on('settings:changed', ({ key }) => {
      sync();
      if (key === 'grid.resolution' || key === 'grid.cellAspect') this.resize(true);
      if (key === 'audio.enabled' && st.get('audio.enabled')) s.audio.unlock();
    });
    // Respect the OS reduced-motion preference on first run.
    try {
      if (!s.storage.get('settings', null) && globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        st.set('a11y.reducedMotion', true); st.set('a11y.reducedFlash', true);
      }
    } catch {}
  }

  _applyQuality() {
    const s = this.services; const q = s.perf.quality;
    s.particles.setLimit(LIMITS.maxParticles * q.particleScale);
    s.effects.capScale = q.effectScale;
    this.patternEvery = q.patternEvery;
  }

  // ---------------------------------------------------------------- preset application
  _applyPreset(p) {
    const s = this.services;
    s.palettes.setActive(p.palette);
    s.patterns.set('a', p.pattern.a.id, p.pattern.a.params);
    s.patterns.set('b', p.pattern.b ? p.pattern.b.id : null, p.pattern.b?.params || {});
    s.patterns.setBlend(p.pattern.blend, p.pattern.mix);
    s.patterns.speed = p.pattern.speed ?? 1;
    this.shapeSet = p.shapes.map((id) => s.shapes.get(id)).filter(Boolean);
    if (!this.shapeSet.length) this.shapeSet = [s.shapes.get('square')];
    this.shapeMode = p.shapeMode;
    Object.assign(this.look, p.look);
    s.router.setProfile(p.interaction);
    s.energy.setBehavior(p.energy.behavior);
    Object.assign(s.energy.params, { decay: p.energy.decay, spread: p.energy.spread });
    // Ambient (global) effects: replace the previous preset's set.
    for (const inst of this._ambient) s.effects.cancel(inst);
    this._ambient = p.ambient.map((a) => s.effects.spawn(a.effect, a.params, { key: `ambient:${a.effect}` })).filter(Boolean);
    if (p.music?.tempo) s.settings.set('music.tempo', p.music.tempo);
    if (p.music?.scale) { try { s.settings.set('music.scale', p.music.scale); } catch {} }
    if (p.music?.root != null) s.settings.set('music.root', p.music.root);
    if (p.trails != null) s.settings.set('visual.trails', p.trails);
  }

  // ---------------------------------------------------------------- renderer
  setRenderer(id) {
    const s = this.services; const def = s.renderers.get(id);
    if (!def) return false;
    try {
      if (def.supported && !def.supported()) throw new Error('not supported on this device');
      this.renderer?.dispose?.();
      def.init(this.canvas, { palettes: s.palettes, shapes: s.shapes, events: s.events });
      this.renderer = def; this.rendererId = id;
      s.storage.set('renderer', id);
      if (this.cssW > 1) def.resize(this.cssW, this.cssH, this.dpr);
      s.events.emit('renderer:changed', { id });
      return true;
    } catch (err) {
      this._recordError({ error: err, source: `renderer ${id}` });
      if (id !== 'canvas2d') return this.setRenderer('canvas2d');
      return false;
    }
  }

  // ---------------------------------------------------------------- sizing
  _gridSize(w, h) {
    const st = this.services.settings;
    const res = st.get('grid.resolution');
    let N = res === 'adaptive' ? this.adaptiveN : RESOLUTIONS[res] || 32;
    if (st.get('grid.cellAspect') === 'stretch') return [N, N];
    const short = Math.min(w, h), long = Math.max(w, h);
    const L = Math.max(N, Math.round((N * long) / short));
    return w >= h ? [L, N] : [N, L];
  }

  resize(force = false) {
    const s = this.services;
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    if (!force && w === this.cssW && h === this.cssH && dpr === this.dpr) return;
    if (force && s.settings.get('grid.resolution') === 'adaptive' && !this._adaptiveInit) {
      this._adaptiveInit = true;
      const cores = globalThis.navigator?.hardwareConcurrency || 4;
      const target = Math.min(w, h) / (cores >= 8 ? 16 : 20);
      this.adaptiveN = ADAPTIVE_STEPS.reduce((best, n) => (Math.abs(n - target) < Math.abs(best - target) ? n : best), 32);
      this.adaptiveN = Math.min(64, Math.max(24, this.adaptiveN));
    }
    this.cssW = w; this.cssH = h; this.dpr = dpr;
    s.mapper.setRect(r.left, r.top, w, h);
    s.particles.aspect = w / h;
    const [cols, rows] = this._gridSize(w, h);
    if (s.grid.setSize(cols, rows, { preserve: true })) {
      s.energy.resized(); s.patterns.resized(); s.comp.resize(s.grid.count);
      s.chain.stopAll(); s.effects.cancelAll({ keepGlobal: true });
      s.events.emit('grid:resized', { cols, rows });
    }
    this.renderer?.resize(w, h, dpr);
  }

  _adaptResolution(direction) {
    const i = ADAPTIVE_STEPS.indexOf(this.adaptiveN);
    const next = ADAPTIVE_STEPS[Math.max(0, Math.min(ADAPTIVE_STEPS.length - 1, (i < 0 ? 2 : i) + direction))];
    if (next === this.adaptiveN || (direction > 0 && next > 96)) return;
    this.adaptiveN = next;
    this.resize(true);
  }

  // ---------------------------------------------------------------- frame
  frame(nowMs) {
    const s = this.services, st = s.settings, g = s.grid;
    const realDt = Math.max(0, (nowMs - this._last) / 1000);
    this._last = nowMs;
    s.perf.frame(realDt, s.clock.time);
    const dt = s.clock.tick(realDt);
    s.recognizers.frame(dt);
    const animate = st.get('visual.animate');

    if ((s.clock.frame % (this.patternEvery || 1)) === 0) s.patterns.update(dt * (this.patternEvery || 1), animate);
    s.palettes.update(dt, animate);
    s.energy.update(dt);
    // Transient decays.
    const fk = Math.exp(-dt * 7);
    for (let i = 0; i < g.count; i++) if (g.flash[i] > 0.002) g.flash[i] *= fk; else g.flash[i] = 0;
    if ((s.clock.frame & 15) === 0) { const ik = Math.exp(-dt * 16 * 0.006); for (let i = 0; i < g.count; i++) g.ink[i] *= ik; }

    s.comp.beginFrame();
    s.effects.update(dt);
    // ============================================================
    // EXTENSION ZONE: MATHEMATICAL / GENERATIVE SYSTEMS
    // PURPOSE: Per-frame simulations acting on the grid (attractors, automata, orbits).
    // CONTRACT: { id, update(dt, ctx), draw?(g, ctx) } — ctx is the EffectContext (see effect-interface.js).
    // SAFETY: Bounded work per frame; a throwing system is unregistered and reported.
    // INTEGRATION: api.systems.register(def). Example: src/extensions/examples/orbit-system.js. Do not edit this loop.
    // ============================================================
    for (const sys of s.systems.list()) {
      try { sys.update(dt, this.ectx); }
      catch (err) { this._runtimeError(err, s.systems.owner(sys.id), `system ${sys.id}`); s.systems.unregister(sys.id); }
    }
    s.particles.update(dt, s.mapper.short / this.cssW, s.mapper.short / this.cssH);

    if (this.renderer) {
      const overlays = this._overlays || (this._overlays = [(gfx) => s.effects.drawAll(gfx), (gfx) => { for (const sys of s.systems.list()) if (sys.draw) { try { sys.draw(gfx, this.ectx); } catch (err) { this._runtimeError(err, s.systems.owner(sys.id), `system ${sys.id} draw`); } } }]);
      this._frameDesc = this._frameDesc || {};
      const f = Object.assign(this._frameDesc, {
        grid: g, comp: s.comp, palette: s.palettes, shapeSet: this.shapeSet, shapeMode: this.shapeMode, particles: s.particles,
        overlays, look: this.look, time: s.clock.time, dt,
        settings: { intensity: st.get('visual.intensity'), trails: st.get('visual.trails'), reducedMotion: st.get('a11y.reducedMotion'), reducedFlash: st.get('a11y.reducedFlash') },
        onOverlayError: (err) => this._recordError({ error: err, source: 'overlay' }),
      });
      try {
        const out = this.renderer.render(f);
        s.perf.set('cellsDrawn', out?.cellsDrawn || 0);
      } catch (err) {
        this._recordError({ error: err, source: `renderer ${this.rendererId}` });
        if (this.rendererId !== 'canvas2d') this.setRenderer('canvas2d');
      }
    }
    s.perf.set('effects', s.effects.count);
    s.perf.set('voices', s.audio.activeVoices);
    s.perf.set('particles', s.particles.count);
    s.perf.set('scheduled', s.clock.scheduledCount);
    s.perf.set('cols', g.cols); s.perf.set('rows', g.rows);
    s.perf.set('chains', s.chain.active);
  }

  // ---------------------------------------------------------------- commands (used by UI)
  pushUndo(label) { this.services.history.push({ label, ...this.services.grid.snapshotArt() }); this.services.events.emit('history:changed', { length: this.services.history.length }); }
  undo() {
    const s = this.services; const snap = s.history.pop();
    if (!snap) return false;
    s.grid.restoreArt(snap);
    s.energy.resized(); s.patterns.resized(); s.comp.resize(s.grid.count);
    s.effects.cancelAll({ keepGlobal: true });
    s.events.emit('history:changed', { length: s.history.length });
    this._saveArtSoon();
    return true;
  }
  clearArtwork() { this.pushUndo('clear'); this.services.grid.clearArt(); this.services.grid.clearMemory(); this._saveArtSoon(); this.services.events.emit('art:cleared', {}); }
  resetSimulation() {
    const s = this.services;
    s.effects.cancelAll({ keepGlobal: true }); s.chain.stopAll(); s.particles.clear(); s.energy.clear(); s.grid.resetSimulation();
    s.clock.clearScheduled(); s.looper.stop(); s.audio.stopAll(); s.recognizers.reset();
    s.events.emit('simulation:reset', {});
  }
  restoreDefaults() { this.services.settings.restoreDefaults(); this.services.events.emit('settings:restored', {}); }
  randomize(strength = 2, locks = new Set()) {
    const s = this.services;
    const next = randomizePreset(s.presets.current, { strength, locks, rng: s.rng, registries: s.presets.registries });
    return s.presets.apply(next, { source: null });
  }
  cycle(section, dir = 1) {
    const s = this.services; const cur = s.presets.current; if (!cur) return null;
    const rot = (ids, id) => ids[(ids.indexOf(id) + dir + ids.length) % ids.length];
    if (section === 'palette') return s.presets.patch({ palette: rot(s.palettes.registry.ids(), cur.palette) });
    if (section === 'pattern') return s.presets.patch({ pattern: { ...cur.pattern, a: { id: rot(s.patterns.registry.ids(), cur.pattern.a.id), params: {} } } });
    if (section === 'interaction') {
      const ids = s.router.registry.list().filter((p) => p.cycle).map((p) => p.id);
      return s.presets.patch({ interaction: rot(ids, cur.interaction) });
    }
    if (section === 'preset') { const ids = s.presets.list().map((p) => p.id); return s.presets.load(rot(ids, s.presets.currentSource || ids[0])); }
    return null;
  }
  tapTempo() { const bpm = this.services.tapTempo.tap(this.now() / 1000); if (bpm) this.services.settings.set('music.tempo', bpm); return bpm; }
  async snapshotPNG() { return this.renderer?.snapshot ? this.renderer.snapshot() : null; }

  // ---------------------------------------------------------------- artwork persistence
  _artPayload() {
    const g = this.services.grid;
    const u8 = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    return { cols: g.cols, rows: g.rows, paint: bytesToBase64(u8(g.paint)), shape: bytesToBase64(u8(g.shape)), ink: bytesToBase64(u8(g.ink)) };
  }
  _loadArtPayload(a) {
    const g = this.services.grid;
    const f32 = (b64, n) => { const b = base64ToBytes(b64); if (b.length !== n * 4) throw new Error('art size mismatch'); return new Float32Array(b.buffer); };
    const n = a.cols * a.rows;
    const snap = { cols: a.cols, rows: a.rows, arrays: { paint: f32(a.paint, n), shape: base64ToBytes(a.shape), ink: f32(a.ink, n) } };
    if (snap.arrays.shape.length !== n) throw new Error('art size mismatch');
    for (let i = 0; i < n; i++) { if (!Number.isFinite(snap.arrays.paint[i])) snap.arrays.paint[i] = -1; const v = snap.arrays.ink[i]; snap.arrays.ink[i] = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0; }
    g.restoreArt(snap);
    this.services.energy.resized(); this.services.patterns.resized(); this.services.comp.resize(g.count);
  }
  _saveArtSoon(ms = 1200) {
    clearTimeout(this._artT);
    this._artT = setTimeout(() => { try { this.services.storage.set('art', this._artPayload()); } catch (e) { this._recordError({ error: e, source: 'art save' }); } }, ms);
  }
  _restoreArt() {
    const a = this.services.storage.get('art', null);
    if (!a) return;
    try { this._loadArtPayload(a); } catch (e) { this._recordError({ error: e, source: 'art restore' }); }
  }

  exportComposition() {
    const s = this.services;
    return JSON.stringify({ format: COMPOSITION_FORMAT, version: PRESET_VERSION, app: APP_NAME, created: new Date().toISOString(), preset: s.presets.current, art: this._artPayload() });
  }
  importComposition(text) {
    const s = this.services;
    let obj; try { obj = JSON.parse(text); } catch { return { ok: false, errors: ['not valid JSON'] }; }
    const r = validateComposition(obj, s.presets.registries);
    if (!r.ok) return r;
    this.pushUndo('import');
    s.presets.apply(r.value.preset, { source: null });
    if (r.value.art) { try { this._loadArtPayload(r.value.art); this._saveArtSoon(0); } catch (e) { return { ok: false, errors: [e.message] }; } }
    return r;
  }

  // ---------------------------------------------------------------- errors
  _runtimeError(err, owner, where) {
    if (owner && owner !== 'core' && !String(owner).startsWith('core.')) this.services.pluginManager.reportRuntimeError(owner, err, where);
    this._recordError({ error: err, source: where, owner });
  }
  _recordError(e) {
    const msg = `${e.source || 'error'}: ${e.error?.message || e.error}`;
    this.errors.push({ t: Date.now(), msg });
    if (this.errors.length > 30) this.errors.shift();
    console.warn('[pixel-riot]', msg, e.error);
    this.services.events.emit('diagnostics:error', { msg });
  }

  diagnostics() {
    const s = this.services;
    return {
      perf: s.perf.stats(), audio: s.audio.state, voicesPlayed: s.audio.played, renderer: this.rendererId,
      grid: { cols: s.grid.cols, rows: s.grid.rows }, plugins: s.pluginManager.diagnostics(), errors: this.errors.slice(-10),
      gestures: { ...s.recognizers.counts }, effectsSpawned: s.effects.spawned, actions: s.router.actionsRun,
      storagePersistent: s.storage.persistent, history: s.history.length, looper: s.looper.state,
    };
  }
}
