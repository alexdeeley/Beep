// Input: coordinate mapping, pointer normalization, multitouch tracking, gesture recognition.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../core/event-bus.js';
import { Clock } from '../core/clock.js';
import { GridModel } from '../grid/grid-model.js';
import { CoordinateMapper } from '../input/coordinate-mapper.js';
import { GestureRecognizerHost } from '../input/gesture-recognizer.js';
import { PointerManager } from '../input/pointer-manager.js';
import { BUILTIN_RECOGNIZERS, T } from '../input/recognizers.js';
import { GESTURE_TYPES } from '../input/gesture-events.js';

function rig({ w = 400, h = 800 } = {}) {
  let now = 1000;
  const events = new EventBus(); const grid = new GridModel(20, 40); const clock = new Clock({ events });
  const mapper = new CoordinateMapper(grid); mapper.setRect(0, 0, w, h);
  const host = new GestureRecognizerHost({ events, mapper, grid, clock, now: () => now });
  // Fresh recognizer state per rig (they keep module-level state).
  for (const r of BUILTIN_RECOGNIZERS) { r.reset?.(); host.registry.register(r); }
  const pm = new PointerManager({ element: null, mapper, host, events, now: () => now });
  host.pointerSource = () => pm.pointers; host.groupSource = () => pm.groupId;
  const got = [];
  events.on('gesture:*', (e, type) => got.push({ ...e, type: type.slice(8) }));
  const advance = (ms) => { now += ms; host.frame(ms / 1000); };
  return { events, grid, mapper, host, pm, got, advance, types: () => got.map((g) => g.type), get now() { return now; } };
}

test('coordinate mapper: normalized, grid and unit measures', () => {
  const g = new GridModel(10, 20); const m = new CoordinateMapper(g); m.setRect(100, 50, 200, 400);
  assert.deepEqual(m.normalize(200, 250), { x: 0.5, y: 0.5 });
  assert.deepEqual(m.normalize(-500, 9999), { x: 0, y: 1 });
  const c = m.toGrid(0.55, 0.999); assert.equal(c.gridX, 5); assert.equal(c.gridY, 19);
  assert.equal(m.unitsX(1), 1); assert.equal(m.unitsY(1), 2);   // short side = width
});

test('gesture events carry the full schema', () => {
  const r = rig();
  r.pm.downAt(1, 0.5, 0.5); r.advance(50); r.pm.upAt(1);
  const tap = r.got.find((e) => e.type === 'tap');
  for (const k of ['pointerId', 'x', 'y', 'gridX', 'gridY', 'fx', 'fy', 'cellIndex', 'velocityX', 'velocityY', 'speed', 'direction', 'dirName', 'pressure', 'pressureSupported', 'pointerType', 'timestamp', 'time', 'duration', 'activePointerCount', 'gestureId', 'groupId', 'modifiers', 'synthetic']) assert.ok(k in tap, `missing ${k}`);
  assert.equal(tap.pressure, 0.5); assert.equal(tap.pressureSupported, false);
  assert.ok(Object.keys(GESTURE_TYPES).includes('tap'));
});

test('press fires immediately; tap and double tap; repeated taps need no cooldown', () => {
  const r = rig();
  r.pm.downAt(1, 0.3, 0.3);
  assert.deepEqual(r.types(), ['press']);
  r.advance(60); r.pm.upAt(1);
  r.advance(120); r.pm.downAt(2, 0.31, 0.3); r.advance(60); r.pm.upAt(2);
  assert.equal(r.types().filter((t) => t === 'tap').length, 2);
  assert.ok(r.types().includes('doubletap'));
  for (let i = 0; i < 5; i++) { r.advance(400); r.pm.downAt(10 + i, 0.8, 0.8); r.advance(40); r.pm.upAt(10 + i); }
  assert.equal(r.types().filter((t) => t === 'press').length, 7);
});

test('rhythm: evenly spaced taps estimate tempo', () => {
  const r = rig();
  for (let i = 0; i < 5; i++) { r.pm.downAt(i, 0.5, 0.5); r.advance(30); r.pm.upAt(i); r.advance(470); }
  const rh = r.got.filter((e) => e.type === 'rhythm');
  assert.ok(rh.length >= 1);
  assert.ok(Math.abs(rh.at(-1).bpm - 120) <= 2, `bpm ${rh.at(-1).bpm}`);
});

test('drag: gap-free cell path during fast moves, swipe on fast release', () => {
  const r = rig();
  r.pm.downAt(1, 0.05, 0.5);
  r.advance(16); r.pm.moveTo(1, 0.1, 0.5);
  r.advance(16); r.pm.moveTo(1, 0.9, 0.5);   // jump across most of the grid in one sample
  r.advance(16); r.pm.upAt(1);
  const drags = r.got.filter((e) => e.type === 'drag');
  const cells = drags.flatMap((d) => d.cells.map((c) => c.gx));
  for (let x = Math.min(...cells); x <= Math.max(...cells); x++) assert.ok(cells.includes(x), `gap at ${x}`);
  assert.ok(r.types().includes('drag:start'));
  assert.ok(r.types().includes('drag:end'));
  assert.ok(r.types().includes('swipe'));
  assert.ok(!r.types().includes('tap'));
});

test('drag reversal detected', () => {
  const r = rig();
  r.pm.downAt(1, 0.2, 0.5);
  for (let k = 1; k <= 10; k++) { r.advance(16); r.pm.moveTo(1, 0.2 + k * 0.03, 0.5); }
  for (let k = 1; k <= 10; k++) { r.advance(16); r.pm.moveTo(1, 0.5 - k * 0.03, 0.5); }
  r.pm.upAt(1);
  assert.ok(r.types().includes('drag:reverse'));
});

test('circle: tolerant loop detection with direction', () => {
  const r = rig({ w: 400, h: 400 });
  r.pm.downAt(1, 0.7, 0.5);
  for (let k = 1; k <= 60; k++) { const a = (k / 50) * Math.PI * 2; r.advance(16); r.pm.moveTo(1, 0.5 + Math.cos(a) * 0.2 + (k % 3) * 0.002, 0.5 + Math.sin(a) * 0.2); }
  r.pm.upAt(1);
  const c = r.got.find((e) => e.type === 'circle');
  assert.ok(c, 'circle detected'); assert.equal(c.clockwise, true); assert.ok(c.angularVelocity > 0);
});

test('long press: start, charge levels rise, release with level', () => {
  const r = rig();
  r.pm.downAt(1, 0.5, 0.5);
  for (let i = 0; i < 60; i++) r.advance(50);
  r.pm.upAt(1);
  const charges = r.got.filter((e) => e.type === 'hold:charge').map((e) => e.level);
  assert.ok(r.types().includes('hold:start'));
  assert.ok(charges.length > 10 && charges.at(-1) > charges[0]);
  const rel = r.got.find((e) => e.type === 'hold:release');
  assert.ok(rel.level > 0.9);
  assert.ok(!r.types().includes('tap'));
});

test('multitouch: independent pointers, pinch, rotate, spread, count, end', () => {
  const r = rig({ w: 400, h: 400 });
  for (let id = 1; id <= 5; id++) r.pm.downAt(id, 0.1 * id, 0.2);
  assert.equal(r.pm.activeCount(), 5);
  const presses = r.got.filter((e) => e.type === 'press');
  assert.equal(new Set(presses.map((e) => e.pointerId)).size, 5, 'each pointer independent');
  assert.equal(new Set(presses.map((e) => e.gestureId)).size, 5);
  for (let id = 3; id <= 5; id++) r.pm.upAt(id);
  // pointers 1 & 2: spread apart and rotate.
  for (let k = 1; k <= 20; k++) { r.advance(16); r.pm.moveTo(1, 0.1 - k * 0.004, 0.2 - k * 0.005); r.pm.moveTo(2, 0.2 + k * 0.012, 0.2 + k * 0.012); }
  const types = r.types();
  for (const t of ['multi:start', 'multi:count', 'pinch', 'rotate', 'spread']) assert.ok(types.includes(t), t);
  const lastPinch = r.got.filter((e) => e.type === 'pinch').at(-1);
  assert.ok(lastPinch.scale > 1.35);
  r.pm.upAt(1); r.pm.upAt(2);
  assert.ok(r.types().includes('multi:end'));
  assert.equal(r.pm.activeCount(), 0);
});

test('pointer cap and cancel', () => {
  const r = rig();
  for (let id = 0; id < 14; id++) r.pm.downAt(id, 0.5, 0.5);
  assert.equal(r.pm.activeCount(), 10);
  r.pm.cancelAll();
  assert.equal(r.pm.activeCount(), 0);
  assert.ok(!r.types().includes('release'), 'cancelled pointers do not emit release');
});

test('recognizer exceptions are isolated', () => {
  const r = rig(); const errs = [];
  r.host.onError = (err, id) => errs.push(id);
  r.host.registry.register({ id: 'explode', down() { throw new Error('x'); } }, 'bad');
  r.pm.downAt(1, 0.5, 0.5);
  assert.deepEqual(errs, ['explode']);
  assert.ok(r.types().includes('press'));
  void T;
});
