// Gesture recognizer host + registry.
//
// Gesture recognizer contract (API 1.x):
//   {
//     id: 'acme.zigzag', name: 'ZIGZAG', description: '...',
//     emits: ['zigzag'],                       // gesture types it can publish (documentation)
//     down?(p, ctx), move?(p, ctx), up?(p, ctx, cancelled), frame?(dt, ctx), reset?(ctx)
//   }
//   p   = pointer record (see pointer-manager.js); use p.data[recognizer.id] for scratch state
//   ctx = { emit(type, p, extra), pointers(), activeCount(), mapper, grid, clock, now(), units(p) }
//
// ctx.emit publishes a fully populated event (see gesture-events.js) as 'gesture:<type>'.
// Recognizers never touch effects, sound or the DOM — they only describe what happened.

import { Registry, need } from '../core/registry.js';
import { makeGestureEvent } from './gesture-events.js';

export class GestureRecognizerHost {
  constructor({ events, mapper, grid, clock, now = () => performance.now(), onError }) {
    this.events = events; this.mapper = mapper; this.grid = grid; this.clock = clock; this.now = now;
    this.onError = onError || ((err, id) => events?.emit('app:error', { error: err, source: `recognizer ${id}` }));
    this.registry = new Registry('gestureRecognizers', {
      events,
      validate: (d) => { const e = []; for (const k of ['down', 'move', 'up', 'frame', 'reset']) need.optFn(d, k, e); return e; },
    });
    this.pointerSource = null;   // set by app: () => Map of pointers
    this.groupSource = () => 0;
    this.counts = {};            // per-type emit counters (diagnostics/tests)
    const host = this;
    this.ctx = {
      emit: (type, p, extra) => host.emit(type, p, extra),
      pointers: () => (host.pointerSource ? [...host.pointerSource().values()] : []),
      activeCount: () => (host.pointerSource ? host.pointerSource().size : 0),
      groupId: () => host.groupSource(),
      mapper, grid, clock, now,
    };
  }

  emit(type, p, extra) {
    const ev = makeGestureEvent(type, p, this.ctx, extra);
    this.counts[type] = (this.counts[type] || 0) + 1;
    this.events.emit('gesture:' + type, ev);
    return ev;
  }

  _each(method, ...args) {
    for (const r of this.registry.list()) {
      if (typeof r[method] !== 'function') continue;
      try { r[method](...args, this.ctx); }
      catch (err) { this.onError(err, r.id, this.registry.owner(r.id)); }
    }
  }
  down(p) { this._each('down', p); }
  move(p) { this._each('move', p); }
  up(p, cancelled) {
    for (const r of this.registry.list()) {
      if (typeof r.up !== 'function') continue;
      try { r.up(p, this.ctx, cancelled); } catch (err) { this.onError(err, r.id, this.registry.owner(r.id)); }
    }
  }
  frame(dt) { this._each('frame', dt); }
  reset() { this._each('reset'); }
}
