// The drawing board.
//
// Drawings are lists of operations, never pixels:
//   { id, type:'stroke', tool, color, size, pts:[x0,y0,x1,y1,…] }   (ints 0..10000)
//   { id, type:'clear' }
//
// A fill is just a one-point stroke (tool 'fill'): the tap. What it paints is
// worked out from the ops before it - see "Fill" below - so undo, replay, the
// gallery and remix all keep working with no special cases anywhere else.
//
// Everything is drawn in "board units": the board is 1000·√aspect wide and
// 1000/√aspect tall, so √(w·h) = 1000 and a brush size means the same thing
// on every screen. Rendering is deterministic (seeded by stroke id), so the
// drawer and the watcher build the same picture from the same operations.

import { COORD_MAX } from './shared.js';

const PATH_TOOLS = new Set(['pen', 'marker', 'neon']);   // drawn as one smooth path
// crayon / dots / rainbow / pixel / spray / stars / hearts / eraser are "stamped" piece by piece as points arrive

// Fill works on a raster of fixed size (pixels per board unit), not the
// screen's own, so every device floods the same shape: ~360k pixels whatever
// the aspect ratio.
const FILL_K = 0.6;
// How far (per RGB channel, out of 255) a pixel may differ from the tapped
// one and still count as the same region. Loose enough to swallow a line's
// anti-aliased fringe, tight enough not to leak into a neighbouring palette
// colour.
const FILL_TOL = 48;

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
    this.fills = new Map();   // fill op id -> { sig, cw, ch, mask } (see computeFill)
    // Studio only: my own finished strokes the server hasn't echoed back yet.
    // They always sit at the tail of `ops`, so other people's strokes that
    // arrive meanwhile slot in before them - see remoteOp().
    this.pending = new Set();
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
    this.pending.clear();
    this.rebuild();
  }

  // ── Shared canvas (free-draw studio) ─────────────────────
  //
  // Everyone draws at once, so there is no single "drawer" whose order is
  // the order. The server's order is the truth: my own strokes are drawn at
  // once (pending), and anyone else's land before any of mine that haven't
  // been confirmed yet - which is exactly where the server put them.

  markPending(id, props) {
    const op = this.ops.find((o) => o.id === id);
    if (!op) return;
    Object.assign(op, props);
    this.pending.add(id);
  }

  confirm(id) { this.pending.delete(id); }

  remoteOp(op) {
    if (this.ops.some((o) => o.id === op.id)) return;
    const o = { ...op, pts: op.pts ? op.pts.slice() : undefined };
    let at = this.ops.findIndex((x) => this.pending.has(x.id));
    if (at < 0) at = this.ops.length;
    if (at === this.ops.length && !this.active && o.type === 'stroke') {
      if (o.tool === 'fill') this.applyFill(o); else this.renderOp(this.bctx, o);
      this.ops.push(o);
      return;
    }
    this.ops.splice(at, 0, o);
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
    if (a.tool === 'fill') return;   // nothing to draw until the tap is finished
    if (PATH_TOOLS.has(a.tool)) this.queueLive();
    else this.stamp(this.bctx, a, false);
  }

  end(id) {
    const a = this.active;
    if (!a || a.id !== id) return;
    this.active = null;
    if (a.tool === 'fill') {
      if (!a.pts.length) return;
      this.applyFill(a);
    } else if (PATH_TOOLS.has(a.tool)) {
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
    const start = this.lastClear() + 1;
    this.paintOps(c, this.ops, start, this.ops.length);
    // Forget cached fills for ops that no longer exist (undone / cleared).
    const live = new Set(this.ops.slice(start).map((o) => o.id));
    for (const id of this.fills.keys()) if (!live.has(id)) this.fills.delete(id);
    if (this.active && this.active.tool !== 'fill') {
      if (PATH_TOOLS.has(this.active.tool)) this.queueLive();
      else { this.active._r = null; this.stamp(c, this.active, false); }
    }
  }

  lastClear() {
    let last = -1;
    this.ops.forEach((o, i) => { if (o.type === 'clear') last = i; });
    return last;
  }

  renderOp(c, op, scale = this.scale) {
    if (op.type !== 'stroke' || op.tool === 'fill') return;
    if (PATH_TOOLS.has(op.tool)) this.drawPath(c, op, scale);
    else { op._r = null; this.stamp(c, op, true, scale); delete op._r; }
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
  drawPath(c, op, scale = this.scale) {
    const p = this.unitPoints(op.pts);
    const n = p.length / 2;
    if (!n) return;
    c.save();
    c.setTransform(scale, 0, 0, scale, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.strokeStyle = c.fillStyle = op.color;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.lineWidth = op.size;
    if (op.tool === 'marker') {
      c.globalAlpha = 0.82;
      c.shadowColor = op.color;
      c.shadowBlur = op.size * 0.35 * scale;
    }
    const neon = op.tool === 'neon';
    if (neon) {
      // A glowing halo in the colour, then a brighter, thinner core on top.
      c.shadowColor = op.color;
      c.shadowBlur = op.size * 1.1 * scale;
    }
    const trace = () => {
      if (n === 1) {
        c.beginPath();
        c.arc(p[0], p[1], c.lineWidth / 2, 0, Math.PI * 2);
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
    };
    trace();
    if (neon) {
      c.shadowBlur = 0;
      c.strokeStyle = c.fillStyle = lighten(op.color, 0.65);
      c.lineWidth = op.size * 0.4;
      trace();
    }
    c.restore();
  }

  // Stamped tools: walk the same smoothed curve in small fixed steps
  // (in board units, so every device takes identical steps).
  stamp(c, op, finish, scale = this.scale) {
    const p = this.unitPoints(op.pts);
    const n = p.length / 2;
    if (!op._r) op._r = { i: 0, lx: 0, ly: 0, dist: 0, acc: 0, rng: seeded(op.id), started: false, k: scale };
    const st = op._r;
    const brush = BRUSHES[op.tool];
    if (!brush || !n) return;
    c.save();
    c.setTransform(scale, 0, 0, scale, 0, 0);
    brush.setup(c, op, scale);

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

  // ── Fill ─────────────────────────────────────────────────
  //
  // A fill paints "the region you tapped", which depends on everything drawn
  // before it. So it's resolved the same way on every screen: render the ops
  // before it onto a raster of fixed size (the "canon"), flood from the tapped
  // pixel, and keep the result as a mask. The mask is then painted onto
  // whatever canvas is being built, scaled to fit. Masks are cached per fill,
  // keyed by the exact list of ops before it, so a resize or an undo of
  // something *after* the fill never re-floods; undoing something *before* it
  // does, and the fill simply re-fits itself to what's left.

  newCanon() {
    const cw = Math.max(1, Math.round(this.Wu * FILL_K));
    const ch = Math.max(1, Math.round(this.Hu * FILL_K));
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    return { cv, ctx: cv.getContext('2d'), cw, ch, k: cw / this.Wu };
  }

  fillSig(list, start, end) {
    let sig = this.aspect.toFixed(4);
    for (let i = start; i < end; i++) sig += ',' + list[i].id;
    return sig;
  }

  // Renders list[start..end) onto `c` (the device canvas; may be null) and,
  // whenever a fill has to be (re)computed, onto a running canon as well.
  // Returns the canon if one was built (always, with `force`).
  paintOps(c, list, start, end, force = false) {
    let canon = force ? this.newCanon() : null;
    for (let i = start; i < end; i++) {
      const o = list[i];
      if (o.type !== 'stroke') continue;
      if (o.tool === 'fill') {
        const sig = this.fillSig(list, start, i);
        let f = this.fills.get(o.id);
        if (!f || f.sig !== sig) {
          if (!canon) canon = this.paintOps(null, list, start, i, true);
          f = this.computeFill(o, canon, sig);
          this.fills.set(o.id, f);
        }
        if (c) this.paintMask(c, f, o.color, o.size);
        if (canon) this.paintMask(canon.ctx, f, o.color, o.size);
      } else {
        if (c) this.renderOp(c, o);
        if (canon) this.renderOp(canon.ctx, o, canon.k);
      }
    }
    return canon;
  }

  // A fill the user has just finished: everything already finished is the
  // "before" it fills against.
  applyFill(a) {
    const start = this.lastClear() + 1;
    const end = this.ops.length;
    const canon = this.paintOps(null, this.ops, start, end, true);
    const f = this.computeFill(a, canon, this.fillSig(this.ops, start, end));
    this.fills.set(a.id, f);
    this.paintMask(this.bctx, f, a.color, a.size);
  }

  computeFill(op, canon, sig) {
    const { cv, cw, ch } = canon;
    // Composite over white paper so white ink and bare paper are one region.
    const comp = document.createElement('canvas');
    comp.width = cw; comp.height = ch;
    const x = comp.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#fff';
    x.fillRect(0, 0, cw, ch);
    x.drawImage(cv, 0, 0);
    const data = x.getImageData(0, 0, cw, ch).data;
    const sx = Math.min(cw - 1, Math.max(0, Math.floor((op.pts[0] / COORD_MAX) * cw)));
    const sy = Math.min(ch - 1, Math.max(0, Math.floor((op.pts[1] / COORD_MAX) * ch)));
    const mask = dilate(floodMask(data, cw, ch, sx, sy, FILL_TOL), cw, ch);
    return { sig, cw, ch, mask };
  }

  // Paints a fill mask in `color` over the whole of `c`, scaled to fit.
  // `pat` is the fill's size: 1 = solid, 2.. = a pattern (see FILL_PATTERNS).
  paintMask(c, f, color, pat = 1) {
    const sc = document.createElement('canvas');
    sc.width = f.cw; sc.height = f.ch;
    const sctx = sc.getContext('2d');
    const img = sctx.createImageData(f.cw, f.ch);
    const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
    const d = img.data, m = f.mask;
    for (let i = 0; i < m.length; i++) {
      if (!m[i]) continue;
      const j = i * 4;
      d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    if (pat > 1) {
      // Keep the mask only where the pattern has paint. The tile is sized on
      // the canon grid, so the pattern is the same on every screen.
      const T = Math.max(8, 2 * Math.round(f.cw / 76));
      sctx.globalCompositeOperation = 'destination-in';
      sctx.fillStyle = sctx.createPattern(patternTile(pat, color, T), 'repeat');
      sctx.fillRect(0, 0, f.cw, f.ch);
    }
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(sc, 0, 0, f.cw, f.ch, 0, 0, c.canvas.width, c.canvas.height);
    c.restore();
  }
}

// Scanline flood fill: every pixel connected to (sx, sy) whose colour is
// within `tol` of it on each channel. Returns a 0/1 mask.
function floodMask(d, w, h, sx, sy, tol) {
  const mask = new Uint8Array(w * h);
  const p0 = (sy * w + sx) * 4;
  const r = d[p0], g = d[p0 + 1], b = d[p0 + 2];
  const inside = (i) => {
    const p = i * 4;
    return Math.abs(d[p] - r) <= tol && Math.abs(d[p + 1] - g) <= tol && Math.abs(d[p + 2] - b) <= tol;
  };
  const stack = [sx, sy];
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    let lx = x;
    while (lx >= 0 && !mask[y * w + lx] && inside(y * w + lx)) lx--;
    lx++;
    let up = false, down = false;
    for (let cx = lx; cx < w && !mask[y * w + cx] && inside(y * w + cx); cx++) {
      mask[y * w + cx] = 1;
      if (y > 0) {
        const ok = !mask[(y - 1) * w + cx] && inside((y - 1) * w + cx);
        if (ok && !up) { stack.push(cx, y - 1); up = true; } else if (!ok) up = false;
      }
      if (y < h - 1) {
        const ok = !mask[(y + 1) * w + cx] && inside((y + 1) * w + cx);
        if (ok && !down) { stack.push(cx, y + 1); down = true; } else if (!ok) down = false;
      }
    }
  }
  return mask;
}

// Grows a mask by one pixel in every direction, so the fill tucks under the
// anti-aliased edge of the line around it instead of leaving a pale halo.
function dilate(m, w, h) {
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (m[i]) { out[i] = 1; continue; }
      const l = x > 0, rt = x < w - 1, u = y > 0, dn = y < h - 1;
      if ((l && m[i - 1]) || (rt && m[i + 1]) || (u && m[i - w]) || (dn && m[i + w]) ||
          (l && u && m[i - w - 1]) || (rt && u && m[i - w + 1]) ||
          (l && dn && m[i + w - 1]) || (rt && dn && m[i + w + 1])) out[i] = 1;
    }
  }
  return out;
}

// ── Brushes ───────────────────────────────────────────────

// Mixes a #rrggbb colour toward white by `t` (0..1).
function lighten(hex, t) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (v) => Math.round(v + (255 - v) * t);
  return `rgb(${mix(n >> 16)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}

// Tiles for pattern fills, in canon pixels (the same fixed grid on every
// screen), drawn in `color` on transparent so whatever is underneath shows
// through the gaps.
const tileCache = new Map();
function patternTile(pat, color, T) {
  const key = pat + color + T;
  let cv = tileCache.get(key);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = cv.height = T;
  const x = cv.getContext('2d');
  x.fillStyle = x.strokeStyle = color;
  x.lineCap = 'butt';
  if (pat === 2) {            // diagonal stripes (wrap-around lines keep the tile seamless)
    x.lineWidth = T * 0.3;
    x.beginPath();
    for (const o of [-T / 2, 0, T / 2]) { x.moveTo(o, T + o); x.lineTo(T + o, o); }
    x.stroke();
  } else if (pat === 3) {     // polka dots, every other row shifted
    const r = T * 0.17;
    for (const [px, py] of [[T / 2, T / 2], [0, 0], [T, 0], [0, T], [T, T]]) {
      x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
    }
  } else if (pat === 4) {     // checkerboard
    x.fillRect(0, 0, T / 2, T / 2);
    x.fillRect(T / 2, T / 2, T / 2, T / 2);
  } else if (pat === 5) {     // waves
    x.lineWidth = T * 0.16;
    x.beginPath();
    x.moveTo(0, T / 2);
    x.quadraticCurveTo(T / 4, 0, T / 2, T / 2);
    x.quadraticCurveTo(T * 0.75, T, T, T / 2);
    x.stroke();
  } else if (pat === 6) {     // little stars
    starPath(x, T / 2, T / 2, T * 0.36, 0);
    x.fill();
  }
  tileCache.set(key, cv);
  return cv;
}

// A small preview of fill pattern `pat` (1 = solid) in `color`, for the tray.
export function drawPatternSwatch(cv, pat, color) {
  cv.width = cv.height = 72;
  const x = cv.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(0, 0, 72, 72);
  if (pat === 1) { x.fillStyle = color; x.fillRect(0, 0, 72, 72); return; }
  x.fillStyle = x.createPattern(patternTile(pat, color, 24), 'repeat');
  x.fillRect(0, 0, 72, 72);
}

// A five-pointed star centred on (cx, cy), `r` to the tips, turned by `rot`.
function starPath(c, cx, cy, r, rot) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot - Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
    if (i) c.lineTo(px, py); else c.moveTo(px, py);
  }
  c.closePath();
}

// Walks a segment dropping a stamp every `gap` units, carrying the leftover
// distance in st.acc so the spacing is even across segments.
function stampAlong(st, x0, y0, x1, y1, gap, drop) {
  const seg = Math.hypot(x1 - x0, y1 - y0);
  if (!seg) return;
  let at = 0;
  while (st.acc + (seg - at) >= gap) {
    at += gap - st.acc;
    st.acc = 0;
    const t = at / seg;
    drop(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
  }
  st.acc += seg - at;
}

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

  // Pixel: the point snaps to a grid of `op.size` board units and fills that
  // whole cell. Cells are laid on whole *device* pixels, so neighbours meet
  // exactly with no hairline seam whatever the screen's scale.
  pixel: {
    setup(c) { c.globalCompositeOperation = 'source-over'; },
    cell(c, op, st, x, y) {
      const s = op.size;
      const cx = Math.floor(x / s), cy = Math.floor(y / s);
      const key = cy * 4096 + cx;
      if (st.cells.has(key)) return;
      st.cells.add(key);
      const k = st.k;
      const x0 = Math.round(cx * s * k), x1 = Math.round((cx + 1) * s * k);
      const y0 = Math.round(cy * s * k), y1 = Math.round((cy + 1) * s * k);
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = op.color;
      c.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
      c.restore();
    },
    start(c, op, st, x, y) { st.cells = new Set(); this.cell(c, op, st, x, y); },
    piece(c, op, st, x0, y0, x1, y1) { this.cell(c, op, st, x1, y1); },
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

  // Studio brushes. Like dots, each drops a stamp every so often along the
  // line; the seeded rng (stroke id) picks each stamp's turn, so every screen
  // scatters them identically.
  stars: {
    setup(c, op) { c.globalCompositeOperation = 'source-over'; c.fillStyle = op.color; },
    drop(c, op, st, x, y) {
      starPath(c, x, y, op.size / 2, (st.rng() - 0.5) * 1.2);
      c.fill();
    },
    start(c, op, st, x, y) { st.acc = 0; this.drop(c, op, st, x, y); },
    piece(c, op, st, x0, y0, x1, y1) {
      stampAlong(st, x0, y0, x1, y1, op.size * 1.05, (x, y) => this.drop(c, op, st, x, y));
    },
  },

  hearts: {
    setup(c, op) { c.globalCompositeOperation = 'source-over'; c.fillStyle = op.color; },
    drop(c, op, st, x, y) {
      const r = op.size / 2, a = (st.rng() - 0.5) * 0.7;
      c.save();
      c.translate(x, y); c.rotate(a);
      c.beginPath();
      c.moveTo(0, r * 0.9);
      c.bezierCurveTo(-r * 1.5, -r * 0.1, -r * 0.7, -r * 1.1, 0, -r * 0.4);
      c.bezierCurveTo(r * 0.7, -r * 1.1, r * 1.5, -r * 0.1, 0, r * 0.9);
      c.fill();
      c.restore();
    },
    start(c, op, st, x, y) { st.acc = 0; this.drop(c, op, st, x, y); },
    piece(c, op, st, x0, y0, x1, y1) {
      stampAlong(st, x0, y0, x1, y1, op.size * 1.1, (x, y) => this.drop(c, op, st, x, y));
    },
  },

  // Airbrush: a soft cloud of tiny round specks.
  spray: {
    setup(c, op) { c.globalCompositeOperation = 'source-over'; c.fillStyle = op.color; },
    puff(c, op, st, x, y) {
      const r = op.size / 2;
      const specks = Math.round(op.size * 1.1) + 8;
      for (let k = 0; k < specks; k++) {
        const a = st.rng() * Math.PI * 2;
        const d = Math.sqrt(st.rng()) * r;
        c.globalAlpha = 0.35 + st.rng() * 0.6;
        c.beginPath();
        c.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 0.6 + st.rng() * 1.0, 0, Math.PI * 2);
        c.fill();
      }
    },
    start(c, op, st, x, y) { st.acc = 0; this.puff(c, op, st, x, y); },
    piece(c, op, st, x0, y0, x1, y1) {
      stampAlong(st, x0, y0, x1, y1, Math.max(2, op.size * 0.18), (x, y) => this.puff(c, op, st, x, y));
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
