// Shared, bounded particle pool (structure of arrays, no per-particle allocation).
// Effects call api.particles.emit(); the renderer draws them in the overlay pass.
// The cap scales with the performance quality level; when full, the oldest slots recycle.

import { LIMITS } from '../config.js';

export class ParticleSystem {
  constructor(capacity = LIMITS.maxParticles) {
    this.capacity = capacity;
    const n = capacity;
    this.x = new Float32Array(n); this.y = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n);
    this.life = new Float32Array(n); this.max = new Float32Array(n);
    this.size = new Float32Array(n); this.t = new Float32Array(n);
    this.drag = new Float32Array(n); this.grav = new Float32Array(n);
    this.shape = new Uint8Array(n);   // 0 square, 1 line(streak), 2 ring
    this.alive = 0; this.head = 0;
    this.limit = n;                   // effective cap (quality-scaled)
    this.active = new Uint8Array(n);
    this.count = 0;
    this.aspect = 1;                  // width/height of canvas, set by renderer
  }

  setLimit(n) { this.limit = Math.max(16, Math.min(this.capacity, n | 0)); }

  // opts: { x, y (normalized), vx, vy (units/s), life (s), size (units), t (palette pos),
  //         drag (per s), gravity (units/s^2), shape: 'square'|'streak'|'ring' }
  emit(o) {
    // Ring-buffer allocation: when the pool is full the oldest slot is recycled.
    const i = this.head; this.head = (this.head + 1) % this.limit;
    if (!this.active[i]) this.count++;
    this.active[i] = 1;
    this.x[i] = o.x; this.y[i] = o.y; this.vx[i] = o.vx || 0; this.vy[i] = o.vy || 0;
    this.life[i] = this.max[i] = Math.max(0.05, Math.min(6, o.life || 0.8));
    this.size[i] = o.size || 0.012; this.t[i] = o.t || 0;
    this.drag[i] = o.drag ?? 2.5; this.grav[i] = o.gravity || 0;
    this.shape[i] = o.shape === 'streak' ? 1 : o.shape === 'ring' ? 2 : 0;
    return i;
  }

  // Emit `n` particles in a burst around (x, y).
  burst(x, y, n, o = {}) {
    for (let k = 0; k < n; k++) {
      const a = (o.angle ?? 0) + (o.spread ?? Math.PI * 2) * (Math.random() - (o.spread ? 0.5 : 0));
      const sp = (o.speed ?? 0.6) * (0.35 + Math.random() * 0.9);
      this.emit({ ...o, x, y, vx: Math.cos(a) * sp + (o.vx || 0), vy: Math.sin(a) * sp + (o.vy || 0), life: (o.life ?? 0.9) * (0.6 + Math.random() * 0.6), t: (o.t ?? 0) + (Math.random() - 0.5) * (o.tJitter ?? 0.15) });
    }
  }

  // aspect = width/height; velocities are in units (short side) per second.
  update(dt, sx, sy) {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (!this.active[i]) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0 || i >= this.limit) { this.active[i] = 0; continue; }
      const k = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= k; this.vy[i] = this.vy[i] * k + this.grav[i] * dt;
      this.x[i] += this.vx[i] * dt * sx; this.y[i] += this.vy[i] * dt * sy;
      if (this.x[i] < -0.1 || this.x[i] > 1.1 || this.y[i] < -0.1 || this.y[i] > 1.1) { this.active[i] = 0; continue; }
      n++;
    }
    this.count = n;
  }

  clear() { this.active.fill(0); this.count = 0; }
}
