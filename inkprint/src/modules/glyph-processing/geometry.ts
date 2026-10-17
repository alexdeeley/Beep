import type { Point } from '../../types/glyph';

/** Signed area; positive when the ring runs counter-clockwise in a y-up system. */
export function signedArea(ring: { length: number; [i: number]: Point | { x: number; y: number } }): number {
  let a = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    const [px, py] = Array.isArray(p) ? p : [p.x, p.y];
    const [qx, qy] = Array.isArray(q) ? q : [q.x, q.y];
    a += px * qy - qx * py;
  }
  return a / 2;
}

function perpDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
}

/** Ramer-Douglas-Peucker on an open polyline (endpoints kept). */
export function simplifyPolyline(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDistance(points[i], points[s], points[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tolerance) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Ramer-Douglas-Peucker on a closed ring (no repeated closing point). */
export function simplifyRing(ring: Point[], tolerance: number): Point[] {
  if (ring.length <= 4) return ring.slice();
  // Split at the point farthest from the first so both halves are well-conditioned.
  let far = 0;
  let farD = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const a = simplifyPolyline(ring.slice(0, far + 1), tolerance);
  const b = simplifyPolyline([...ring.slice(far), ring[0]], tolerance);
  return [...a, ...b.slice(1, -1)];
}

/** Rounds to integers and drops consecutive duplicates and collinear points. */
export function roundRing(ring: Point[]): Point[] {
  const out: Point[] = [];
  for (const [x, y] of ring) {
    const p: Point = [Math.round(x), Math.round(y)];
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    out.push(p);
  }
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  // Remove exactly collinear middle points (they add nothing and can confuse rasterizers).
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const a = out[(i - 1 + out.length) % out.length];
      const b = out[i];
      const c = out[(i + 1) % out.length];
      if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) === 0) {
        out.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  return out;
}
