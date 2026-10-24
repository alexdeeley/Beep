// Built-in gesture recognizers. Each is an independent registry entry; they cooperate only
// through shared pointer records. Thresholds are in device-independent units
// (1 unit = short side of the canvas) and seconds.

import { forLine } from '../grid/spatial-query.js';

export const T = {
  tapMaxDist: 0.035, tapMaxTime: 0.3,
  doubleTapTime: 0.32, doubleTapDist: 0.09,
  dragStart: 0.022,
  swipeSpeed: 1.1,
  holdDelay: 0.35, holdMaxDrift: 0.03, holdFull: 2.5,
  reverseDot: -0.45, reverseMinSpeed: 0.35, reverseCooldown: 0.16,
  rhythmMin: 0.11, rhythmMax: 1.3, rhythmTolerance: 0.28,
};

// ---- press / release: immediate feedback the moment a finger lands ----
export const pressRecognizer = {
  id: 'press', name: 'PRESS', description: 'Fires immediately on pointer down and up.',
  emits: ['press', 'release'],
  down(p, ctx) { ctx.emit('press', p); },
  up(p, ctx, cancelled) { if (!cancelled) ctx.emit('release', p, { distance: p.moved }); },
};

// ---- tap, double tap, rhythmic taps ----
export const tapRecognizer = {
  id: 'tap', name: 'TAP', description: 'Tap, double tap and rhythmic tap sequences.',
  emits: ['tap', 'doubletap', 'rhythm'],
  _last: null, _times: [],
  up(p, ctx, cancelled) {
    if (cancelled) return;
    const dur = (ctx.now() - p.downAt) / 1000;
    if (p.maxDist > T.tapMaxDist || dur > T.tapMaxTime) return;
    const now = ctx.now() / 1000;
    ctx.emit('tap', p);
    const last = this._last;
    if (last && now - last.t < T.doubleTapTime && ctx.mapper.unitDist(last.x, last.y, p.x, p.y) < T.doubleTapDist) {
      ctx.emit('doubletap', p);
      this._last = null;
    } else this._last = { t: now, x: p.x, y: p.y };
    // Rhythm: any taps anywhere, evenly spaced.
    const times = this._times;
    times.push(now);
    while (times.length > 8 || (times.length && now - times[0] > 6)) times.shift();
    if (times.length >= 3) {
      const iv = []; for (let i = 1; i < times.length; i++) iv.push(times[i] - times[i - 1]);
      const recent = iv.slice(-3);
      const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
      if (mean >= T.rhythmMin && mean <= T.rhythmMax && recent.every((v) => Math.abs(v - mean) / mean < T.rhythmTolerance)) {
        let bpm = 60 / mean;
        while (bpm < 60) bpm *= 2;
        while (bpm > 200) bpm /= 2;
        ctx.emit('rhythm', p, { interval: mean, bpm: Math.round(bpm), count: recent.length + 1 });
      }
    }
  },
  reset() { this._last = null; this._times = []; },
};

// ---- drag / swipe / reverse / circle ----
export const dragRecognizer = {
  id: 'drag', name: 'DRAG', description: 'Drag with gap-free cell paths, direction reversal, circles and swipes.',
  emits: ['drag:start', 'drag', 'drag:reverse', 'drag:end', 'swipe', 'circle'],
  down(p, ctx) {
    const g = ctx.mapper.toGrid(p.x, p.y);
    p.data.drag = { active: false, gx: g.gridX, gy: g.gridY, dir: null, lastRev: 0, turn: 0, turnStart: 0, lastAng: null, cx: p.x, cy: p.y };
  },
  move(p, ctx) {
    const d = p.data.drag; if (!d) return;
    if (!d.active) {
      if (p.maxDist < T.dragStart) return;
      d.active = true;
      ctx.emit('drag:start', p);
    }
    // Gap-free cell path since the previous event (Bresenham interpolation).
    const g = ctx.mapper.toGrid(p.x, p.y);
    const cells = [];
    if (g.gridX !== d.gx || g.gridY !== d.gy) {
      forLine(ctx.grid, d.gx, d.gy, g.gridX, g.gridY, (i, gx, gy) => cells.push({ i, gx, gy }), true);
      d.gx = g.gridX; d.gy = g.gridY;
    }
    const speed = Math.hypot(p.vx, p.vy);
    const now = ctx.now() / 1000;
    // Direction reversal.
    if (speed > T.reverseMinSpeed) {
      const ux = p.vx / speed, uy = p.vy / speed;
      if (d.dir) {
        const dot = ux * d.dir[0] + uy * d.dir[1];
        if (dot < T.reverseDot && now - d.lastRev > T.reverseCooldown) {
          d.lastRev = now;
          ctx.emit('drag:reverse', p, { previousDirection: Math.atan2(d.dir[1], d.dir[0]) });
          d.dir = [ux, uy];
        } else { d.dir[0] = d.dir[0] * 0.8 + ux * 0.2; d.dir[1] = d.dir[1] * 0.8 + uy * 0.2; const m = Math.hypot(d.dir[0], d.dir[1]) || 1; d.dir[0] /= m; d.dir[1] /= m; }
      } else d.dir = [ux, uy];
      // Circle detection: integrate turning of the heading.
      const ang = Math.atan2(p.vy, p.vx);
      if (d.lastAng != null) {
        let da = ang - d.lastAng;
        if (da > Math.PI) da -= Math.PI * 2; else if (da < -Math.PI) da += Math.PI * 2;
        if (Math.abs(da) < 1.2) {
          if (d.turn === 0) d.turnStart = now;
          if (Math.sign(da) !== Math.sign(d.turn) && Math.abs(d.turn) > 0.5) { d.turn = 0; d.turnStart = now; }
          d.turn += da;
        }
        if (Math.abs(d.turn) >= Math.PI * 2) {
          const elapsed = Math.max(0.05, now - d.turnStart);
          // Estimate loop radius from recent path extent.
          let minX = 1, maxX = 0, minY = 1, maxY = 0;
          for (let k = 0; k < p.pathLen; k++) { const x = p.path[k * 3], y = p.path[k * 3 + 1]; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
          const radius = (ctx.mapper.unitsX(maxX - minX) + ctx.mapper.unitsY(maxY - minY)) / 4;
          ctx.emit('circle', { ...p, x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, { clockwise: d.turn > 0, angularVelocity: (Math.PI * 2) / elapsed, radius });
          d.turn = 0; d.turnStart = now;
        }
      }
      d.lastAng = ang;
    }
    ctx.emit('drag', p, { cells, distance: p.moved });
  },
  up(p, ctx, cancelled) {
    const d = p.data.drag; if (!d || !d.active) return;
    const speed = Math.hypot(p.vx, p.vy);
    const swipe = !cancelled && speed > T.swipeSpeed;
    ctx.emit('drag:end', p, { distance: p.moved, swipe });
    if (swipe) ctx.emit('swipe', p, { distance: p.moved });
  },
};

// ---- long press / energy charge ----
export const holdRecognizer = {
  id: 'hold', name: 'HOLD', description: 'Long press that charges energy and releases it on lift.',
  emits: ['hold:start', 'hold:charge', 'hold:release', 'hold:cancel'],
  down(p) { p.data.hold = { state: 'waiting', level: 0 }; },
  move(p, ctx) {
    const h = p.data.hold; if (!h) return;
    const drift = ctx.mapper.unitDist(p.startX, p.startY, p.x, p.y);
    if (h.state === 'waiting' && drift > T.holdMaxDrift) h.state = 'off';
    if (h.state === 'holding' && drift > T.holdMaxDrift * 3) { h.state = 'off'; ctx.emit('hold:cancel', p, { level: h.level }); }
  },
  frame(dt, ctx) {
    const now = ctx.now();
    for (const p of ctx.pointers()) {
      const h = p.data.hold; if (!h) continue;
      if (h.state === 'waiting' && (now - p.downAt) / 1000 >= T.holdDelay) { h.state = 'holding'; ctx.emit('hold:start', p, { level: 0 }); }
      if (h.state === 'holding') {
        h.level = Math.min(1, ((now - p.downAt) / 1000 - T.holdDelay) / T.holdFull);
        ctx.emit('hold:charge', p, { level: h.level, dt });
      }
    }
  },
  up(p, ctx, cancelled) {
    const h = p.data.hold; if (!h) return;
    if (h.state === 'holding') ctx.emit(cancelled ? 'hold:cancel' : 'hold:release', p, { level: h.level });
    h.state = 'off';
  },
};

// ---- multitouch: pinch / rotate / spread / squeeze / count ----
export const multiRecognizer = {
  id: 'multi', name: 'MULTI', description: 'Two-or-more pointer pinch, rotation, spread and squeeze.',
  emits: ['multi:start', 'pinch', 'rotate', 'spread', 'squeeze', 'multi:count', 'multi:end'],
  _s: null,
  _pair(ctx) { const ps = ctx.pointers(); return ps.length >= 2 ? [ps[0], ps[1]] : null; },
  _geom(a, b, ctx) {
    const dx = ctx.mapper.unitsX(b.x - a.x), dy = ctx.mapper.unitsY(b.y - a.y);
    return { dist: Math.max(0.01, Math.hypot(dx, dy)), ang: Math.atan2(dy, dx), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  },
  _agg(ctx, g, a, b) { return { id: -1, x: g.cx, y: g.cy, vx: ((a.vx || 0) + (b.vx || 0)) / 2, vy: ((a.vy || 0) + (b.vy || 0)) / 2, pointerType: a.pointerType, synthetic: a.synthetic && b.synthetic, gestureId: a.gestureId, downAt: Math.min(a.downAt, b.downAt) }; },
  down(p, ctx) {
    const n = ctx.activeCount();
    if (n === 2) {
      const [a, b] = this._pair(ctx); const g = this._geom(a, b, ctx);
      this._s = { a: a.id, b: b.id, d0: g.dist, a0: g.ang, lastScale: 1, lastRot: 0, spread: false, squeeze: false, count: 2 };
      ctx.emit('multi:start', this._agg(ctx, g, a, b), { count: 2 });
    } else if (n > 2 && this._s) {
      this._s.count = n;
      const [a, b] = this._pair(ctx);
      ctx.emit('multi:count', this._agg(ctx, this._geom(a, b, ctx), a, b), { count: n });
    }
  },
  move(p, ctx) {
    const s = this._s; if (!s || (p.id !== s.a && p.id !== s.b)) return;
    const ps = ctx.pointers(); const a = ps.find((q) => q.id === s.a), b = ps.find((q) => q.id === s.b);
    if (!a || !b) return;
    const g = this._geom(a, b, ctx); const agg = this._agg(ctx, g, a, b);
    const scale = g.dist / s.d0;
    let rot = g.ang - s.a0; if (rot > Math.PI) rot -= Math.PI * 2; else if (rot < -Math.PI) rot += Math.PI * 2;
    if (Math.abs(scale - s.lastScale) > 0.006) { ctx.emit('pinch', agg, { scale, deltaScale: scale - s.lastScale }); s.lastScale = scale; }
    if (Math.abs(rot - s.lastRot) > 0.006) { ctx.emit('rotate', agg, { rotation: rot, deltaRotation: rot - s.lastRot }); s.lastRot = rot; }
    if (!s.spread && scale > 1.35) { s.spread = true; ctx.emit('spread', agg, { scale }); }
    if (!s.squeeze && scale < 0.7) { s.squeeze = true; ctx.emit('squeeze', agg, { scale }); }
  },
  up(p, ctx) {
    const s = this._s; if (!s) return;
    const remaining = ctx.activeCount() - 1;   // p is still in the map during up()
    if (p.id === s.a || p.id === s.b || remaining < 2) {
      ctx.emit('multi:end', { id: -1, x: p.x, y: p.y, pointerType: p.pointerType, synthetic: p.synthetic, gestureId: p.gestureId, downAt: p.downAt }, { count: remaining });
      this._s = null;
    } else { s.count = remaining; ctx.emit('multi:count', p, { count: remaining }); }
  },
  reset() { this._s = null; },
};

// ============================================================
// EXTENSION ZONE: GESTURE RECOGNIZERS
// PURPOSE: Additional gesture recognizers.
// CONTRACT: src/input/gesture-recognizer.js — down/move/up/frame(p, ctx); ctx.emit(type, p, extra).
// SAFETY: Describe input only: never spawn effects, play sound or attach DOM listeners.
// INTEGRATION: api.input.recognizers.register(def). Example: src/extensions/examples/zigzag-gesture.js
// ============================================================
export const BUILTIN_RECOGNIZERS = [pressRecognizer, tapRecognizer, dragRecognizer, holdRecognizer, multiRecognizer];
