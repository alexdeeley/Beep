// Universal energy model shared by every module.
//
// Energy is a per-cell scalar (grid.energy). Taps inject it at a point, swipes along a path,
// long presses accumulate it, multitouch fields add together. Each frame the ACTIVE ENERGY
// BEHAVIOR (registry: api.energy.behaviors) updates the field — decay, diffusion, drift...
//
// Modules interpret energy freely: the renderer maps it to brightness/scale, sound mappings
// to gain/brightness, chain reactions to activation probability. Nobody owns it.
//
// Energy behavior contract:
//   { id, name, description,
//     update(field, dt, params) -> void   // field = EnergyField; mutate field.grid.energy
//   }
// Behaviors should only touch the dirty region (field.region) for performance.

import { forRadius, forLine } from './spatial-query.js';
import { Registry, need } from '../core/registry.js';

export const ENERGY_MAX = 2.5;

export class EnergyField {
  constructor({ grid, clock, events }) {
    this.grid = grid; this.clock = clock; this.events = events;
    this.behaviors = new Registry('energyBehaviors', {
      events,
      validate: (d) => { const e = []; need.fn(d, 'update', e); return e; },
    });
    this.behaviorId = 'diffuse';
    this.params = { decay: 1.6, spread: 0.18, memoryGain: 0.02 };
    this.region = null;   // dirty rect {x0,y0,x1,y1} of cells that may hold energy
    this._scratch = new Float32Array(grid.count);
    this.total = 0;
  }

  resized() { this._scratch = new Float32Array(this.grid.count); this.region = null; }

  _grow(x0, y0, x1, y1) {
    const g = this.grid;
    x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0);
    x1 = Math.min(g.cols - 1, Math.ceil(x1)); y1 = Math.min(g.rows - 1, Math.ceil(y1));
    const r = this.region;
    if (!r) this.region = { x0, y0, x1, y1 };
    else { r.x0 = Math.min(r.x0, x0); r.y0 = Math.min(r.y0, y0); r.x1 = Math.max(r.x1, x1); r.y1 = Math.max(r.y1, y1); }
  }

  // Inject energy around a (possibly fractional) cell position with smooth falloff.
  inject(gx, gy, amount, radius = 1.5) {
    const g = this.grid; const t = this.clock.time;
    const r = Math.max(0.5, radius);
    forRadius(g, gx, gy, r, (i, x, y, d) => {
      const f = 1 - d / (r + 0.5);
      const v = g.energy[i] + amount * f * f;
      g.energy[i] = v > ENERGY_MAX ? ENERGY_MAX : v < 0 ? 0 : v;
      g.memory[i] = Math.min(1, g.memory[i] + amount * f * this.params.memoryGain);
      if (amount > 0) g.last[i] = t;
    });
    this._grow(gx - r - 1, gy - r - 1, gx + r + 1, gy + r + 1);
  }

  injectLine(x0, y0, x1, y1, amount, radius = 0.8) {
    if (radius <= 0.8) {
      forLine(this.grid, x0, y0, x1, y1, (i, x, y) => this.inject(x + 0.5, y + 0.5, amount, radius));
    } else {
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
      for (let s = 0; s <= steps; s++) this.inject(x0 + (x1 - x0) * s / steps + 0.5, y0 + (y1 - y0) * s / steps + 0.5, amount, radius);
    }
  }

  at(gx, gy) { return this.grid.inBounds(gx, gy) ? this.grid.energy[this.grid.index(gx, gy)] : 0; }

  setBehavior(id) { if (this.behaviors.has(id)) { this.behaviorId = id; return true; } return false; }

  update(dt) {
    const memDecay = Math.exp(-dt / 45);
    const mem = this.grid.memory;
    // Memory decays very slowly over the whole grid (cheap).
    if ((this.clock.frame & 7) === 0) { const k = memDecay ** 8; for (let i = 0; i < mem.length; i++) mem[i] *= k; }
    if (!this.region) { this.total = 0; return; }
    const b = this.behaviors.get(this.behaviorId) || this.behaviors.get('diffuse');
    b.update(this, dt, this.params);
    // Shrink region when everything has died out.
    const g = this.grid, r = this.region; let total = 0;
    let nx0 = g.cols, ny0 = g.rows, nx1 = -1, ny1 = -1;
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      const i = y * g.cols + x; const e = g.energy[i];
      if (e > 0.004) { total += e; if (x < nx0) nx0 = x; if (x > nx1) nx1 = x; if (y < ny0) ny0 = y; if (y > ny1) ny1 = y; }
      else g.energy[i] = 0;
    }
    this.total = total;
    this.region = nx1 < 0 ? null : { x0: Math.max(0, nx0 - 1), y0: Math.max(0, ny0 - 1), x1: Math.min(g.cols - 1, nx1 + 1), y1: Math.min(g.rows - 1, ny1 + 1) };
  }

  clear() { this.grid.energy.fill(0); this.region = null; this.total = 0; }
}

// ============================================================
// EXTENSION ZONE: ENERGY PROPAGATION BEHAVIORS
// PURPOSE: How energy moves through the grid each frame.
// CONTRACT: EnergyField behavior contract at the top of this file: update(field, dt, params).
// SAFETY: Work inside field.region (dirty rect); no per-frame allocation; respect ENERGY_MAX.
// INTEGRATION: api.energy.behaviors.register(def); select per preset (energy.behavior). Example: src/extensions/examples/gravity-energy.js
// ============================================================
// ---------- Built-in energy behaviors ----------

// Exponential decay + 4-neighbour diffusion inside the dirty region.
export const diffuseBehavior = {
  id: 'diffuse', name: 'DIFFUSE', description: 'Energy spreads to neighbours and fades.',
  update(field, dt, p) {
    const g = field.grid, e = g.energy, s = field._scratch, r = field.region, W = g.cols;
    const k = Math.exp(-dt * p.decay);
    const spread = Math.min(0.24, p.spread * dt * 60 * 0.25);
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      const i = y * W + x; const c = e[i];
      const l = x > 0 ? e[i - 1] : c, rr = x < W - 1 ? e[i + 1] : c;
      const u = y > 0 ? e[i - W] : c, d = y < g.rows - 1 ? e[i + W] : c;
      s[i] = (c + spread * (l + rr + u + d - 4 * c)) * k;
    }
    for (let y = r.y0; y <= r.y1; y++) { const o = y * W; for (let x = r.x0; x <= r.x1; x++) e[o + x] = s[o + x]; }
    // Region may expand by one cell per frame through diffusion.
    r.x0 = Math.max(0, r.x0 - 1); r.y0 = Math.max(0, r.y0 - 1); r.x1 = Math.min(W - 1, r.x1 + 1); r.y1 = Math.min(g.rows - 1, r.y1 + 1);
  },
};

// Pure decay, no spreading — crisp pixel marks.
export const stillBehavior = {
  id: 'still', name: 'STILL', description: 'Energy stays where it lands and fades.',
  update(field, dt, p) {
    const g = field.grid, e = g.energy, r = field.region, W = g.cols;
    const k = Math.exp(-dt * p.decay * 0.8);
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) e[y * W + x] *= k;
  },
};

// Energy flows along each cell's (vx, vy) — swipes leave currents.
export const driftBehavior = {
  id: 'drift', name: 'DRIFT', description: 'Energy is carried along local gesture currents.',
  update(field, dt, p) {
    const g = field.grid, e = g.energy, s = field._scratch, r = field.region, W = g.cols, H = g.rows;
    const k = Math.exp(-dt * p.decay);
    const vk = Math.exp(-dt * 0.8);
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) s[y * W + x] = 0;
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      const i = y * W + x; const c = e[i] * k;
      if (c <= 0) continue;
      const vx = g.vx[i], vy = g.vy[i];
      const mv = Math.min(0.9, Math.hypot(vx, vy) * dt * 6);
      const tx = Math.max(0, Math.min(W - 1, x + Math.sign(vx) * (Math.abs(vx) > Math.abs(vy) * 0.5 ? 1 : 0)));
      const ty = Math.max(0, Math.min(H - 1, y + Math.sign(vy) * (Math.abs(vy) > Math.abs(vx) * 0.5 ? 1 : 0)));
      const j = ty * W + tx;
      s[i] += c * (1 - mv); s[j] += c * mv;
      g.vx[j] = g.vx[j] * 0.7 + vx * 0.3; g.vy[j] = g.vy[j] * 0.7 + vy * 0.3;
      g.vx[i] *= vk; g.vy[i] *= vk;
    }
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) { const i = y * W + x; e[i] = Math.min(ENERGY_MAX, s[i]); }
    r.x0 = Math.max(0, r.x0 - 1); r.y0 = Math.max(0, r.y0 - 1); r.x1 = Math.min(W - 1, r.x1 + 1); r.y1 = Math.min(H - 1, r.y1 + 1);
  },
};

// Energy oscillates with each cell's phase before fading — shimmering.
export const pulseBehavior = {
  id: 'pulse', name: 'PULSE', description: 'Energy breathes with each cell’s phase and spreads slowly.',
  update(field, dt, p) {
    diffuseBehavior.update(field, dt, { ...p, spread: p.spread * 0.4, decay: p.decay * 0.7 });
    const g = field.grid, r = field.region, W = g.cols, t = field.clock.time;
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      const i = y * W + x;
      if (g.energy[i] > 0.02) g.flash[i] = Math.max(g.flash[i], 0.15 * g.energy[i] * (0.5 + 0.5 * Math.sin(t * 9 + g.phase[i])));
    }
  },
};

export const BUILTIN_ENERGY_BEHAVIORS = [diffuseBehavior, stillBehavior, driftBehavior, pulseBehavior];
