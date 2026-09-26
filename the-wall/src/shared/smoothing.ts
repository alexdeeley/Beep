import type { PointSample } from "./types.js";

/**
 * Weighted-moving-average smoothing over raw pointer samples. Endpoints are
 * preserved exactly (so a stroke still starts/ends where the pointer did);
 * interior points are pulled toward the average of their neighbours, which
 * removes high-frequency sensor jitter while leaving the intended shape of
 * the stroke alone. Deterministic and cheap enough to run on every pointermove.
 */
export function smoothPoints(points: PointSample[], passes = 1): PointSample[] {
  if (points.length < 3 || passes <= 0) return points.slice();
  let current = points;
  for (let pass = 0; pass < passes; pass++) {
    const next: PointSample[] = new Array(current.length);
    next[0] = current[0]!;
    next[current.length - 1] = current[current.length - 1]!;
    for (let i = 1; i < current.length - 1; i++) {
      const prev = current[i - 1]!;
      const cur = current[i]!;
      const nxt = current[i + 1]!;
      next[i] = {
        x: prev.x * 0.25 + cur.x * 0.5 + nxt.x * 0.25,
        y: prev.y * 0.25 + cur.y * 0.5 + nxt.y * 0.25,
        p: prev.p * 0.25 + cur.p * 0.5 + nxt.p * 0.25,
      };
    }
    current = next;
  }
  return current;
}

/**
 * Perpendicular distance from a point to the line through a and b (0 if a==b).
 * Used only in tests, to measure how far smoothing pulls an outlier back
 * toward the straight line its neighbours describe.
 */
export function distanceToLine(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (len * len);
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}
