// Per-frame effect compositor.
//
// Effects never draw cells directly. Each frame the buffers below are zeroed, every active
// effect instance WRITES MODULATIONS into them, and the renderer combines them with the
// grid state. This is what lets one cell rotate, flash, change colour and ride a ripple at
// the same time.
//
// CONFLICT RULES (stable, documented in ARCHITECTURE.md):
//   bright, scale, rot, ox, oy, hue   additive (sum of all effects), then the renderer
//                                     soft-clamps: bright -> [0, 1.6], scale -> [-0.9, 0.9],
//                                     offsets -> ±1.5 cells. Intensity setting scales them.
//   flash                             max() — the strongest flash wins (never sums, so
//                                     overlapping flashes cannot exceed the flash limit)
//   color                             priority override: setColor(i, t, weight, priority)
//                                     keeps the highest priority; ties keep the higher weight;
//                                     the renderer blends from the cell colour by weight.
//   global                            per-frame scene values (shake, zoom, invert, hue, bright)
//                                     summed; renderer clamps.

export const CHANNELS = ['bright', 'scale', 'rot', 'ox', 'oy', 'hue', 'flash'];

export class Compositor {
  constructor(count) { this.resize(count); this.global = { shakeX: 0, shakeY: 0, zoom: 0, rot: 0, invert: 0, hue: 0, bright: 0 }; }

  resize(count) {
    this.count = count;
    for (const c of CHANNELS) this[c] = new Float32Array(count);
    this.colorT = new Float32Array(count);
    this.colorW = new Float32Array(count);
    this.colorP = new Int8Array(count);
    this.touched = 0;
  }

  beginFrame() {
    for (const c of CHANNELS) this[c].fill(0);
    this.colorW.fill(0); this.colorP.fill(-128);
    const g = this.global; g.shakeX = g.shakeY = g.zoom = g.rot = g.invert = g.hue = g.bright = 0;
    this.touched = 0;
  }

  add(channel, i, v) { this[channel][i] += v; this.touched++; }
  max(channel, i, v) { if (v > this[channel][i]) this[channel][i] = v; this.touched++; }
  setColor(i, t, weight = 1, priority = 0) {
    const p = this.colorP[i];
    if (priority > p || (priority === p && weight > this.colorW[i])) {
      this.colorP[i] = priority; this.colorW[i] = Math.min(1, weight); this.colorT[i] = t;
    }
    this.touched++;
  }
}
