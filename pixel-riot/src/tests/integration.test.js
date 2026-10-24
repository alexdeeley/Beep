// Integration: the whole app booted headlessly (fake canvas, no audio), driven by
// synthetic gestures through the real pipeline. Plus presets, router, randomizer, undo.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDomStubs, fakeCanvas, memoryBackend, tick } from './helpers.js';
import { validatePreset, validateComposition } from '../presets/preset-schema.js';
import { BUILTIN_PRESETS } from '../presets/builtins.js';
import { randomizePreset } from '../presets/randomizer.js';
import { EXTENSIONS } from '../extensions/registry.js';

installDomStubs();
const { PixelRiot } = await import('../app.js');

const apps = [];
after(() => { for (const a of apps) a.dispose(); });

function boot(extensions = EXTENSIONS, backend = memoryBackend(), size = [390, 844]) {
  const canvas = fakeCanvas(...size);
  const timeRef = { t: 1000 };
  const app = new PixelRiot({ canvas, storageBackend: backend, extensions, now: () => timeRef.t });
  app._timeRef = timeRef; app._last = timeRef.t;
  apps.push(app);
  app.boot();
  tick(app, 2);
  return app;
}
const S = (app) => app.services;
const drag = (app, id, pts, frameMs = 16) => {
  const p = S(app).pointers; p.downAt(id, pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) { tick(app, 1, frameMs); p.moveTo(id, x, y); }
  p.upAt(id);
};

test('boot: all core packs and example extensions activate; renderer draws', () => {
  const app = boot();
  const bad = app.diagnostics().plugins.filter((p) => p.status !== 'active');
  assert.deepEqual(bad.map((p) => `${p.id}:${p.status}:${p.errors}`), []);
  assert.equal(app.rendererId, 'canvas2d');
  assert.ok(S(app).perf.counters.cellsDrawn > 0);
  assert.equal(S(app).presets.current.id, 'glass-grid');
  assert.deepEqual(app.errors, []);
});

test('a single gesture triggers multiple simultaneous effects; different pointers trigger different chains', () => {
  const app = boot();
  const fx = S(app).effects;
  S(app).pointers.downAt(1, 0.3, 0.3);   // press -> tap-burst (+ sounds; audio unavailable in Node)
  const afterPress = fx.list().map((e) => e.effectId);
  assert.ok(afterPress.includes('tap-burst'));
  tick(app, 3);
  S(app).pointers.upAt(1);               // tap -> ripple
  assert.ok(fx.list().some((e) => e.effectId === 'ripple-field'));
  // Two pointers dragging in different places at once.
  const P = S(app).pointers;
  P.downAt(2, 0.1, 0.8); P.downAt(3, 0.9, 0.2);
  for (let k = 1; k < 15; k++) { tick(app); P.moveTo(2, 0.1 + k * 0.03, 0.8); P.moveTo(3, 0.9, 0.2 + k * 0.03); }
  P.upAt(2); P.upAt(3);
  const trails = fx.list().filter((e) => e.effectId === 'energy-trail');
  assert.ok(trails.length > 10);
  tick(app, 300);
  assert.deepEqual(app.errors, []);
});

test('every gesture type routes to effects in every built-in effect set without errors', () => {
  const app = boot();
  const fired = new Set(); S(app).events.on('effect:spawned', (e) => fired.add(e.effectId));
  for (const prof of S(app).router.registry.list().filter((p) => p.cycle)) {
    S(app).presets.patch({ interaction: prof.id });
    const P = S(app).pointers;
    P.downAt(1, 0.5, 0.5); tick(app, 2); P.upAt(1); tick(app, 6); P.downAt(1, 0.51, 0.5); tick(app, 2); P.upAt(1);           // tap + double
    drag(app, 2, Array.from({ length: 12 }, (_, k) => [0.1 + k * 0.07, 0.4]), 8);                                               // swipe
    drag(app, 3, [...Array.from({ length: 10 }, (_, k) => [0.2 + k * 0.04, 0.6]), ...Array.from({ length: 10 }, (_, k) => [0.6 - k * 0.04, 0.6])]);   // reverse
    drag(app, 4, Array.from({ length: 70 }, (_, k) => [0.5 + Math.cos(k / 10) * 0.2, 0.5 + Math.sin(k / 10) * 0.12]));          // circle
    P.downAt(5, 0.3, 0.7); tick(app, 120); P.upAt(5);                                                                          // hold
    P.downAt(6, 0.45, 0.5); P.downAt(7, 0.55, 0.5);
    for (let k = 1; k < 20; k++) { tick(app); P.moveTo(6, 0.45 - k * 0.012, 0.5 - k * 0.004); P.moveTo(7, 0.55 + k * 0.012, 0.5 + k * 0.004); }
    P.downAt(8, 0.2, 0.2); P.upAt(8); P.upAt(6); P.upAt(7);                                                                    // spread/rotate/3 fingers
    for (let i = 0; i < 4; i++) { P.downAt(9, 0.5, 0.2); tick(app, 2); P.upAt(9); tick(app, 28); }                              // rhythm
    tick(app, 90);
  }
  for (const id of ['tap-burst', 'ripple-field', 'energy-trail', 'directional-sweep', 'color-cascade', 'cell-explosion', 'charge-field', 'radial-expansion', 'rotating-matrix', 'spiral-draw', 'flash-grid', 'symmetry-explosion', 'cellular-pulse', 'glitch-blocks', 'recursive-bloom', 'mirror-field', 'checkerboard-warp', 'particle-scatter', 'infinite-corridor']) {
    assert.ok(fired.has(id), `never fired: ${id}`);
  }
  assert.deepEqual(app.errors, []);
  assert.ok(app.diagnostics().gestures.circle >= 1, 'circle recognized');
  assert.ok(app.diagnostics().gestures.rhythm >= 1, 'rhythm recognized');
});

test('resource limits hold under sustained rapid input (effects, particles, scheduler)', () => {
  const app = boot();
  const P = S(app).pointers;
  S(app).presets.patch({ interaction: 'pulse' });
  for (let f = 0; f < 240; f++) {
    for (let id = 0; id < 5; id++) { P.downAt(100 + id, Math.random(), Math.random()); }
    tick(app); for (let id = 0; id < 5; id++) P.upAt(100 + id);
  }
  const st = S(app).perf.stats();
  assert.ok(st.effects <= 160, `effects ${st.effects}`);
  assert.ok(st.particles <= 2400);
  assert.ok(S(app).clock.scheduledCount <= 4000);
  assert.ok(S(app).chain.active <= 14);
  assert.deepEqual(app.errors, []);
});

test('undo restores artwork; clear/reset/restore-defaults do not destroy each other', () => {
  const app = boot();
  const g = S(app).grid;
  S(app).presets.patch({ interaction: 'riot' });
  const inkBefore = g.ink.reduce((a, b) => a + b, 0);
  app.pushUndo('gesture');   // what a real (non-synthetic) gesture start does
  drag(app, 1, Array.from({ length: 20 }, (_, k) => [0.1 + k * 0.04, 0.5]));
  tick(app, 5);
  const inkAfter = g.ink.reduce((a, b) => a + b, 0);
  assert.ok(inkAfter > inkBefore + 1);
  assert.ok(app.undo());
  assert.ok(Math.abs(g.ink.reduce((a, b) => a + b, 0) - inkBefore) < 1e-3);
  // Clear artwork keeps presets & settings; reset simulation keeps artwork.
  drag(app, 2, Array.from({ length: 10 }, (_, k) => [0.2, 0.1 + k * 0.05]));
  const saved = S(app).presets.saveCurrent('KEEP ME');
  S(app).settings.set('visual.trails', 0.6);
  app.resetSimulation();
  assert.ok(g.ink.some((v) => v > 0), 'reset simulation keeps art');
  assert.equal(S(app).effects.list().filter((e) => e.kind !== 'global').length, 0);
  app.clearArtwork();
  assert.ok(g.ink.every((v) => v === 0));
  assert.ok(S(app).presets.get(saved.id), 'clear keeps presets');
  assert.equal(S(app).settings.get('visual.trails'), 0.6, 'clear keeps settings');
  app.restoreDefaults();
  assert.ok(S(app).presets.get(saved.id), 'restore defaults keeps presets');
  assert.ok(app.undo(), 'clear is undoable');
});

test('canvas resize / orientation change resamples the grid without corrupting state', () => {
  const app = boot(EXTENSIONS, memoryBackend(), [390, 844]);
  const g = S(app).grid; const [c0, r0] = [g.cols, g.rows];
  drag(app, 1, Array.from({ length: 10 }, (_, k) => [0.2 + k * 0.05, 0.5]));
  const canvas = app.canvas; canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 844, height: 390 });
  app.resize(); tick(app, 30);
  assert.ok(g.cols > g.rows && c0 < r0, `landscape ${g.cols}x${g.rows}`);
  assert.equal(S(app).comp.count, g.count);
  assert.ok(g.ink.some((v) => v > 0), 'artwork survived rotation');
  for (const res of ['coarse', 'standard', 'detailed', 'dense', 'adaptive']) { S(app).settings.set('grid.resolution', res); tick(app, 5); }
  S(app).settings.set('grid.resolution', 'dense'); tick(app, 2);
  assert.equal(g.rows, 128);
  S(app).settings.set('grid.cellAspect', 'stretch'); tick(app, 2);
  assert.equal(g.cols, 128); assert.equal(g.rows, 128);
  assert.deepEqual(app.errors, []);
});

test('presets: every built-in validates without warnings and applies; persistence across sessions', () => {
  const backend = memoryBackend();
  const app = boot(EXTENSIONS, backend);
  for (const p of S(app).presets.list()) {
    const r = S(app).presets.load(p.id);
    assert.ok(r.ok, p.id); assert.deepEqual(r.warnings, [], `${p.id}: ${r.warnings}`);
    tick(app, 3);
  }
  assert.ok(BUILTIN_PRESETS.length >= 15);
  S(app).presets.load('hypnotic-spiral');
  const mine = S(app).presets.saveCurrent('MINE');
  assert.ok(S(app).presets.rename(mine.id, 'RENAMED'));
  const dup = S(app).presets.duplicate(mine.id);
  assert.ok(dup && dup.id !== mine.id);
  assert.ok(!S(app).presets.remove('glass-grid'), 'built-ins cannot be deleted');
  assert.ok(S(app).presets.remove(dup.id));
  // New session with the same storage.
  const app2 = boot(EXTENSIONS, backend);
  assert.equal(S(app2).presets.current.id, 'hypnotic-spiral');
  assert.ok(S(app2).presets.list().some((p) => p.name === 'RENAMED'));
});

test('preset + composition import validation rejects malformed data and never runs code', () => {
  const app = boot();
  const regs = S(app).presets.registries;
  assert.equal(validatePreset(null, regs).ok, false);
  assert.equal(validatePreset({ version: 99 }, regs).ok, false);
  assert.equal(validatePreset({ format: 'something-else' }, regs).ok, false);
  const r = validatePreset({ name: 'X', palette: 'nope', shapes: ['square', 'ghost'], pattern: { a: { id: 'noise', params: { scale: 2, evil: '() => alert(1)', __proto__: { x: 1 }, nested: { deep: 1 } } } }, look: { patternGain: 99 }, ambient: [{ effect: 'unknown' }] }, regs);
  assert.ok(r.ok); assert.equal(r.value.palette, 'white-electric'); assert.deepEqual(r.value.shapes, ['square']);
  assert.equal(r.value.look.patternGain, 1.2); assert.equal(r.value.ambient.length, 0);
  assert.ok(!('nested' in r.value.pattern.a.params));
  assert.equal(typeof r.value.pattern.a.params.evil, 'string');
  assert.ok(r.warnings.length >= 3);
  const bad = S(app).presets.importPreset('{not json');
  assert.equal(bad.ok, false);
  const exp = S(app).presets.exportPreset('glass-grid');
  const imp = S(app).presets.importPreset(exp);
  assert.ok(imp.ok && imp.value.id.startsWith('user.'));
  // Composition round trip including artwork.
  drag(app, 1, Array.from({ length: 10 }, (_, k) => [0.1 + k * 0.08, 0.3]));
  const text = app.exportComposition();
  const inkSum = S(app).grid.ink.reduce((a, b) => a + b, 0);
  app.clearArtwork();
  const res = app.importComposition(text);
  assert.ok(res.ok, res.errors?.join());
  assert.ok(Math.abs(S(app).grid.ink.reduce((a, b) => a + b, 0) - inkSum) < 1e-3);
  assert.equal(validateComposition({ format: 'pixel-riot-composition', version: 1, preset: {}, art: { cols: 2, rows: 2, paint: '!!', shape: '', ink: '' } }, regs).ok, false);
  assert.equal(app.importComposition('{"format":"pixel-riot-composition","version":7}').ok, false);
});

test('randomizer: strengths change appropriately and locks are respected', () => {
  const app = boot();
  const cur = S(app).presets.current; const regs = S(app).presets.registries; const rng = S(app).rng;
  for (let strength = 1; strength <= 4; strength++) {
    for (let k = 0; k < 15; k++) {
      const locks = new Set(['palette', 'interaction']);
      const p = randomizePreset(cur, { strength, locks, rng, registries: regs });
      assert.equal(p.palette, cur.palette); assert.equal(p.interaction, cur.interaction);
      const v = validatePreset(p, regs); assert.ok(v.ok); assert.deepEqual(v.warnings, [], v.warnings.join());
      if (strength === 1) assert.equal(p.pattern.a.id, cur.pattern.a.id);
    }
  }
  const r = app.randomize(4); assert.ok(r.ok); tick(app, 10);
  assert.deepEqual(app.errors, []);
});

test('router: rules, $bindings, throttles, global profiles; mappings editable as data', () => {
  const app = boot();
  const router = S(app).router; const spawned = [];
  S(app).events.on('effect:spawned', (e) => spawned.push(e.effectId));
  router.registry.register({ id: 'test.p', rules: [
    { on: 'press', when: { region: { x0: 0, y0: 0, x1: 0.5, y1: 1 } }, do: [{ effect: 'flash-grid' }] },
    { on: 'press', when: { region: { x0: 0.5, y0: 0, x1: 1, y1: 1 } }, do: [{ effect: 'glitch-blocks' }] },
    { on: 'drag', throttle: 10, do: [{ effect: 'spiral-draw' }] },
    { on: 'hold:charge', do: [{ effect: 'charge-field', key: 'gesture', params: { level: '$level' } }] },
  ] }, 'test');
  router.setProfile('test.p');
  const P = S(app).pointers;
  P.downAt(1, 0.2, 0.5); P.upAt(1); P.downAt(2, 0.8, 0.5); P.upAt(2);
  assert.deepEqual(spawned.slice(0, 2), ['flash-grid', 'glitch-blocks']);
  drag(app, 3, Array.from({ length: 20 }, (_, k) => [0.1 + k * 0.04, 0.5]));
  assert.equal(spawned.filter((x) => x === 'spiral-draw').length, 1, 'throttled');
  P.downAt(4, 0.5, 0.5); tick(app, 80);
  const charge = S(app).effects.instances.find((i) => i.effectId === 'charge-field');
  assert.ok(charge && charge.state.level > 0.3, 'level bound from event');
  P.upAt(4);
  // zigzag example is a global profile: works while 'test.p' is active.
  drag(app, 5, [[0.3, 0.5], [0.5, 0.5], [0.3, 0.5], [0.5, 0.5], [0.3, 0.5], [0.5, 0.5], [0.3, 0.5]], 30);
  assert.ok(app.diagnostics().gestures.zigzag >= 1, 'zigzag recognized');
  assert.ok(spawned.includes('glitch-blocks'));
});

test('extension isolation: broken extensions are contained; others keep working; disable cleans up', () => {
  const broken = { manifest: { id: 'test.broken', name: 'Broken', version: '1.0.0', description: '', type: 'effect', apiVersion: '1.0.0' }, register() { throw new Error('register exploded'); } };
  const runtime = {
    manifest: { id: 'test.runtime', name: 'Runtime bomb', version: '1.0.0', description: '', type: 'experimental', apiVersion: '1.0.0' },
    register(api) {
      api.effects.register({ id: 'test.bomb', spawn() {}, update() { throw new Error('bomb'); } });
      api.events.on('gesture:press', () => api.effects.spawn('test.bomb'));
      api.events.on('gesture:tap', () => { throw new Error('listener bomb'); });
    },
  };
  const future = { manifest: { id: 'test.future', name: 'Future', version: '1.0.0', description: '', type: 'effect', apiVersion: '2.0.0' } };
  const dependsOnBroken = { manifest: { id: 'test.dep', name: 'Dep', version: '1.0.0', description: '', type: 'effect', apiVersion: '1.0.0', dependencies: ['test.broken'] } };
  const app = boot([...EXTENSIONS, broken, runtime, future, dependsOnBroken]);
  const d = Object.fromEntries(app.diagnostics().plugins.map((p) => [p.id, p]));
  assert.equal(d['test.broken'].status, 'failed'); assert.match(d['test.broken'].errors.join(), /register exploded/);
  assert.equal(d['test.future'].status, 'invalid');
  assert.equal(d['test.dep'].status, 'failed');
  assert.equal(d['test.runtime'].status, 'active');
  const P = S(app).pointers;
  for (let i = 0; i < 6; i++) { P.downAt(i, 0.5, 0.5); tick(app, 2); P.upAt(i); tick(app, 2); }
  const rt = app.diagnostics().plugins.find((p) => p.id === 'test.runtime');
  assert.equal(rt.status, 'failed', 'quarantined after repeated runtime errors');
  assert.ok(!S(app).effects.registry.has('test.bomb'), 'its registrations were removed');
  assert.ok(S(app).effects.registry.has('tap-burst'), 'core unaffected');
  // Disable / enable an example extension cleanly.
  S(app).pluginManager.setEnabled('ex.lissajous', false);
  assert.ok(!S(app).effects.registry.has('ex.lissajous'));
  assert.equal(S(app).pluginManager.plugins.get('ex.preset-sunset-hive').status, 'stopped', 'dependents stop too');
  S(app).pluginManager.setEnabled('ex.lissajous', true);
  assert.ok(S(app).effects.registry.has('ex.lissajous'));
});

test('reduced flashing and reduced motion are honoured by the renderer inputs', () => {
  const app = boot();
  S(app).settings.set('a11y.reducedFlash', true); S(app).settings.set('a11y.reducedMotion', true);
  tick(app);
  assert.equal(app.ectx.a11y.reducedFlash, true); assert.equal(app.ectx.a11y.reducedMotion, true);
  assert.equal(app._frameDesc.settings.reducedFlash, true);
  const inst = S(app).effects.spawn('flash-grid', {}, { x: 0.5, y: 0.5 });
  tick(app, 3);
  assert.ok(Math.max(...S(app).comp.flash) <= 0.3, 'flash level reduced');
  void inst;
});

test('performance monitor: adaptive quality steps down under slow frames and caps scale', () => {
  const app = boot();
  const pm = S(app).perf;
  for (let s = 0; s < 8; s++) for (let f = 0; f < 20; f++) pm.frame(0.05, s);
  assert.notEqual(pm.level, 'high');
  tick(app, 61);
  assert.ok(S(app).effects.capScale < 1);
  assert.ok(S(app).particles.limit < 2400);
});
