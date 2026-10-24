// Public application API (API_VERSION 1.x) — the ONLY surface extensions should use.
//
// The plugin manager gives every plugin its own SCOPED api object: everything it
// registers, subscribes to, schedules or times is tagged with the plugin id and removed
// automatically when the plugin is stopped, disabled or fails.
//
//   api.meta          { name, version, apiVersion, pluginId }
//   api.events        on(type, fn) -> off, once, off, emit
//   api.clock         time, dt, frame, tempo, beatPosition(), beatPhase(), secondsPerBeat(),
//                     after(seconds, fn) -> job, cancel(job), setTempo(bpm)
//   api.input         pointers() (read-only snapshot), recognizers.register(def), inject.{down,move,up}
//   api.grid          cols, rows, count, index(gx,gy), inBounds(gx,gy), view() -> GridModel (hot path)
//   api.energy        inject(fx, fy, amount, radius), injectLine(...), at(gx, gy), behaviors.register(def),
//                     setBehavior(id), params
//   api.effects       register(def), spawn(id, params, opts), cancel(inst), count(), list()
//   api.shapes        register(def), get(id), list()
//   api.patterns      register(def), list(), set(slot, id, params)
//   api.palettes      register(def), list(), setActive(id), style(t, b), rgb(t)
//   api.audio         generators.register, sounds.register, mappings.register,
//                     play(soundId, mapResult, opts), map(mappingId, ev), sustain/update/release,
//                     state, music: { scales, ... }
//   api.interactions  register(profile), setProfile(id), active(), handle(type, ev)
//   api.presets       register(builtinPreset), list(), load(id), current(), patch(changes)
//   api.settings      get(key), set(key, value), subscribe(key, fn), define(schema) (namespaced 'ext.<pluginId>')
//   api.performance   stats(), quality(), addOptimizer(fn)
//   api.renderers     register(def), setActive(id), active()
//   api.systems       register(def)  — per-frame generative/mathematical systems
//   api.particles     emit(opts), burst(x, y, n, opts)
//   api.ui            panels.register(def), toast(text)
//   api.rng           seeded Rng (next, range, int, pick, weighted, chance)
//   api.timers        setTimeout(fn, ms), setInterval(fn, ms), clear(id)   (auto-cleared)
//   api.config        the plugin's merged config; api.saveConfig(partial)

import { APP_NAME, APP_VERSION, API_VERSION } from '../config.js';
import { SCALES, NOTE_NAMES, degreeToMidi, midiToFreq, normToMidi } from '../audio/music.js';

export function createApiFactory(s) {
  // s = services bag assembled by the app.
  return function makeScopedApi(owner, rec) {
    const bus = s.events.scope(owner);
    const timers = new Set();
    const reg = (registry) => (def) => registry.register(def, owner);
    const guard = (fn, where) => (...args) => {
      try { return fn(...args); }
      catch (err) { s.pluginManager.reportRuntimeError(owner, err, where); return undefined; }
    };

    const api = {
      meta: { name: APP_NAME, version: APP_VERSION, apiVersion: API_VERSION, pluginId: owner },
      events: {
        on: (type, fn) => bus.on(type, guard(fn, `event ${type}`)),
        once: (type, fn) => bus.once(type, guard(fn, `event ${type}`)),
        off: bus.off, emit: bus.emit,
      },
      clock: {
        get time() { return s.clock.time; }, get dt() { return s.clock.dt; }, get frame() { return s.clock.frame; },
        get tempo() { return s.clock.tempo; },
        beatPosition: () => s.clock.beatPosition(), beatPhase: () => s.clock.beatPhase(), secondsPerBeat: () => s.clock.secondsPerBeat(),
        after: (sec, fn) => s.clock.after(sec, guard(fn, 'clock job'), owner),
        cancel: (job) => s.clock.cancel(job),
        setTempo: (bpm) => s.settings.set('music.tempo', bpm),
      },
      input: {
        pointers: () => s.pointers.list().map((p) => ({ id: p.id, x: p.x, y: p.y, vx: p.vx, vy: p.vy, pointerType: p.pointerType, synthetic: p.synthetic })),
        recognizers: { register: reg(s.recognizers.registry), list: () => s.recognizers.registry.list() },
        inject: {
          down: (id, x, y) => s.pointers.downAt(id, x, y, { pointerType: 'synthetic', synthetic: true }),
          move: (id, x, y) => s.pointers.moveTo(id, x, y),
          up: (id) => s.pointers.upAt(id),
        },
      },
      grid: {
        get cols() { return s.grid.cols; }, get rows() { return s.grid.rows; }, get count() { return s.grid.count; },
        index: (gx, gy) => s.grid.index(gx, gy), inBounds: (gx, gy) => s.grid.inBounds(gx, gy),
        view: () => s.grid,
      },
      energy: {
        inject: (fx, fy, a, r) => s.energy.inject(fx, fy, a, r), injectLine: (...a) => s.energy.injectLine(...a),
        at: (gx, gy) => s.energy.at(gx, gy),
        behaviors: { register: reg(s.energy.behaviors), list: () => s.energy.behaviors.list() },
        setBehavior: (id) => s.energy.setBehavior(id), get params() { return s.energy.params; },
      },
      effects: {
        register: reg(s.effects.registry), list: () => s.effects.registry.list(),
        spawn: (id, params, opts) => s.effects.spawn(id, params, opts),
        cancel: (inst) => s.effects.cancel(inst), count: () => s.effects.count,
        active: () => s.effects.list(),
      },
      shapes: { register: reg(s.shapes), get: (id) => s.shapes.get(id), list: () => s.shapes.list() },
      patterns: { register: reg(s.patterns.registry), list: () => s.patterns.registry.list(), set: (slot, id, p) => s.patterns.set(slot, id, p) },
      palettes: {
        register: reg(s.palettes.registry), list: () => s.palettes.registry.list(),
        setActive: (id) => s.presets.patch({ palette: id }), style: (t, b) => s.palettes.style(t, b), rgb: (t) => s.palettes.rgb(t),
      },
      audio: {
        generators: { register: reg(s.audio.generators), list: () => s.audio.generators.list() },
        sounds: { register: reg(s.audio.sounds), list: () => s.audio.sounds.list() },
        mappings: { register: reg(s.audio.mappings), list: () => s.audio.mappings.list() },
        play: (id, m, o) => s.audio.play(id, m, o), map: (mid, ev) => s.audio.map(mid, ev),
        sustain: (id, m, key) => s.audio.sustain(id, m, `${owner}:${key}`), update: (key, m) => s.audio.update(`${owner}:${key}`, m),
        release: (key, sec) => s.audio.release(`${owner}:${key}`, sec),
        get state() { return s.audio.state; }, get voices() { return s.audio.activeVoices; },
        music: { SCALES, NOTE_NAMES, degreeToMidi, midiToFreq, normToMidi },
      },
      interactions: {
        register: reg(s.router.registry), list: () => s.router.registry.list(),
        setProfile: (id) => s.presets.patch({ interaction: id }), active: () => s.router.activeId,
        handle: (type, ev) => s.router.handle(type, ev),
      },
      presets: {
        register: reg(s.presets.builtins), list: () => s.presets.list(), load: (id) => s.presets.load(id),
        current: () => (s.presets.current ? JSON.parse(JSON.stringify(s.presets.current)) : null),
        patch: (ch) => s.presets.patch(ch),
      },
      settings: {
        get: (k) => s.settings.get(k), set: (k, v) => s.settings.set(k, v),
        subscribe: (k, fn) => { const off = s.settings.subscribe(k, guard(fn, `setting ${k}`)); timers.add({ off }); return off; },
        define: (schema) => { const ns = `ext.${owner}`; if (!Object.keys(schema).every((k) => s.settings.schema[`${ns}.${k}`])) s.settings.defineSettings(ns, schema); return ns; },
      },
      performance: {
        stats: () => s.perf.stats(), quality: () => s.perf.level,
        addOptimizer: (fn) => { const g = guard(fn, 'optimizer'); s.perf.optimizers.push(g); timers.add({ off: () => { s.perf.optimizers = s.perf.optimizers.filter((x) => x !== g); } }); },
      },
      renderers: { register: reg(s.renderers), setActive: (id) => s.app.setRenderer(id), active: () => s.app.rendererId, list: () => s.renderers.list() },
      systems: { register: reg(s.systems), list: () => s.systems.list() },
      particles: { emit: (o) => s.particles.emit(o), burst: (x, y, n, o) => s.particles.burst(x, y, n, o) },
      ui: { panels: { register: reg(s.panels), list: () => s.panels.list() }, toast: (t) => s.events.emit('ui:toast', { text: String(t).slice(0, 120) }) },
      // User-level commands (what the on-screen controls do). Safe for UI panels.
      commands: {
        undo: () => s.app.undo(), clearArtwork: () => s.app.clearArtwork(), resetSimulation: () => s.app.resetSimulation(),
        restoreDefaults: () => s.app.restoreDefaults(), randomize: (strength, locks) => s.app.randomize(strength, locks),
        cycle: (section, dir) => s.app.cycle(section, dir), tapTempo: () => s.app.tapTempo(),
        snapshotPNG: () => s.app.snapshotPNG(), exportComposition: () => s.app.exportComposition(), importComposition: (t) => s.app.importComposition(t),
        saveCurrentPreset: (name) => s.presets.saveCurrent(name), renamePreset: (id, n) => s.presets.rename(id, n), duplicatePreset: (id) => s.presets.duplicate(id),
        deletePreset: (id) => s.presets.remove(id), exportPreset: (id) => s.presets.exportPreset(id), importPreset: (t) => s.presets.importPreset(t),
        currentPresetSource: () => s.presets.currentSource,
        looper: { record: (bars) => s.looper.record(bars), stop: () => s.looper.stop(), get state() { return s.looper.state; } },
        plugins: { list: () => s.pluginManager.diagnostics(), setEnabled: (id, on) => s.pluginManager.setEnabled(id, on) },
        diagnostics: () => s.app.diagnostics(),
        historyLength: () => s.history.length,
      },
      rng: s.rng,
      timers: {
        setTimeout: (fn, ms) => { const h = { id: setTimeout(guard(fn, 'timer'), ms) }; h.off = () => clearTimeout(h.id); timers.add(h); return h; },
        setInterval: (fn, ms) => { const h = { id: setInterval(guard(fn, 'interval'), ms) }; h.off = () => clearInterval(h.id); timers.add(h); return h; },
        clear: (h) => { if (h) { h.off(); timers.delete(h); } },
      },
      get config() { return rec?.config || {}; },
      saveConfig: (partial) => s.pluginManager.saveConfig(owner, partial),
    };

    const cleanup = () => {
      bus.dispose();
      for (const h of timers) { try { h.off(); } catch {} }
      timers.clear();
      s.clock.cancelOwner(owner);
      for (const r of s.allRegistries()) r.unregisterOwner(owner);
      s.effects.cancelWhere((i) => i.owner === owner);
    };
    return { api, cleanup };
  };
}
