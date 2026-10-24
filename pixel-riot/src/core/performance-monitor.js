// Frame timing, resource counters and adaptive quality.
//
// stats(): { fps, frameMs, dropped, effects, voices, particles, scheduled, cols, rows,
//            cellsDrawn, workload, quality, resolution }
// Emits 'perf:quality' when the effective quality level changes and
// 'perf:resolution-hint' { direction: -1 | 1 } when adaptive resolution should step.

// ============================================================
// EXTENSION ZONE: PERFORMANCE OPTIMIZATIONS
// PURPOSE: React to measured performance.
// CONTRACT: api.performance.addOptimizer(fn(stats, monitor)) runs once per second; quality levels in config.js.
// SAFETY: Never block the frame; change behaviour via settings/quality, not by patching modules.
// INTEGRATION: api.performance.addOptimizer(fn). Example: src/extensions/examples/frame-budget.js
// ============================================================
import { QUALITY_LEVELS } from '../config.js';

export class PerformanceMonitor {
  constructor({ events }) {
    this.events = events;
    this.fps = 60; this.frameMs = 16.7; this.dropped = 0; this.frames = 0;
    this.counters = { effects: 0, voices: 0, particles: 0, scheduled: 0, cellsDrawn: 0, cols: 0, rows: 0 };
    this.requested = 'auto';           // 'auto' | 'high' | 'medium' | 'low'
    this.level = 'high';
    this._slow = 0; this._fast = 0; this._lastHint = 0;
    this.adaptiveResolution = false;
    this.optimizers = [];              // extension hooks: (stats, monitor) => void, run once/second
    this._acc = 0;
  }

  get quality() { return QUALITY_LEVELS[this.level]; }

  setRequested(q) {
    this.requested = q;
    if (q !== 'auto') this._setLevel(q);
  }

  _setLevel(l) {
    if (l === this.level) return;
    this.level = l;
    this.events?.emit('perf:quality', { level: l });
  }

  frame(realDtSec, now) {
    this.frames++;
    const ms = realDtSec * 1000;
    if (ms > 0 && ms < 1000) {
      this.frameMs += (ms - this.frameMs) * 0.08;
      this.fps = 1000 / this.frameMs;
      if (ms > 26) this.dropped++;
    }
    this._acc += realDtSec;
    if (this._acc < 1) return;
    this._acc = 0;
    // Once per second: adapt.
    if (this.fps < 46) { this._slow++; this._fast = 0; }
    else if (this.fps > 57) { this._fast++; this._slow = 0; }
    else { this._slow = 0; this._fast = 0; }

    if (this.requested === 'auto') {
      const order = ['high', 'medium', 'low'];
      const idx = order.indexOf(this.level);
      if (this._slow >= 3 && idx < 2) { this._setLevel(order[idx + 1]); this._slow = 0; }
      else if (this._fast >= 10 && idx > 0) { this._setLevel(order[idx - 1]); this._fast = 0; }
    }
    if (this.adaptiveResolution && now - this._lastHint > 4) {
      if (this._slow >= 2) { this._lastHint = now; this.events?.emit('perf:resolution-hint', { direction: -1 }); }
      else if (this._fast >= 8) { this._lastHint = now; this.events?.emit('perf:resolution-hint', { direction: 1 }); }
    }
    const s = this.stats();
    for (const fn of this.optimizers) { try { fn(s, this); } catch (e) { this.events?.emit('app:error', { error: e, source: 'performance optimizer' }); } }
  }

  set(counter, value) { this.counters[counter] = value; }

  stats() {
    const c = this.counters;
    return {
      fps: Math.round(this.fps), frameMs: +this.frameMs.toFixed(1), dropped: this.dropped,
      ...c,
      workload: Math.round(c.cellsDrawn / 1000 + c.particles / 400 + c.effects / 20),
      quality: this.level, requestedQuality: this.requested,
    };
  }
}
