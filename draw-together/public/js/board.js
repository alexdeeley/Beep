// The drawing board.
//
// Drawings are lists of operations, never pixels:
//   { id, type:'stroke', tool, color, size, pts:[x0,y0,x1,y1,…] }   (ints 0..10000)
//   { id, type:'clear' }
//
// Everything is drawn in "board units": the board is 1000·√aspect wide and
// 1000/√aspect tall, so √(w·h) = 1000 and a brush size means the same thing
// on every screen. Rendering is deterministic (seeded by stroke id), so the
// drawer and the watcher build the same picture from the same operations.

import { COORD_MAX } from './shared.js';

const PATH_TOOLS = new Set(['pen', 'marker']);   // drawn as one smooth path
// crayon / dots / rainbow / eraser are "stamped" piece by piece as points arrive

export class Board {
  constructor(host, { onLayout } = {}) {
    this.host = host;
    this.sheet = document.createElement('div');
    this.sheet.className = 'sheet';
    this.base = document.createElement('canvas');
    this.live = document.createElement('canvas');
    this.base.className = 'layer';
    this.live.className = 'layer';
    this.base.setAttribute('aria-hidden', 'true');
    this.live.setAttribute('aria-hidden', 'true');
    this.sheet.append(this.base, this.live);
    host.append(this.sheet);
    this.bctx = this.base.getContext('2d');
    this.lctx = this.live.getContext('2d');
    this.aspect = 1;
    this.ops = [];
    this.active = null;
    this.scale = 1;
    this.onLayout = onLayout;
    this.liveQueued = false;
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(host);
  }

  get Wu() { return 1000 * Math.sqrt(this.aspect); }
  get Hu() { return 1000 / Math.sqrt(this.aspect); }

  setAspect(a) {
    if (!a || Math.abs(a - this.aspect) < 1e-4) return;
    this.aspect = a;
    this.layout();
  }

  // Fit the sheet into the host at the board's aspect ratio (letterboxed).
  layout() {
    const r = this.host.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    let w = r.width, h = w / this.aspect;
    if (h > r.height) { h = r.height; w = h * this.aspect; }
    w = Math.floor(w); h = Math.floor(h);
    this.sheet.style.width = w + 'px';
    this.sheet.style.height = h + 'px';
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    // Keep memory sane on huge screens (iOS has strict canvas limits).
    const k = Math.min(dpr, Math.sqrt(5_000_000 / (w * h)));
    const pw = Math.round(w * k), ph = Math.round(h * k);
    if (this.base.width !== pw || this.base.height !== ph) {
      for (const c of [this.base, this.live]) { c.width = pw; c.height = ph; }
    }
    this.scale = pw / this.Wu;
    this.rebuild();
    this.onLayout?.(w, h);
  }

  // Pointer position → board integer coordinates
  toBoard(clientX, clientY) {
    const r = this.sheet.getBoundingClientRect();
    const x = Math.round(((clientX - r.left) / r.width) * COORD_MAX);
    const y = Math.round(((clientY - r.top) / r.height) * COORD_MAX);
    return [Math.max(0, Math.min(COORD_MAX, x)), Math.max(0, Math.min(COORD_MAX, y))];
  }

  // ── Operation API ────────────────────────────────────────

  load(ops, active) {
    this.ops = (ops || []).map((o) => ({ ...o, pts: o.pts ? o.pts.slice() : undefined }));
    this.active = active ? { ...active, pts: active.pts.slice() } : null;
    this.rebuild();
  }

  reset() { this.load([], null); }

  begin(op) {
    if (this.active) this.end(this.active.id);
    this.active = { ...op, type: 'stroke', pts: [] };
    this.active._r = null;
    this.add(op.id, op.pts);
  }

  add(id, pts) {
    const a = this.active;
    if (!a || a.id !== id || !pts?.length) return;
    for (const v of pts) a.pts.push(v);
    if (PATH_TOOLS.has(a.tool)) this.queueLive();
    else this.stamp(this.bctx, a, false);
  }

  end(id) {
    const a = this.active;
    if (!a || a.id !== id) return;
    this.active = null;
    if (PATH_TOOLS.has(a.tool)) {
      this.lctx.setTransform(1, 0, 0, 1, 0, 0);
      this.lctx.clearRect(0, 0, this.live.width, this.live.height);
      this.drawPath(this.bctx, a);
    } else {
      this.stamp(this.bctx, a, true);
    }
    delete a._r;
    this.ops.push(a);
  }

  undo(id) {
    const i = this.ops.findIndex((o) => o.id === id);
    if (i >= 0) { this.ops.splice(i, 1); this.rebuild(); }
  }

  clear(id) {
    if (this.active) this.end(this.active.id);
    this.ops.push({ id, type: 'clear' });
    this.rebuild();
  }

  hasInk() {
    let last = -1;
    this.ops.forEach((o, i) => { if (o.type === 'clear') last = i; });
    return this.ops.length - 1 > last || !!this.active;
  }

  // ── Rendering ────────────────────────────────────────────

  rebuild() {
    const c = this.bctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.base.width, this.base.height);
    this.lctx.setTransform(1, 0, 0, 1, 0, 0);
    this.lctx.clearRect(0, 0, this.live.width, this.live.height);
    let start = 0;
    this.ops.forEach((o, i) => { if (o.type === 'clear') start = i + 1; });
    for (let i = start; i < this.ops.length; i++) this.renderOp(c, this.ops[i]);
    if (this.active) {
      if (PATH_TOOLS.has(this.active.tool)) this.queueLive();
      else { this.active._r = null; this.stamp(c, this.active, false); }
    }
  }

  renderOp(c, op) {
    if (op.type !== 'stroke') return;
    if (PATH_TOOLS.has(op.tool)) this.drawPath(c, op);
    else { op._r = null; this.stamp(c, op, true); delete op._r; }
  }

  queueLive() {
    if (this.liveQueued) return;
    this.liveQueued = true;
    requestAnimationFrame(() => {
      this.liveQueued = false;
      const c = this.lctx;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, this.live.width, this.live.height);
      if (this.active && PATH_TOOLS.has(this.active.tool)) this.drawPath(c, this.active);
    });
  }

  unitPoints(pts) {
    const out = new Array(pts.length);
    const sx = this.Wu / COORD_MAX, sy = this.Hu / COORD_MAX;
    for (let i = 0; i < pts.length; i += 2) { out[i] = pts[i] * sx; out[i + 1] = pts[i + 1] * sy; }
    return out;
  }

  // Pen + marker: one smooth quadratic path through the midpoints.
  drawPath(c, op) {
    const p = this.unitPoints(op.pts);
    const n = p.length / 2;
    if (!n) return;
    c.save();
    c.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.strokeStyle = c.fillStyle = op.color;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.lineWidth = op.size;
    if (op.tool === 'marker') {
      c.globalAlpha = 0.82;
      c.shadowColor = op.color;
      c.shadowBlur = op.size * 0.35 * this.scale;
    }
    if (n === 1) {
      c.beginPath();
      c.arc(p[0], p[1], op.size / 2, 0, Math.PI * 2);
      c.fill();
    } else {
      c.beginPath();
      c.moveTo(p[0], p[1]);
      for (let i = 1; i < n - 1; i++) {
        const mx = (p[i * 2] + p[i * 2 + 2]) / 2, my = (p[i * 2 + 1] + p[i * 2 + 3]) / 2;
        c.quadraticCurveTo(p[i * 2], p[i * 2 + 1], mx, my);
      }
      c.lineTo(p[(n - 1) * 2], p[(n - 1) * 2 + 1]);
      c.stroke();
    }
    c.restore();
  }

  // Stamped tools: walk the same smoothed curve in small fixed steps
  // (in board units, so every device takes identical steps).
  stamp(c, op, finish) {
    const p = this.unitPoints(op.pts);
    const n = p.length / 2;
    if (!op._r) op._r = { i: 0, lx: 0, ly: 0, dist: 0, acc: 0, rng: seeded(op.id), started: false };
    const st = op._r;
    const brush = BRUSHES[op.tool];
    if (!brush || !n) return;
    c.save();
    c.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    brush.setup(c, op, this.scale);

    const emit = (x, y) => {
      brush.piece(c, op, st, st.px, st.py, x, y);
      st.px = x; st.py = y;
    };
    const curve = (x0, y0, cx, cy, x1, y1) => {
      const len = Math.hypot(cx - x0, cy - y0) + Math.hypot(x1 - cx, y1 - cy);
      const steps = Math.max(1, Math.ceil(len / 2.5));
      for (let s = 1; s <= steps; s++) {
        const t = s / steps, u = 1 - t;
        emit(u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1);
      }
    };

    for (; st.i < n; st.i++) {
      const i = st.i, x = p[i * 2], y = p[i * 2 + 1];
      if (i === 0) {
        st.px = x; st.py = y; st.lx = x; st.ly = y;
        brush.start(c, op, st, x, y);
        continue;
      }
      const px = p[i * 2 - 2], py = p[i * 2 - 1];
      const mx = (px + x) / 2, my = (py + y) / 2;
      curve(st.lx, st.ly, px, py, mx, my);
      st.lx = mx; st.ly = my;
    }
    if (finish && n > 1) {
      const x = p[(n - 1) * 2], y = p[(n - 1) * 2 + 1];
      curve(st.lx, st.ly, (st.lx + x) / 2, (st.ly + y) / 2, x, y);
    }
    c.restore();
  }
}

// ── Brushes ───────────────────────────────────────────────

function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BRUSHES = {
  eraser: {
    setup(c, op) {
      c.globalCompositeOperation = 'destination-out';
      c.strokeStyle = c.fillStyle = '#000';
      c.lineCap = 'round';
      c.lineWidth = op.size;
    },
    start(c, op, st, x, y) {
      c.beginPath(); c.arc(x, y, op.size / 2, 0, Math.PI * 2); c.fill();
    },
    piece(c, op, st, x0, y0, x1, y1) {
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    },
  },

  rainbow: {
    setup(c, op) {
      c.globalCompositeOperation = 'source-over';
      c.lineCap = 'round';
      c.lineWidth = op.size;
    },
    hue(op, st) {
      if (st.hue0 === undefined) st.hue0 = Math.floor(st.rng() * 360);
      return (st.hue0 + st.dist * 0.45) % 360;
    },
    start(c, op, st, x, y) {
      c.fillStyle = `hsl(${this.hue(op, st)} 88% 52%)`;
      c.beginPath(); c.arc(x, y, op.size / 2, 0, Math.PI * 2); c.fill();
    },
    piece(c, op, st, x0, y0, x1, y1) {
      st.dist += Math.hypot(x1 - x0, y1 - y0);
      c.strokeStyle = `hsl(${this.hue(op, st)} 88% 52%)`;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    },
  },

  dots: {
    setup(c, op) {
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = op.color;
    },
    start(c, op, st, x, y) {
      c.beginPath(); c.arc(x, y, op.size / 2, 0, Math.PI * 2); c.fill();
      st.acc = 0;
    },
    piece(c, op, st, x0, y0, x1, y1) {
      const gap = op.size * 1.45;
      let len = Math.hypot(x1 - x0, y1 - y0);
      if (!len) return;
      let t0 = 0;
      while (st.acc + len >= gap) {
        const need = gap - st.acc;
        t0 += need / Math.hypot(x1 - x0, y1 - y0);
        const x = x0 + (x1 - x0) * t0, y = y0 + (y1 - y0) * t0;
        c.beginPath(); c.arc(x, y, op.size / 2, 0, Math.PI * 2); c.fill();
        len -= need;
        st.acc = 0;
      }
      st.acc += len;
    },
  },

  crayon: {
    setup(c, op) {
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = c.strokeStyle = op.color;
      c.lineCap = 'butt';
    },
    grain(c, op, st, x, y) {
      const r = op.size / 2;
      const specks = Math.round(op.size * 0.85) + 4;
      for (let k = 0; k < specks; k++) {
        const a = st.rng() * Math.PI * 2;
        const d = Math.sqrt(st.rng()) * r;
        const s = 0.9 + st.rng() * 1.8;
        c.globalAlpha = 0.35 + st.rng() * 0.55;
        c.fillRect(x + Math.cos(a) * d - s / 2, y + Math.sin(a) * d - s / 2, s, s);
      }
    },
    start(c, op, st, x, y) {
      st.acc = 0;
      this.grain(c, op, st, x, y);
    },
    piece(c, op, st, x0, y0, x1, y1) {
      const len = Math.hypot(x1 - x0, y1 - y0);
      // waxy base, slightly wobbly
      c.globalAlpha = 0.28;
      c.lineWidth = op.size * (0.7 + st.rng() * 0.15);
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
      st.acc += len;
      const step = Math.max(1.5, op.size * 0.3);
      while (st.acc >= step) {
        st.acc -= step;
        const t = len ? 1 - st.acc / len : 1;
        const tt = Math.max(0, Math.min(1, t));
        this.grain(c, op, st, x0 + (x1 - x0) * tt, y0 + (y1 - y0) * tt);
      }
    },
  },
};

// ── Replay ────────────────────────────────────────────────
// Rebuilds a finished drawing on another board over `ms` milliseconds.
export function replay(board, ops, ms = 3000, onDone) {
  let start = 0;
  ops.forEach((o, i) => { if (o.type === 'clear') start = i + 1; });
  const list = ops.slice(start).filter((o) => o.type === 'stroke');
  const total = list.reduce((s, o) => s + o.pts.length / 2, 0);
  board.reset();
  if (!total) { onDone?.(); return () => {}; }
  let oi = 0, pi = 0, done = 0, t0 = performance.now(), raf = 0, stopped = false;
  const tick = (now) => {
    if (stopped) return;
    const target = Math.min(total, Math.ceil(((now - t0) / ms) * total));
    while (done < target && oi < list.length) {
      const op = list[oi];
      const n = op.pts.length / 2;
      const take = Math.min(n - pi, target - done);
      const chunk = op.pts.slice(pi * 2, (pi + take) * 2);
      if (pi === 0) board.begin({ ...op, pts: chunk });
      else board.add(op.id, chunk);
      pi += take; done += take;
      if (pi >= n) { board.end(op.id); oi++; pi = 0; }
    }
    if (done >= total) { onDone?.(); return; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => { stopped = true; cancelAnimationFrame(raf); };
}
