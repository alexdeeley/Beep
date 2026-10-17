import { getStroke } from 'perfect-freehand';
import type { StrokeStyle } from '../../types/font-metrics';
import type { Point, Stroke } from '../../types/glyph';

export interface InputPoint {
  x: number;
  y: number;
  pressure: number;
}

export function strokeInputPoints(stroke: Stroke): InputPoint[] {
  const out: InputPoint[] = [];
  for (let i = 0; i + 2 < stroke.points.length; i += 3) {
    out.push({ x: stroke.points[i], y: stroke.points[i + 1], pressure: stroke.points[i + 2] });
  }
  return out;
}

/**
 * The filled outline of one stroke, in the stroke's own (canvas) units.
 * A stylus uses its real pressure; touch and mouse strokes get pressure
 * simulated from speed. A single tap becomes a round dot.
 */
export function strokeOutline(stroke: Stroke | InputPoint[], style: StrokeStyle, opts: { pen?: boolean; complete?: boolean } = {}): Point[] {
  const pts = Array.isArray(stroke) ? stroke : strokeInputPoints(stroke);
  const pen = Array.isArray(stroke) ? !!opts.pen : stroke.pen;
  if (pts.length === 0) return [];
  const input = pts.map((p) => [p.x, p.y, pen ? Math.max(0.05, p.pressure) : 0.5]);
  return getStroke(input, {
    size: style.size,
    thinning: style.thinning,
    smoothing: style.smoothing,
    streamline: style.streamline,
    simulatePressure: !pen,
    last: opts.complete ?? true,
    start: { cap: true },
    end: { cap: true },
  }) as Point[];
}

/**
 * Smooth SVG path through an outline polygon: each vertex becomes a quadratic
 * control point between the midpoints of its edges (the same construction the
 * font uses for its curves, see contour.ts).
 */
export function polygonToSvgPath(points: Point[]): string {
  const n = points.length;
  if (n < 3) return '';
  const f = (v: number) => Math.round(v * 10) / 10;
  const mid = (a: Point, b: Point) => `${f((a[0] + b[0]) / 2)} ${f((a[1] + b[1]) / 2)}`;
  let d = `M${mid(points[n - 1], points[0])}`;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const q = points[(i + 1) % n];
    d += `Q${f(p[0])} ${f(p[1])} ${mid(p, q)}`;
  }
  return d + 'Z';
}
