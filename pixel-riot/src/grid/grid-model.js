// Logical cell grid backed by typed arrays (structure-of-arrays, one slot per cell).
//
// PERSISTENT (artwork — saved, undoable, survives resize via resampling):
//   paint  Float32  palette position 0..1, or -1 = unpainted (pattern decides color)
//   shape  Uint8    index into the active shape set, 255 = unassigned (pattern decides)
//   ink    Float32  persistent brightness 0..1 left by trails / strokes (slowly fades)
//
// TRANSIENT (simulation — cleared by "reset simulation"):
//   energy Float32  activation level (0..~2), see energy-field.js
//   phase  Float32  per-cell animation phase (radians)
//   vx, vy Float32  local directional influence
//   flash  Float32  short-lived flash level (decays fast)
//   last   Float32  clock time of last activation
//   base   Float32  current pattern value 0..1 (written by the pattern engine each frame)
//   memory Float32  very slow gesture-history field (feeds the 'memory' pattern)
//
// Cells reference shared definitions (palette, shape set, sound mapping) instead of
// storing them — e.g. a cell's sound is derived from its position/paint by the
// audio mapping, not stored per cell.

export const PERSISTENT_CHANNELS = ['paint', 'shape', 'ink'];
export const TRANSIENT_CHANNELS = ['energy', 'phase', 'vx', 'vy', 'flash', 'last', 'base', 'memory'];

export class GridModel {
  constructor(cols = 32, rows = 32) {
    this.cols = 0; this.rows = 0; this.count = 0;
    this.setSize(cols, rows, { preserve: false });
  }

  _alloc(n) {
    return {
      paint: new Float32Array(n).fill(-1),
      shape: new Uint8Array(n).fill(255),
      ink: new Float32Array(n),
      energy: new Float32Array(n),
      phase: new Float32Array(n),
      vx: new Float32Array(n),
      vy: new Float32Array(n),
      flash: new Float32Array(n),
      last: new Float32Array(n).fill(-1000),
      base: new Float32Array(n),
      memory: new Float32Array(n),
    };
  }

  setSize(cols, rows, { preserve = true } = {}) {
    cols = Math.max(2, cols | 0); rows = Math.max(2, rows | 0);
    if (cols === this.cols && rows === this.rows) return false;
    const old = preserve && this.count ? { cols: this.cols, rows: this.rows, ch: this.ch } : null;
    this.cols = cols; this.rows = rows; this.count = cols * rows;
    this.ch = this._alloc(this.count);
    for (let i = 0; i < this.count; i++) this.ch.phase[i] = ((i * 2654435761) % 1000) / 1000 * Math.PI * 2;
    if (old) {
      // Area resample of persistent art + slow memory so artwork survives orientation
      // changes and resolution switches. Each new cell looks at every old cell it covers
      // (max-pooling ink/memory, keeping the strongest painted cell) so thin strokes are
      // never dropped when the grid shrinks; upsampling degenerates to nearest-neighbour.
      const o = old.ch, n = this.ch;
      for (let y = 0; y < rows; y++) {
        const y0 = Math.floor((y * old.rows) / rows), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * old.rows) / rows));
        for (let x = 0; x < cols; x++) {
          const x0 = Math.floor((x * old.cols) / cols), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * old.cols) / cols));
          const i = y * cols + x;
          let ink = 0, mem = 0, best = -1, bestInk = -1, shape = 255;
          for (let oy = y0; oy < Math.min(y1, old.rows); oy++) for (let ox = x0; ox < Math.min(x1, old.cols); ox++) {
            const j = oy * old.cols + ox;
            if (o.ink[j] > ink) ink = o.ink[j];
            if (o.memory[j] > mem) mem = o.memory[j];
            if (o.paint[j] >= 0 && o.ink[j] > bestInk) { bestInk = o.ink[j]; best = o.paint[j]; }
            if (shape === 255 && o.shape[j] !== 255) shape = o.shape[j];
          }
          n.ink[i] = ink; n.memory[i] = mem; n.paint[i] = best; n.shape[i] = shape;
        }
      }
    }
    // Convenience aliases for hot loops.
    Object.assign(this, this.ch);
    return true;
  }

  index(gx, gy) { return gy * this.cols + gx; }
  inBounds(gx, gy) { return gx >= 0 && gy >= 0 && gx < this.cols && gy < this.rows; }
  xOf(i) { return i % this.cols; }
  yOf(i) { return (i / this.cols) | 0; }
  // Normalized (0..1) cell centre.
  nx(gx) { return (gx + 0.5) / this.cols; }
  ny(gy) { return (gy + 0.5) / this.rows; }
  cellFromNormalized(nx, ny) {
    return {
      gx: Math.max(0, Math.min(this.cols - 1, Math.floor(nx * this.cols))),
      gy: Math.max(0, Math.min(this.rows - 1, Math.floor(ny * this.rows))),
    };
  }

  // Bump activation bookkeeping for a cell.
  touch(i, time) { this.last[i] = time; }

  resetSimulation() {
    for (const name of TRANSIENT_CHANNELS) if (name !== 'phase' && name !== 'memory') this.ch[name].fill(name === 'last' ? -1000 : 0);
  }
  clearArt() { this.paint.fill(-1); this.shape.fill(255); this.ink.fill(0); }
  clearMemory() { this.memory.fill(0); }

  snapshotArt() {
    return { cols: this.cols, rows: this.rows, arrays: { paint: this.paint.slice(), shape: this.shape.slice(), ink: this.ink.slice() } };
  }
  restoreArt(snap) {
    if (!snap) return false;
    if (snap.cols !== this.cols || snap.rows !== this.rows) {
      // Restore at the snapshot's size, then resample to the current size.
      const cols = this.cols, rows = this.rows;
      this.setSize(snap.cols, snap.rows, { preserve: false });
      this.paint.set(snap.arrays.paint); this.shape.set(snap.arrays.shape); this.ink.set(snap.arrays.ink);
      this.setSize(cols, rows, { preserve: true });
      return true;
    }
    this.paint.set(snap.arrays.paint); this.shape.set(snap.arrays.shape); this.ink.set(snap.arrays.ink);
    return true;
  }
}
