import type { Operation, StrokeOp, PixelsOp } from "./types.js";
import { SIZES } from "./palette.js";

/**
 * The minimal structural subset of the Canvas2D API this module needs.
 * Deliberately not importing the DOM `CanvasRenderingContext2D` type (the
 * server build has no DOM lib) - both the browser context and
 * `@napi-rs/canvas`'s context satisfy this shape, which is what lets the
 * exact same render code run in both places.
 */
export interface DrawContext2D {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: unknown, dx: number, dy: number, dw: number, dh: number): void;
  save(): void;
  restore(): void;
  strokeStyle: string;
  fillStyle: string;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  globalAlpha: number;
}

/** Maps world coordinates to this canvas's local pixel space. */
export interface RenderTransform {
  toLocalX(wx: number): number;
  toLocalY(wy: number): number;
  /** Local pixels per world unit - used to size brush strokes correctly. */
  scale: number;
}

export function renderOperation(
  ctx: DrawContext2D,
  op: Operation,
  tf: RenderTransform,
  palette: readonly string[]
): void {
  if (op.type === "stroke") renderStroke(ctx, op, tf, palette);
  else if (op.type === "pixels") renderPixels(ctx, op, tf, palette);
  // "hide" ops draw nothing; the caller is responsible for excluding the
  // operations they target before this function ever sees them.
}

export function renderStroke(
  ctx: DrawContext2D,
  op: Pick<StrokeOp, "color" | "size" | "points">,
  tf: RenderTransform,
  palette: readonly string[]
): void {
  const pts = op.points;
  if (pts.length === 0) return;
  const color = palette[op.color] ?? "#000";
  const worldDiameter = SIZES[op.size] ?? SIZES[0]!;
  const localWidth = Math.max(worldDiameter * tf.scale, 0.75);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = localWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (pts.length === 1) {
    const p = pts[0]!;
    ctx.beginPath();
    ctx.arc(tf.toLocalX(p.x), tf.toLocalY(p.y), localWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  // Quadratic-through-midpoints: a standard smooth-polyline technique. Each
  // interior point is a curve control point, and the curve actually passes
  // through the midpoint between it and its neighbour, giving a continuous
  // smooth path through jittery raw samples without needing spline fitting.
  ctx.beginPath();
  const p0 = pts[0]!;
  ctx.moveTo(tf.toLocalX(p0.x), tf.toLocalY(p0.y));
  for (let i = 1; i < pts.length - 1; i++) {
    const cur = pts[i]!;
    const nxt = pts[i + 1]!;
    const cx = tf.toLocalX(cur.x);
    const cy = tf.toLocalY(cur.y);
    const mx = (cx + tf.toLocalX(nxt.x)) / 2;
    const my = (cy + tf.toLocalY(nxt.y)) / 2;
    ctx.quadraticCurveTo(cx, cy, mx, my);
  }
  const last = pts[pts.length - 1]!;
  ctx.lineTo(tf.toLocalX(last.x), tf.toLocalY(last.y));
  ctx.stroke();
  ctx.restore();
}

export function renderPixels(
  ctx: DrawContext2D,
  op: Pick<PixelsOp, "color" | "cell" | "cells">,
  tf: RenderTransform,
  palette: readonly string[]
): void {
  const color = palette[op.color] ?? "#000";
  ctx.save();
  ctx.fillStyle = color;
  for (const [cx, cy] of op.cells) {
    const wx = cx * op.cell;
    const wy = cy * op.cell;
    // Rounded to the nearest local pixel so cells stay crisp - no
    // anti-aliased fringes from sub-pixel rect boundaries.
    const x0 = Math.round(tf.toLocalX(wx));
    const y0 = Math.round(tf.toLocalY(wy));
    const x1 = Math.round(tf.toLocalX(wx + op.cell));
    const y1 = Math.round(tf.toLocalY(wy + op.cell));
    ctx.fillRect(x0, y0, Math.max(x1 - x0, 1), Math.max(y1 - y0, 1));
  }
  ctx.restore();
}

/** Faint grid lines for pixel mode - only drawn when a cell is >= 6 local px wide. */
export function renderPixelGrid(
  ctx: DrawContext2D & { strokeRect?: (x: number, y: number, w: number, h: number) => void },
  cellWorld: number,
  tf: RenderTransform,
  viewWorldBBox: { minX: number; minY: number; maxX: number; maxY: number },
  lineColor = "rgba(0,0,0,0.08)"
): void {
  const localCell = cellWorld * tf.scale;
  if (localCell < 6) return;
  const x0 = Math.floor(viewWorldBBox.minX / cellWorld) * cellWorld;
  const y0 = Math.floor(viewWorldBBox.minY / cellWorld) * cellWorld;
  ctx.save();
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let wx = x0; wx <= viewWorldBBox.maxX; wx += cellWorld) {
    const x = Math.round(tf.toLocalX(wx)) + 0.5;
    ctx.moveTo(x, tf.toLocalY(viewWorldBBox.minY));
    ctx.lineTo(x, tf.toLocalY(viewWorldBBox.maxY));
  }
  for (let wy = y0; wy <= viewWorldBBox.maxY; wy += cellWorld) {
    const y = Math.round(tf.toLocalY(wy)) + 0.5;
    ctx.moveTo(tf.toLocalX(viewWorldBBox.minX), y);
    ctx.lineTo(tf.toLocalX(viewWorldBBox.maxX), y);
  }
  ctx.stroke();
  ctx.restore();
}
