// Core: event bus, registry, settings, clock, plugin manager, history, storage helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../core/event-bus.js';
import { Registry, RegistryError } from '../core/registry.js';
import { Settings } from '../core/settings.js';
import { Clock } from '../core/clock.js';
import { PluginManager } from '../core/plugin-manager.js';
import { History } from '../core/history.js';
import { Storage, bytesToBase64, base64ToBytes } from '../core/storage.js';
import { validateManifest, isApiCompatible } from '../extensions/manifest-schema.js';
import { memoryBackend } from './helpers.js';

test('event bus: on/emit/off, wildcard, once, error isolation', () => {
  const bus = new EventBus(); const got = [];
  const off = bus.on('a:b', (e) => got.push(['ab', e]));
  bus.on('a:*', (e, t) => got.push(['wild', t]));
  bus.once('a:b', () => got.push(['once']));
  const errs = []; bus.onError = (err, info) => errs.push(info.owner);
  bus.on('a:b', () => { throw new Error('boom'); }, 'bad-plugin');
  bus.emit('a:b', 1); bus.emit('a:b', 2); off(); bus.emit('a:b', 3);
  assert.deepEqual(got.filter((g) => g[0] === 'ab').map((g) => g[1]), [1, 2]);
  assert.equal(got.filter((g) => g[0] === 'once').length, 1);
  assert.equal(got.filter((g) => g[0] === 'wild').length, 3);
  assert.deepEqual(errs, ['bad-plugin', 'bad-plugin', 'bad-plugin']);
});

test('event bus: scoped subscriptions are removed by dispose (subscription cleanup)', () => {
  const bus = new EventBus(); const sc = bus.scope('plug'); let n = 0;
  sc.on('x', () => n++); sc.on('y:*', () => n++);
  bus.emit('x'); bus.emit('y:z'); assert.equal(n, 2);
  sc.dispose(); bus.emit('x'); bus.emit('y:z'); assert.equal(n, 2);
  assert.equal(bus.listenerCount(), 0);
});

test('registry: validation, duplicates, owner removal', () => {
  const r = new Registry('things', { validate: (d) => (typeof d.go === 'function' ? [] : ['missing go']) });
  r.register({ id: 'a', go() {} }, 'p1');
  assert.throws(() => r.register({ id: 'a', go() {} }), RegistryError);
  assert.throws(() => r.register({ id: 'b' }), /missing go/);
  assert.throws(() => r.register({ id: 'bad id!', go() {} }), /id may only/);
  r.register({ id: 'c', go() {} }, 'p2');
  r.unregisterOwner('p1');
  assert.deepEqual(r.ids(), ['c']);
});

test('settings: coercion, clamping, persistence, extension namespaces', async () => {
  const backend = memoryBackend();
  const st = new Settings({ storage: new Storage(backend), events: new EventBus() });
  assert.equal(st.set('audio.volume', 4), 1);
  assert.equal(st.set('music.scale', 'nonsense'), 'pentatonic-minor');
  st.defineSettings('ext.demo', { speed: { type: 'number', default: 2, min: 0, max: 5 } });
  assert.equal(st.get('ext.demo.speed'), 2);
  assert.throws(() => st.set('nope.key', 1));
  st.set('visual.trails', 0.5);
  await new Promise((r) => setTimeout(r, 200));
  const st2 = new Settings({ storage: new Storage(backend), events: new EventBus() });
  assert.equal(st2.get('visual.trails'), 0.5);
  st2.restoreDefaults();
  assert.equal(st2.get('visual.trails'), 0.35);
});

test('clock: dt clamp prevents backlog; scheduler order, cancel, owner cancel, bound', () => {
  const c = new Clock({ maxScheduled: 5 });
  assert.equal(c.tick(10), 1 / 20);   // inactive-tab return: clamped
  const out = [];
  c.after(0.02, () => out.push('b')); c.after(0.01, () => out.push('a'));
  const j = c.after(0.015, () => out.push('x')); c.cancel(j);
  c.after(0.01, () => out.push('owned'), 'plug'); c.cancelOwner('plug');
  c.tick(0.03);
  assert.deepEqual(out, ['a', 'b']);
  for (let i = 0; i < 10; i++) c.after(1, () => {});
  assert.equal(c.scheduledCount, 5); assert.ok(c.dropped >= 5);
});

test('clock: quantized next step time', () => {
  const c = new Clock(); c.tempo = 120; c.subdivision = 4;   // step = 0.125s
  assert.equal(c.nextStepTime(0.3), 0.375);
  assert.equal(c.nextStepTime(0.375), 0.375);
});

test('manifest: validation and API compatibility', () => {
  assert.ok(isApiCompatible('1.0.0'));
  assert.ok(!isApiCompatible('2.0.0'));
  assert.ok(!isApiCompatible('1.9.0'));   // requires a newer minor than the app has
  assert.deepEqual(validateManifest({ id: 'x.y', name: 'X', version: '1.0.0', description: '', type: 'effect', apiVersion: '1.0.0' }), []);
  const e = validateManifest({ id: 'X Y', version: '1', type: 'weird', apiVersion: '3.0.0' });
  assert.ok(e.length >= 4);
});

function pm() {
  const events = new EventBus();
  const registered = new Map();
  const makeScopedApi = (owner) => {
    const scope = events.scope(owner);
    return { api: { events: scope, reg: (id) => registered.set(id, owner) }, cleanup: () => { scope.dispose(); for (const [k, o] of [...registered]) if (o === owner) registered.delete(k); } };
  };
  return { manager: new PluginManager({ events, storage: new Storage(memoryBackend()), makeScopedApi }), events, registered };
}
const M = (id, extra = {}) => ({ id, name: id, version: '1.0.0', description: '', type: 'effect', apiVersion: '1.0.0', ...extra });

test('plugin manager: dependency order, lifecycle, cleanup on stop', () => {
  const { manager, registered, events } = pm(); const order = [];
  manager.add({ manifest: M('b', { dependencies: ['a'] }), register: (api) => { order.push('b'); api.reg('b-thing'); }, activate: (api) => api.events.on('ping', () => order.push('b-ping')) });
  manager.add({ manifest: M('a'), register: (api) => { order.push('a'); api.reg('a-thing'); } });
  manager.startAll();
  assert.deepEqual(order, ['a', 'b']);
  events.emit('ping'); assert.ok(order.includes('b-ping'));
  manager.setEnabled('b', false);
  assert.ok(!registered.has('b-thing')); assert.ok(registered.has('a-thing'));
  const n = order.length; events.emit('ping'); assert.equal(order.length, n);
  manager.setEnabled('b', true); assert.equal(manager.plugins.get('b').status, 'active');
});

test('plugin manager: error isolation, missing deps, cycles, invalid manifests, quarantine', () => {
  const { manager, registered } = pm();
  manager.add({ manifest: M('ok'), register: (api) => api.reg('ok-thing') });
  manager.add({ manifest: M('throws'), register: (api) => { api.reg('half'); throw new Error('bad register'); } });
  manager.add({ manifest: M('needs-missing', { dependencies: ['ghost'] }) });
  manager.add({ manifest: M('c1', { dependencies: ['c2'] }) });
  manager.add({ manifest: M('c2', { dependencies: ['c1'] }) });
  manager.add({ manifest: { id: 'broken' } });
  manager.add({ manifest: M('needs-throws', { dependencies: ['throws'] }) });
  manager.startAll();
  const st = Object.fromEntries(manager.diagnostics().map((d) => [d.id, d.status]));
  assert.equal(st.ok, 'active');
  assert.equal(st.throws, 'failed');
  assert.ok(!registered.has('half'), 'partial registrations rolled back');
  assert.equal(st['needs-missing'], 'failed');
  assert.equal(st.c1, 'failed'); assert.equal(st.c2, 'failed');
  assert.equal(st.broken, 'invalid');
  assert.equal(st['needs-throws'], 'failed');
  for (let i = 0; i < 5; i++) manager.reportRuntimeError('ok', new Error('runtime'));
  assert.equal(manager.plugins.get('ok').status, 'failed');
  assert.ok(!registered.has('ok-thing'));
});

test('history: bounded depth and byte budget', () => {
  const h = new History({ depth: 3, byteBudget: 1000 });
  for (let i = 0; i < 5; i++) h.push({ label: i, arrays: { a: new Uint8Array(100) } });
  assert.equal(h.length, 3); assert.equal(h.pop().label, 4);
  const h2 = new History({ depth: 50, byteBudget: 250 });
  for (let i = 0; i < 5; i++) h2.push({ arrays: { a: new Uint8Array(100) } });
  assert.equal(h2.length, 2);
});

test('storage: base64 round trip and memory fallback', () => {
  const u8 = new Uint8Array([0, 1, 2, 250, 255]);
  assert.deepEqual([...base64ToBytes(bytesToBase64(u8))], [...u8]);
  const s = new Storage(memoryBackend());
  s.set('k', { a: 1 }); assert.deepEqual(s.get('k'), { a: 1 }); assert.equal(s.get('missing', 7), 7);
});
