// Pattern registry + pattern engine.
//
// Pattern contract (API 1.x):
//   {
//     id, name, description?,
//     animated?: bool (default true)   // false = only recomputed when inputs change
//     params?: { ...defaults }         // merged with per-preset overrides
//     init?(ctx) -> state              // per-pattern state (e.g. cellular automaton buffers)
//     fill(out, ctx)                   // write a 0..1 value for every cell into `out`
//   }
//   ctx = { cols, rows, count, t, dt, params, state, aspect, memory, energy, rng }
//
// Patterns know nothing about colour, shapes or sound. The engine layers two patterns
// (A and B) with a blend mode, cross-fades on change, and writes the result to grid.base.
// The renderer turns base into brightness / colour offset / shape choice.

import { Registry, need } from '../core/registry.js';

export const BLEND_MODES = {
  mix: (a, b, m) => a + (b - a) * m,
  add: (a, b, m) => Math.min(1, a + b * m),
  multiply: (a, b, m) => a * (1 - m + b * m),
  max: (a, b, m) => Math.max(a, b * m),
  difference: (a, b, m) => Math.abs(a - b * m),
  xor: (a, b, m) => { const x = (a > 0.5) !== (b > 0.5) ? 1 : 0.1; return a + (x - a) * m; },
};

export class PatternEngine {
  constructor({ grid, events, rng }) {
    this.grid = grid; this.events = events; this.rng = rng;
    this.registry = new Registry('patterns', {
      events,
      validate: (d) => { const e = []; need.fn(d, 'fill', e); need.optFn(d, 'init', e); return e; },
    });
    this.layers = {
      a: { id: 'checker', params: {}, state: null },
      b: { id: null, params: {}, state: null },
    };
    this.blend = 'mix'; this.mix = 0.5;
    this.speed = 1;
    this.t = 0;
    this._fade = 1; this._prev = null;
    this._bufA = new Float32Array(grid.count);
    this._bufB = new Float32Array(grid.count);
    this.lastError = null;
  }

  resized() {
    const n = this.grid.count;
    this._bufA = new Float32Array(n); this._bufB = new Float32Array(n);
    this._prev = null; this._fade = 1;
    for (const L of Object.values(this.layers)) L.state = null;
  }

  set(slot, id, params = {}) {
    if (id && !this.registry.has(id)) return false;
    const L = this.layers[slot];
    if (L.id === id && JSON.stringify(L.params) === JSON.stringify(params)) return true;
    this._prev = this.grid.base.slice();
    this._fade = 0;
    L.id = id; L.params = params; L.state = null;
    this.events?.emit('pattern:changed', { slot, id });
    return true;
  }

  setBlend(mode, mix = this.mix) { if (BLEND_MODES[mode]) this.blend = mode; this.mix = Math.max(0, Math.min(1, mix)); }

  _ctx(L, def, dt) {
    const g = this.grid;
    const ctx = {
      cols: g.cols, rows: g.rows, count: g.count, t: this.t, dt,
      params: { ...(def.params || {}), ...L.params },
      state: L.state, aspect: g.cols / g.rows, memory: g.memory, energy: g.energy, rng: this.rng,
    };
    if (!L.state && def.init) { L.state = def.init(ctx) || {}; ctx.state = L.state; }
    return ctx;
  }

  _run(L, out, dt) {
    const def = L.id && this.registry.get(L.id);
    if (!def) return false;
    try { def.fill(out, this._ctx(L, def, dt)); return true; }
    catch (err) {
      this.lastError = err;
      this.events?.emit('app:error', { error: err, source: `pattern ${L.id}`, owner: this.registry.owner(L.id) });
      L.id = 'checker'; L.state = null;
      return false;
    }
  }

  update(dt, animate = true) {
    if (animate) this.t += dt * this.speed;
    const g = this.grid, out = g.base;
    if (out.length !== this._bufA.length) this.resized();
    const okA = this._run(this.layers.a, this._bufA, dt);
    const okB = this.layers.b.id ? this._run(this.layers.b, this._bufB, dt) : false;
    const blend = BLEND_MODES[this.blend] || BLEND_MODES.mix;
    const A = this._bufA, B = this._bufB, m = this.mix;
    for (let i = 0; i < out.length; i++) {
      let v = okA ? A[i] : 0;
      if (okB) v = blend(v, B[i], m);
      out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
    if (this._fade < 1 && this._prev && this._prev.length === out.length) {
      this._fade = Math.min(1, this._fade + dt / 0.7);
      const f = this._fade * this._fade * (3 - 2 * this._fade), p = this._prev;
      for (let i = 0; i < out.length; i++) out[i] = p[i] + (out[i] - p[i]) * f;
    }
  }
}
