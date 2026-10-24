// The ONE place that listens to raw pointer input. Modules must never attach their own
// global pointer listeners — subscribe to 'gesture:*' (or 'pointer:*') on the bus instead.
//
// Responsibilities:
//  - Pointer Events (mouse, touch, pen) on the canvas element only
//  - per-pointer state with smoothed velocity and a short path history
//  - coalesced events for smooth fast swipes
//  - synthetic pointers (looper, autoplay, tests) through inject()
//  - forwards normalized pointer state to the GestureRecognizerHost
//
// UI/canvas conflict policy: the canvas has `touch-action: none`; UI controls live in a
// separate DOM layer above it and receive their own events. The canvas never sees
// touches that start on UI, and UI never sees touches that start on the canvas.

import { nextGestureId } from './gesture-events.js';
import { LIMITS } from '../config.js';

const PATH_LEN = 48;

export class PointerManager {
  constructor({ element, mapper, host, events, now = () => performance.now() }) {
    this.el = element; this.mapper = mapper; this.host = host; this.events = events; this.now = now;
    this.pointers = new Map();
    this.groupId = 0;
    this._handlers = null;
    this.enabled = true;
  }

  attach() {
    if (!this.el || this._handlers) return;
    const h = {
      pointerdown: (e) => this._down(e),
      pointermove: (e) => this._move(e),
      pointerup: (e) => this._up(e, false),
      pointercancel: (e) => this._up(e, true),
      lostpointercapture: (e) => { if (this.pointers.has(e.pointerId)) this._up(e, true); },
      contextmenu: (e) => e.preventDefault(),
    };
    for (const [k, fn] of Object.entries(h)) this.el.addEventListener(k, fn, { passive: false });
    this._handlers = h;
  }

  detach() {
    if (!this._handlers) return;
    for (const [k, fn] of Object.entries(this._handlers)) this.el.removeEventListener(k, fn);
    this._handlers = null;
  }

  activeCount() { return this.pointers.size; }
  list() { return [...this.pointers.values()]; }

  _record(id, nx, ny, type, pressure, pressureSupported, modifiers, synthetic) {
    const t = this.now();
    return {
      id, pointerType: type, synthetic,
      x: nx, y: ny, startX: nx, startY: ny, lastX: nx, lastY: ny,
      vx: 0, vy: 0, pressure, pressureSupported, modifiers,
      downAt: t, lastT: t, moved: 0, maxDist: 0,
      gestureId: nextGestureId(),
      path: new Float32Array(PATH_LEN * 3), pathLen: 0, pathHead: 0,
      data: {},   // scratch space for recognizers, keyed by recognizer id
    };
  }

  _pushPath(p, t) {
    const k = p.pathHead * 3;
    p.path[k] = p.x; p.path[k + 1] = p.y; p.path[k + 2] = t;
    p.pathHead = (p.pathHead + 1) % PATH_LEN;
    p.pathLen = Math.min(PATH_LEN, p.pathLen + 1);
  }

  _down(e) {
    if (!this.enabled) return;
    e.preventDefault();
    if (this.pointers.size >= LIMITS.maxPointers) return;
    try { this.el.setPointerCapture?.(e.pointerId); } catch {}
    const n = this.mapper.normalize(e.clientX, e.clientY);
    const hasPressure = e.pointerType === 'pen' || (e.pointerType === 'touch' && e.pressure > 0 && e.pressure !== 0.5);
    this.downAt(e.pointerId, n.x, n.y, {
      pointerType: e.pointerType || 'mouse', pressure: e.pressure || 0.5, pressureSupported: hasPressure,
      modifiers: { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey },
    });
  }

  _move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    const evs = list && list.length ? list : [e];
    for (const ev of evs) {
      const n = this.mapper.normalize(ev.clientX, ev.clientY);
      if (p.pressureSupported && ev.pressure > 0) p.pressure = ev.pressure;
      this.moveTo(e.pointerId, n.x, n.y, ev.timeStamp && evs.length > 1 ? null : undefined);
    }
  }

  _up(e, cancelled) {
    if (!this.pointers.has(e.pointerId)) return;
    if (e.clientX != null && !cancelled) {
      const n = this.mapper.normalize(e.clientX, e.clientY);
      this.moveTo(e.pointerId, n.x, n.y);
    }
    this.upAt(e.pointerId, cancelled);
  }

  // ---- Public, also used for synthetic input (tests, looper, autoplay) ----

  downAt(id, nx, ny, opts = {}) {
    if (this.pointers.has(id)) this.upAt(id, true);
    if (this.pointers.size >= LIMITS.maxPointers) return null;
    if (this.pointers.size === 0) this.groupId++;
    const p = this._record(id, nx, ny, opts.pointerType || 'synthetic', opts.pressure ?? 0.5,
      !!opts.pressureSupported, opts.modifiers || { shift: false, alt: false, ctrl: false, meta: false },
      opts.synthetic ?? (opts.pointerType == null || opts.pointerType === 'synthetic'));
    this.pointers.set(id, p);
    this._pushPath(p, p.downAt);
    this.events?.emit('pointer:down', p);
    this.host.down(p);
    return p;
  }

  moveTo(id, nx, ny) {
    const p = this.pointers.get(id);
    if (!p) return;
    const t = this.now();
    const dt = Math.max(0.001, (t - p.lastT) / 1000);
    p.lastX = p.x; p.lastY = p.y;
    p.x = nx; p.y = ny;
    const ux = this.mapper.unitsX(nx - p.lastX), uy = this.mapper.unitsY(ny - p.lastY);
    const ivx = ux / dt, ivy = uy / dt;
    const a = Math.min(1, dt * 18);   // ~55ms smoothing
    p.vx += (ivx - p.vx) * a; p.vy += (ivy - p.vy) * a;
    p.moved += Math.hypot(ux, uy);
    p.maxDist = Math.max(p.maxDist, this.mapper.unitDist(p.startX, p.startY, nx, ny));
    p.lastT = t;
    this._pushPath(p, t);
    this.events?.emit('pointer:move', p);
    this.host.move(p);
  }

  upAt(id, cancelled = false) {
    const p = this.pointers.get(id);
    if (!p) return;
    // Velocity decays if the finger paused before lifting.
    const idle = (this.now() - p.lastT) / 1000;
    if (idle > 0.06) { const k = Math.exp(-idle * 12); p.vx *= k; p.vy *= k; }
    this.host.up(p, cancelled);
    this.pointers.delete(id);
    this.events?.emit('pointer:up', p);
  }

  cancelAll() { for (const id of [...this.pointers.keys()]) this.upAt(id, true); }
}
