// Undo history for ARTWORK state only (persistent cell paint: color, shape, ink).
// Snapshots are taken once per user action (gesture group start, clear, preset load,
// randomize) — never per frame. Bounded by LIMITS.undoDepth and a byte budget.

export class History {
  constructor({ depth = 24, byteBudget = 12 * 1024 * 1024 } = {}) {
    this.depth = depth; this.byteBudget = byteBudget;
    this.stack = [];
  }
  // snapshot: { label, cols, rows, arrays: { name: TypedArray(copy) }, extra?: any }
  push(snapshot) {
    this.stack.push(snapshot);
    while (this.stack.length > this.depth || (this.stack.length > 1 && this.bytes() > this.byteBudget)) this.stack.shift();
  }
  pop() { return this.stack.pop() || null; }
  peek() { return this.stack[this.stack.length - 1] || null; }
  clear() { this.stack.length = 0; }
  get length() { return this.stack.length; }
  bytes() {
    let b = 0;
    for (const s of this.stack) for (const a of Object.values(s.arrays || {})) b += a.byteLength;
    return b;
  }
}
