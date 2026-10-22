/**
 * Pointer input → stroke points, independent of React.
 *
 * - One stroke at a time: extra fingers are ignored.
 * - Palm rejection: once a stylus has been used, touches are ignored for a while.
 * - Coalesced events are used where available (smoother fast strokes).
 * - Points closer than MIN_STEP canvas units to the previous one are dropped.
 */
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../../types/font-metrics';
import type { Stroke } from '../../types/glyph';

const MIN_STEP = 1.5;
const PEN_GRACE_MS = 1500;

export interface CaptureCallbacks {
  /** Called (at most once per frame) while a stroke is being drawn. */
  onProgress(points: number[], pen: boolean): void;
  onComplete(stroke: Stroke): void;
}

export function attachPointerCapture(el: SVGSVGElement, cb: CaptureCallbacks, isEnabled: () => boolean): () => void {
  let active: number | null = null;
  let pen = false;
  let points: number[] = [];
  let lastPenTime = -Infinity;
  let frame = 0;
  let rect: DOMRect | null = null;

  const toCanvas = (e: PointerEvent): [number, number, number] => {
    const r = rect ?? el.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * CANVAS_WIDTH;
    const y = ((e.clientY - r.top) / r.height) * CANVAS_HEIGHT;
    const p = e.pointerType === 'pen' ? (e.pressure > 0 ? e.pressure : 0.5) : 0.5;
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(p * 1000) / 1000];
  };

  const push = (e: PointerEvent) => {
    const [x, y, p] = toCanvas(e);
    const n = points.length;
    if (n >= 3 && Math.hypot(x - points[n - 3], y - points[n - 2]) < MIN_STEP) return;
    points.push(x, y, p);
  };

  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (active !== null) cb.onProgress(points, pen);
    });
  };

  const down = (e: PointerEvent) => {
    if (!isEnabled()) return;
    if (e.pointerType === 'pen') lastPenTime = e.timeStamp;
    if (e.pointerType === 'touch' && e.timeStamp - lastPenTime < PEN_GRACE_MS) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (active !== null) return;
    e.preventDefault();
    active = e.pointerId;
    pen = e.pointerType === 'pen';
    rect = el.getBoundingClientRect();
    points = [];
    try { el.setPointerCapture(e.pointerId); } catch { /* not capturable (synthetic event) */ }
    push(e);
    schedule();
  };

  const move = (e: PointerEvent) => {
    if (e.pointerId !== active) return;
    e.preventDefault();
    if (e.pointerType === 'pen') lastPenTime = e.timeStamp;
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    if (list.length) list.forEach(push);
    else push(e);
    schedule();
  };

  const end = (e: PointerEvent) => {
    if (e.pointerId !== active) return;
    if (e.type === 'pointerup') push(e);
    active = null;
    rect = null;
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    const stroke: Stroke = { points, pen };
    points = [];
    // A cancelled stroke (e.g. the system took over the touch) still keeps what was drawn.
    if (stroke.points.length >= 3) cb.onComplete(stroke);
    else cb.onProgress([], false);
  };

  // Block scrolling, zooming and the iOS magnifier while drawing on the canvas.
  const block = (e: Event) => { if (e.cancelable) e.preventDefault(); };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('touchstart', block, { passive: false });
  el.addEventListener('touchmove', block, { passive: false });
  el.addEventListener('gesturestart', block as EventListener);
  el.addEventListener('contextmenu', block);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', end);
    el.removeEventListener('pointercancel', end);
    el.removeEventListener('touchstart', block);
    el.removeEventListener('touchmove', block);
    el.removeEventListener('gesturestart', block as EventListener);
    el.removeEventListener('contextmenu', block);
    if (frame) cancelAnimationFrame(frame);
  };
}
