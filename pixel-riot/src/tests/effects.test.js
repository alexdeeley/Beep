// Grid, energy, compositor, effects scheduler, chain reactions, palettes, patterns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../core/event-bus.js';
import { Clock } from '../core/clock.js';
import { Rng } from '../core/rng.js';
import { GridModel } from '../grid/grid-model.js';
import { EnergyField, BUILTIN_ENERGY_BEHAVIORS, ENERGY_MAX } from '../grid/energy-field.js';
import { forRadius, forLine, mirrorPoints } from '../grid/spatial-query.js';
import { Compositor } from '../rendering/compositing.js';
import { ParticleSystem } from '../rendering/particles.js';
import { EffectManager } from '../effects/effect-manager.js';
import { ChainReactions } from '../effects/chain-reaction.js';
import { BUILTIN_EFFECTS } from '../effects/builtins/index.js';
import { PaletteEngine, buildTable } from '../color/palette-registry.js';
import { BUILTIN_PALETTES } from '../color/palettes.js';
import { PatternEngine } from '../patterns/pattern-registry.js';
import { BUILTIN_PATTERNS } from '../patterns/builtins.js';
import { BUILTIN_SHAPES, createShapeRegistry } from '../rendering/shape-registry.js';
import * as space from '../grid/spatial-query.js';
import { fakeContext2D } from './helpers.js';

test('grid: indexing, resize preserves artwork by resampling, reset keeps art', () => {
  const g = new GridModel(4, 4);
  g.paint[g.index(3, 3)] = 0.7; g.ink[g.index(0, 0)] = 1; g.energy[5] = 1;
  g.setSize(8, 8);
  assert.equal(g.count, 64);
  assert.ok(Math.abs(g.paint[g.index(7, 7)] - 0.7) < 1e-6); assert.ok(Math.abs(g.paint[g.index(6, 6)] - 0.7) < 1e-6);
  assert.equal(g.ink[g.index(0, 0)], 1);
  assert.equal(g.energy[5], 0, 'transient state is not resampled');
  g.energy[3] = 1; g.resetSimulation();
  assert.equal(g.energy[3], 0); assert.equal(g.ink[0], 1);
  const snap = g.snapshotArt(); g.clearArt(); assert.equal(g.ink[0], 0);
  g.restoreArt(snap); assert.equal(g.ink[0], 1);
});

test('spatial queries: radius, line, mirror', () => {
  const g = new GridModel(10, 10); const seen = [];
  assert.equal(forRadius(g, 5, 5, 1, (i) => seen.push(i)), 4);
  const line = []; forLine(g, 0, 0, 9, 3, (i, x, y) => line.push([x, y]));
  assert.deepEqual(line[0], [0, 0]); assert.deepEqual(line.at(-1), [9, 3]); assert.equal(line.length, 10);
  assert.equal(mirrorPoints(g, 1, 2, 'quad').length, 4);
  assert.equal(mirrorPoints(g, 1, 1, 'none').length, 1);
});

test('energy: inject, bounded, decays to zero with every behavior, dirty region shrinks', () => {
  for (const b of BUILTIN_ENERGY_BEHAVIORS) {
    const events = new EventBus(); const g = new GridModel(30, 30); const clock = new Clock();
    const e = new EnergyField({ grid: g, clock, events });
    for (const x of BUILTIN_ENERGY_BEHAVIORS) e.behaviors.register(x);
    e.setBehavior(b.id);
    for (let k = 0; k < 20; k++) e.inject(15, 15, 5, 2);
    assert.ok(Math.max(...g.energy) <= ENERGY_MAX);
    assert.ok(e.region);
    for (let f = 0; f < 600; f++) { clock.tick(1 / 60); e.update(1 / 60); }
    assert.ok(e.total < 0.05, `${b.id} total ${e.total}`);
  }
});

test('compositor: additive channels, max flash, colour priority', () => {
  const c = new Compositor(4);
  c.add('bright', 0, 0.3); c.add('bright', 0, 0.4); assert.ok(Math.abs(c.bright[0] - 0.7) < 1e-6);
  c.max('flash', 1, 0.5); c.max('flash', 1, 0.3); assert.equal(c.flash[1], 0.5);
  c.setColor(2, 0.1, 0.5, 1); c.setColor(2, 0.9, 1, 0); assert.ok(Math.abs(c.colorT[2] - 0.1) < 1e-6);
  c.setColor(2, 0.4, 0.9, 1); assert.ok(Math.abs(c.colorT[2] - 0.4) < 1e-6);
  c.beginFrame(); assert.equal(c.bright[0], 0); assert.equal(c.colorW[2], 0);
});

function effectRig() {
  const events = new EventBus(); const g = new GridModel(32, 48); const clock = new Clock({ events }); const rng = new Rng(7);
  const energy = new EnergyField({ grid: g, clock, events }); for (const b of BUILTIN_ENERGY_BEHAVIORS) energy.behaviors.register(b);
  const comp = new Compositor(g.count); const particles = new ParticleSystem(500);
  const palettes = new PaletteEngine({ events, rng }); for (const p of BUILTIN_PALETTES) palettes.registry.register(p); palettes.setActive('spectrum', { immediate: true }); palettes.update(0);
  const shapes = createShapeRegistry(events); for (const s of BUILTIN_SHAPES) shapes.register(s);
  const chain = new ChainReactions({ grid: g, clock, events, rng });
  const errors = [];
  let mgr;
  const ctx = { grid: g, energy, comp, particles, palettes, shapes, clock, rng, space, chain, spawn: (...a) => mgr.spawn(...a), emit: (t, p) => events.emit(t, p), look: { symmetry: 'quad' }, a11y: { reducedMotion: false, reducedFlash: false }, intensity: 1 };
  mgr = new EffectManager({ events, makeContext: () => ctx, onError: (err, info) => errors.push([info.effectId, err.message]) });
  for (const e of BUILTIN_EFFECTS) mgr.registry.register(e, 'core.effects');
  const step = (n = 1) => { for (let i = 0; i < n; i++) { clock.tick(1 / 60); energy.update(1 / 60); comp.beginFrame(); mgr.update(1 / 60); particles.update(1 / 60, 1, 0.6); } };
  return { g, clock, comp, mgr, step, errors, chain, particles, events, ctx };
}

test('every built-in effect spawns, updates, draws and expires without errors', () => {
  const r = effectRig();
  const ov = { width: 400, height: 600, unit: 400, cols: 32, rows: 48, color: () => '#fff', shape: () => {}, line: () => {}, ring: () => {}, cell: () => {} };
  const ev = { x: 0.4, y: 0.5, speed: 2, direction: 0.5, velocityX: 1, velocityY: 0.5, pressure: 0.7, level: 0.8, scale: 1.5, rotation: 0.6, clockwise: false, angularVelocity: 8, cells: [{ i: 10, gx: 10, gy: 0 }, { i: 11, gx: 11, gy: 0 }], duration: 0.4 };
  for (const e of BUILTIN_EFFECTS) {
    const inst = r.mgr.spawn(e.id, {}, { event: ev });
    assert.ok(inst, `${e.id} spawned`);
  }
  for (let f = 0; f < 120; f++) { r.step(); r.mgr.drawAll(ov); }
  assert.deepEqual(r.errors, []);
  // Local effects expire; global (ambient) effects remain until cancelled.
  r.step(60 * 9);
  const left = r.mgr.instances.filter((i) => !i.done);
  assert.ok(left.every((i) => i.kind === 'global'), left.map((i) => i.effectId).join(','));
  r.mgr.cancelAll(); r.step();
  assert.equal(r.mgr.count, 0);
});

test('effect scheduler: per-effect cap, global cap, lifetime cap, keyed retrigger', () => {
  const r = effectRig();
  for (let i = 0; i < 100; i++) r.mgr.spawn('tap-burst', {}, { x: Math.random(), y: Math.random() });
  assert.ok(r.mgr.instances.filter((i) => i.effectId === 'tap-burst' && !i.done).length <= 30);
  r.mgr.capScale = 0.1;   // quality scaling -> cap 16
  for (const e of ['ripple-field', 'energy-trail', 'mirror-field', 'particle-scatter']) for (let i = 0; i < 40; i++) r.mgr.spawn(e);
  r.step();
  assert.ok(r.mgr.count <= 16, `count ${r.mgr.count}`);
  const a = r.mgr.spawn('charge-field', { level: 0.2 }, { key: 'g1' });
  const b = r.mgr.spawn('charge-field', { level: 0.6 }, { key: 'g1' });
  assert.equal(a, b); assert.equal(a.state.level, 0.6);
  const long = r.mgr.spawn('ripple-field', { life: 9999 });
  assert.ok(long.life <= 30);
});

test('effect error isolation: a throwing effect is cancelled and reported', () => {
  const r = effectRig();
  r.mgr.registry.register({ id: 'bad', spawn() {}, update(inst) { if (inst.age > 0.05) throw new Error('kaboom'); } }, 'ext.bad');
  r.mgr.spawn('bad'); r.mgr.spawn('tap-burst');
  r.step(10);
  assert.deepEqual(r.errors.map((e) => e[0]), ['bad']);
  assert.ok(!r.mgr.instances.some((i) => i.effectId === 'bad'));
});

test('chain reactions are bounded and stop by themselves', () => {
  const r = effectRig(); let acts = 0;
  for (let k = 0; k < 30; k++) r.chain.start({ gx: 16, gy: 24, params: { probability: 1, maxDepth: 50, decay: 0.98, radius: 2 }, onActivate: () => acts++ });
  assert.ok(r.chain.active <= 14);
  r.step(60 * 6);
  assert.equal(r.chain.active, 0);
  assert.ok(acts > 0 && acts < 14 * 24 * 220);
});

test('particles: pool is bounded and recycles', () => {
  const p = new ParticleSystem(100); p.setLimit(50);
  for (let i = 0; i < 500; i++) p.emit({ x: 0.5, y: 0.5, life: 5 });
  p.update(0.01, 1, 1);
  assert.ok(p.count <= 50);
});

test('palettes: every built-in validates; transitions interpolate smoothly; style cache', () => {
  const events = new EventBus(); const pe = new PaletteEngine({ events, rng: new Rng(1) });
  for (const p of BUILTIN_PALETTES) pe.registry.register(p);
  assert.ok(BUILTIN_PALETTES.length >= 13);
  pe.setActive('mono-white', { immediate: true }); pe.update(0);
  const before = pe.rgb(0)[2];
  pe.setActive('red-black-white'); pe.update(0.2);
  const mid = pe.rgb(0)[2];
  pe.update(2);
  const after = pe.rgb(0)[2];
  assert.ok(before > mid && mid > after, `${before} ${mid} ${after}`);
  assert.match(pe.style(0.3, 0.5), /^rgb\(/);
  assert.equal(buildTable(['#000000', '#ffffff']).length, 768);
  pe.setActive('harmony'); pe.update(1);
  assert.match(pe.style(0.1, 1), /^rgb\(\d+,\d+,\d+\)$/);
});

test('patterns: all built-ins register and stay within 0..1; layering and errors', () => {
  const events = new EventBus(); const g = new GridModel(24, 40);
  const pe = new PatternEngine({ grid: g, events, rng: new Rng(3) });
  for (const p of BUILTIN_PATTERNS) pe.registry.register(p);
  assert.ok(BUILTIN_PATTERNS.length >= 16);
  for (const p of BUILTIN_PATTERNS) {
    pe.set('a', p.id); pe.set('b', 'noise'); pe.setBlend('xor', 0.6);
    for (let f = 0; f < 5; f++) pe.update(0.1);
    for (const v of g.base) assert.ok(v >= 0 && v <= 1 && Number.isFinite(v), `${p.id} out of range: ${v}`);
  }
  pe.registry.register({ id: 'bad', fill() { throw new Error('x'); } }, 'ext');
  pe.set('a', 'bad'); pe.update(0.1);
  assert.equal(pe.layers.a.id, 'checker', 'falls back to checker');
});

test('shapes: 25 built-ins draw on a 2D context in fill and stroke modes', () => {
  const ctx = fakeContext2D();
  assert.ok(BUILTIN_SHAPES.length >= 25);
  for (const s of BUILTIN_SHAPES) { s.draw(ctx, 10, 10, 12, { fill: true, stroke: false, phase: 1 }); s.draw(ctx, 10, 10, 12, { fill: false, stroke: true, lineWidth: 2, phase: 0 }); }
  const c = ctx.__counts; assert.ok((c.fill || 0) + (c.fillRect || 0) + (c.stroke || 0) + (c.strokeRect || 0) > 25);
});
