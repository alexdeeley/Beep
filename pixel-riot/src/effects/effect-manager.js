// Effect registry + scheduler.
//
// - Any number of instances of any effects run simultaneously (no "currentEffect").
// - Bounded: per-effect maxInstances, global instance cap scaled by quality, lifetime cap,
//   global (ambient) effect cap. Eviction removes the lowest-priority, oldest instance.
// - Keyed instances: spawn(id, params, { key }) re-uses a live instance with that key and
//   calls effect.retrigger() — used for continuous gestures (hold charge, two-finger rotate).
// - Error isolation: an effect that throws is cancelled and reported to its owner plugin.

import { Registry } from '../core/registry.js';
import { validateEffect } from './effect-interface.js';
import { LIMITS } from '../config.js';

export class EffectManager {
  constructor({ events, makeContext, onError }) {
    this.events = events;
    this.registry = new Registry('effects', { events, validate: validateEffect });
    this.instances = [];
    this.byKey = new Map();
    this._uid = 0;
    this.makeContext = makeContext;   // () => EffectContext (cached by app)
    this.onError = onError || (() => {});
    this.capScale = 1;                // set from quality level
    this.spawned = 0; this.evicted = 0;
  }

  get cap() { return Math.max(16, Math.floor(LIMITS.maxEffectInstances * this.capScale)); }
  get count() { return this.instances.length; }

  spawn(effectId, params = {}, opts = {}) {
    const def = this.registry.get(effectId);
    if (!def) return null;
    const ctx = this.makeContext();
    if (opts.key != null) {
      const live = this.byKey.get(opts.key);
      if (live && !live.done && live.effectId === effectId) {
        live.params = { ...live.params, ...params };
        if (def.retrigger) this._try(live, def, () => def.retrigger(live, params, ctx));
        else { live.age = 0; }
        return live;
      }
    }
    const kind = def.kind || 'local';
    // Enforce caps.
    const same = this.instances.filter((i) => i.effectId === effectId && !i.done);
    const maxSame = def.maxInstances ?? (kind === 'global' ? 1 : 40);
    while (same.length >= maxSame) this.cancel(same.shift(), 'evicted');
    if (kind === 'global') {
      const globals = this.instances.filter((i) => i.kind === 'global' && !i.done);
      while (globals.length >= LIMITS.maxGlobalEffects) this.cancel(globals.shift(), 'evicted');
    }
    let live = this.instances.filter((i) => !i.done).length;
    while (live >= this.cap && this._evict()) live--;

    const p = { ...(def.defaults || {}), ...params };
    const ev = opts.event || null;
    const life = kind === 'global' ? Infinity : Math.min(LIMITS.maxEffectLifetime, Math.max(0.02, p.life ?? def.life ?? 1));
    const g = ctx.grid;
    const x = opts.x ?? ev?.x ?? 0.5, y = opts.y ?? ev?.y ?? 0.5;
    const inst = {
      uid: ++this._uid, effectId, owner: this.registry.owner(effectId), kind, key: opts.key ?? null,
      params: p, age: 0, life, t: 0, priority: def.priority ?? 0,
      x, y, fx: x * g.cols, fy: y * g.rows,
      gx: Math.min(g.cols - 1, Math.max(0, Math.floor(x * g.cols))),
      gy: Math.min(g.rows - 1, Math.max(0, Math.floor(y * g.rows))),
      event: ev, intensity: p.intensity ?? 1, state: {}, done: false,
    };
    if (!this._try(inst, def, () => def.spawn(inst, ctx))) return null;
    this.instances.push(inst);
    if (inst.key != null) this.byKey.set(inst.key, inst);
    this.spawned++;
    this.events?.emit('effect:spawned', { uid: inst.uid, effectId });
    return inst;
  }

  _evict() {
    let victim = null;
    for (const i of this.instances) {
      if (i.done || i.kind === 'global') continue;
      if (!victim || i.priority < victim.priority || (i.priority === victim.priority && i.uid < victim.uid)) victim = i;
    }
    if (victim) { this.cancel(victim, 'evicted'); this.evicted++; return true; }
    return false;
  }

  _try(inst, def, fn) {
    try { fn(); return true; }
    catch (err) {
      inst.done = true;
      this.onError(err, { effectId: inst.effectId, owner: inst.owner });
      return false;
    }
  }

  cancel(inst, reason = 'cancelled') {
    if (!inst || inst.done) return;
    inst.done = true;
    const def = this.registry.get(inst.effectId);
    if (def?.cancel) this._try(inst, def, () => def.cancel(inst, this.makeContext(), reason));
    if (inst.key != null && this.byKey.get(inst.key) === inst) this.byKey.delete(inst.key);
  }

  cancelWhere(pred) { for (const i of this.instances) if (pred(i)) this.cancel(i); this._sweep(); }
  cancelAll({ keepGlobal = false } = {}) { this.cancelWhere((i) => !(keepGlobal && i.kind === 'global')); }
  release(key) { const i = this.byKey.get(key); if (i) { this.byKey.delete(key); i.key = null; i.released = true; } return i; }

  update(dt) {
    const ctx = this.makeContext();
    for (const inst of this.instances) {
      if (inst.done) continue;
      const def = this.registry.get(inst.effectId);
      if (!def) { inst.done = true; continue; }
      inst.age += dt;
      inst.t = inst.life === Infinity ? 0 : Math.min(1, inst.age / inst.life);
      let keep = true;
      this._try(inst, def, () => { keep = def.update(inst, dt, ctx) !== false; });
      if (!keep || inst.age >= inst.life) this.cancel(inst, 'expired');
    }
    this._sweep();
  }

  _sweep() {
    if (this.instances.some((i) => i.done)) {
      this.instances = this.instances.filter((i) => !i.done);
      for (const [k, i] of this.byKey) if (i.done) this.byKey.delete(k);
    }
  }

  // Single overlay callback handed to the renderer.
  drawAll(g) {
    const ctx = this.makeContext();
    for (const inst of this.instances) {
      if (inst.done) continue;
      const def = this.registry.get(inst.effectId);
      if (def?.draw) this._try(inst, def, () => def.draw(inst, g, ctx));
    }
  }

  list() { return this.instances.filter((i) => !i.done).map((i) => ({ uid: i.uid, effectId: i.effectId, kind: i.kind, age: +i.age.toFixed(2), life: i.life })); }
}
