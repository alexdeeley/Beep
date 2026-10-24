// Palette registry + palette engine (smooth transitions, LUTs, cycling).
//
// Palette contract (API 1.x):
//   {
//     id, name,
//     stops: ['#hex', ...]           // >= 2 colours, sampled as a smooth gradient over 0..1
//       | generate(rng) -> ['#hex']  // procedural palettes (e.g. harmony-constrained random)
//     cycle?: number      // palette positions per second the whole palette drifts (default 0.02)
//     spread?: number     // how strongly the pattern value shifts colour (default 0.35)
//     white?: number      // 0..1 how far the brightest cells blow out to white (default 0.6)
//     complement?: '#hex' // accent colour for overlays (defaults to the last stop)
//     discrete?: bool     // step between stops instead of blending
//     background?: '#hex' // canvas background (default '#000')
//     transition?: number // seconds to cross-fade INTO this palette (default 0.8)
//   }
//
// The engine exposes `style(t, b)` — a cached CSS colour string for palette position t
// (0..1, wraps) at brightness b (0..1). Renderers use it; effects use it via the overlay API.

import { Registry } from '../core/registry.js';
import { clamp } from '../core/rng.js';

export const HUE_STEPS = 64;
export const BRIGHT_STEPS = 24;

export function hexToRgb(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (!Number.isFinite(n) || h.length !== 6) return [255, 255, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbToHex = ([r, g, b]) => '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

export function hslToRgb(h, s, l) {
  h = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

export function validatePalette(d) {
  const e = [];
  if (!d.generate && (!Array.isArray(d.stops) || d.stops.length < 2)) e.push('needs stops (>= 2 colours) or generate(rng)');
  if (d.stops && d.stops.some((s) => typeof s !== 'string' || !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s))) e.push('stops must be #hex strings');
  if (d.generate && typeof d.generate !== 'function') e.push('generate must be a function');
  return e;
}

// Build a 256-entry RGB table from stops.
export function buildTable(stops, discrete = false) {
  const rgb = stops.map(hexToRgb);
  const out = new Float32Array(256 * 3);
  const n = rgb.length;
  for (let i = 0; i < 256; i++) {
    const t = i / 256;
    // Cyclic gradient: last stop blends back into the first so cycling is seamless.
    const pos = t * n; const k = Math.floor(pos) % n; const f = discrete ? 0 : pos - Math.floor(pos);
    const a = rgb[k], b = rgb[(k + 1) % n];
    out[i * 3] = a[0] + (b[0] - a[0]) * f;
    out[i * 3 + 1] = a[1] + (b[1] - a[1]) * f;
    out[i * 3 + 2] = a[2] + (b[2] - a[2]) * f;
  }
  return out;
}

export class PaletteEngine {
  constructor({ events, rng }) {
    this.events = events; this.rng = rng;
    this.registry = new Registry('palettes', { events, validate: validatePalette });
    this.active = null; this.def = null;
    this._from = null; this._to = null; this._mix = 1; this._dur = 0.8;
    this.table = new Float32Array(256 * 3);
    this.styles = new Array(HUE_STEPS * BRIGHT_STEPS);
    this.offset = 0;      // cycling offset
    this.reducedFlash = false;
    this._dirty = true;
  }

  resolveStops(def) {
    if (def.generate) { try { const s = def.generate(this.rng); if (Array.isArray(s) && s.length >= 2) return s; } catch (e) { this.events?.emit('app:error', { error: e, source: `palette ${def.id}` }); } return ['#ffffff', '#000000']; }
    return def.stops;
  }

  setActive(id, { immediate = false } = {}) {
    const def = this.registry.get(id);
    if (!def) return false;
    const table = buildTable(this.resolveStops(def), def.discrete);
    this._from = immediate || !this._to ? table : this.table.slice();
    this._to = table;
    this._mix = immediate ? 1 : 0;
    this._dur = Math.max(0.05, def.transition ?? 0.8);
    this.active = id; this.def = def;
    this._dirty = true;
    this.events?.emit('palette:changed', { id });
    return true;
  }

  get cycle() { return this.def?.cycle ?? 0.02; }
  get spread() { return this.def?.spread ?? 0.35; }
  get white() { return this.def?.white ?? 0.6; }
  get background() { return this.def?.background || '#000000'; }

  update(dt, animate = true) {
    if (animate) this.offset = (this.offset + this.cycle * dt) % 1;
    if (this._mix < 1) {
      this._mix = Math.min(1, this._mix + dt / this._dur);
      const m = this._mix * this._mix * (3 - 2 * this._mix);
      const a = this._from, b = this._to, t = this.table;
      for (let i = 0; i < t.length; i++) t[i] = a[i] + (b[i] - a[i]) * m;
      this._dirty = true;
    } else if (this._to && this.table !== this._to && this._dirty) {
      this.table.set(this._to);
    }
    if (this._dirty) { this._rebuildStyles(); this._dirty = false; }
  }

  _rebuildStyles() {
    const w = this.white;
    for (let h = 0; h < HUE_STEPS; h++) {
      const ti = Math.floor((h / HUE_STEPS) * 256) * 3;
      const r = this.table[ti], g = this.table[ti + 1], b = this.table[ti + 2];
      for (let k = 0; k < BRIGHT_STEPS; k++) {
        const bl = (k + 1) / BRIGHT_STEPS;
        let R, G, B;
        if (bl <= 0.72) { const f = Math.pow(bl / 0.72, 1.15); R = r * f; G = g * f; B = b * f; }
        else { const f = ((bl - 0.72) / 0.28) * w; R = r + (255 - r) * f; G = g + (255 - g) * f; B = b + (255 - b) * f; }
        this.styles[h * BRIGHT_STEPS + k] = `rgb(${R | 0},${G | 0},${B | 0})`;
      }
    }
  }

  // Cached colour string. t wraps; b is clamped 0..1.
  style(t, b) {
    let h = ((t + this.offset) % 1 + 1) % 1;
    const hi = (h * HUE_STEPS) | 0;
    let bi = Math.round(b * BRIGHT_STEPS) - 1;
    if (bi < 0) bi = 0; else if (bi >= BRIGHT_STEPS) bi = BRIGHT_STEPS - 1;
    return this.styles[hi * BRIGHT_STEPS + bi];
  }

  // Raw RGB (0..255) at palette position t (no brightness), for effects needing numbers.
  rgb(t) {
    const h = ((t + this.offset) % 1 + 1) % 1;
    const i = Math.floor(h * 255.999) * 3;
    return [this.table[i], this.table[i + 1], this.table[i + 2]];
  }

  complement() { return this.def?.complement || this.resolveStopsCached()?.slice(-1)[0] || '#ffffff'; }
  resolveStopsCached() { return this.def?.stops || null; }
}
