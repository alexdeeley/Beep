import type { Contour, CPoint, Point } from '../../types/glyph';

/** Turns sharper than this stay sharp corners (on-curve points). */
const CORNER_DEG = 40;
/** Vertices between two edges at least this long stay on-curve so straight runs stay straight. */
const LONG_EDGE = 90;

/**
 * Turns a simplified polygon into a smooth quadratic outline. Gentle vertices
 * become off-curve control points (the curve passes between them, through the
 * implied midpoints); corners and the ends of long straight edges stay
 * on-curve. The result always starts with an on-curve point.
 */
export function polygonToContour(ring: Point[]): Contour {
  const n = ring.length;
  if (n < 3) return ring.map(([x, y]) => ({ x, y, on: true }));
  const pts: CPoint[] = ring.map(([x, y], i) => {
    const [px, py] = ring[(i - 1 + n) % n];
    const [nx, ny] = ring[(i + 1) % n];
    const ax = x - px, ay = y - py, bx = nx - x, by = ny - y;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la === 0 || lb === 0) return { x, y, on: true };
    const cos = (ax * bx + ay * by) / (la * lb);
    const turn = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
    const on = turn > CORNER_DEG || (la >= LONG_EDGE && lb >= LONG_EDGE);
    return { x, y, on };
  });
  let start = pts.findIndex((p) => p.on);
  if (start < 0) {
    // No natural corner: anchor the curve on the midpoint of the first edge.
    const a = pts[0], b = pts[1];
    pts.splice(1, 0, { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2), on: true });
    start = 1;
  }
  return [...pts.slice(start), ...pts.slice(0, start)];
}

export function reverseContour(c: Contour): Contour {
  const r = c.slice().reverse();
  const start = r.findIndex((p) => p.on);
  return start <= 0 ? r : [...r.slice(start), ...r.slice(0, start)];
}

export type PathCommand =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | { type: 'Q'; x1: number; y1: number; x: number; y: number }
  | { type: 'Z' };

/** Expands a contour (first point on-curve) into move / line / quad commands. */
export function contourToCommands(c: Contour): PathCommand[] {
  if (c.length === 0) return [];
  const cmds: PathCommand[] = [{ type: 'M', x: c[0].x, y: c[0].y }];
  let ctrl: CPoint | null = null;
  const n = c.length;
  for (let i = 1; i <= n; i++) {
    const p = c[i % n];
    if (p.on) {
      if (ctrl) cmds.push({ type: 'Q', x1: ctrl.x, y1: ctrl.y, x: p.x, y: p.y });
      else if (i < n) cmds.push({ type: 'L', x: p.x, y: p.y });
      ctrl = null;
    } else {
      if (ctrl) cmds.push({ type: 'Q', x1: ctrl.x, y1: ctrl.y, x: (ctrl.x + p.x) / 2, y: (ctrl.y + p.y) / 2 });
      ctrl = p;
    }
  }
  cmds.push({ type: 'Z' });
  return cmds;
}

/** SVG path data for font-unit contours. With flipY the result is in screen orientation (y down). */
export function contoursToSvgPath(contours: Contour[], flipY = true): string {
  const s = flipY ? -1 : 1;
  const f = (v: number) => Math.round(v * 10) / 10;
  let d = '';
  for (const c of contours) {
    for (const cmd of contourToCommands(c)) {
      if (cmd.type === 'M' || cmd.type === 'L') d += `${cmd.type}${f(cmd.x)} ${f(s * cmd.y)}`;
      else if (cmd.type === 'Q') d += `Q${f(cmd.x1)} ${f(s * cmd.y1)} ${f(cmd.x)} ${f(s * cmd.y)}`;
      else d += 'Z';
    }
  }
  return d;
}

export function contoursBBox(contours: Contour[]): { xMin: number; yMin: number; xMax: number; yMax: number } | null {
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const c of contours) {
    for (const p of c) {
      if (p.x < xMin) xMin = p.x;
      if (p.y < yMin) yMin = p.y;
      if (p.x > xMax) xMax = p.x;
      if (p.y > yMax) yMax = p.y;
    }
  }
  return xMin === Infinity ? null : { xMin, yMin, xMax, yMax };
}
