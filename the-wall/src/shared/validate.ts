import {
  MAX_POINTS_PER_STROKE,
  MAX_CELLS_PER_PIXELS_OP,
  MAX_HIDE_TARGETS,
  MAX_COORD,
  UUID_RE,
  type Operation,
  type BBox,
} from "./types.js";
import { isValidColorIndex, isValidSizeIndex, isValidPixelCellSize } from "./palette.js";

export type ValidationResult = { ok: true; op: Operation } | { ok: false; reason: string };

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function inCoordRange(v: number): boolean {
  return v >= -MAX_COORD && v <= MAX_COORD;
}

function isValidId(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function isValidSession(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= 128;
}

function validateBBox(v: unknown): v is BBox {
  if (!v || typeof v !== "object") return false;
  const b = v as Record<string, unknown>;
  if (!isFiniteNumber(b.minX) || !isFiniteNumber(b.minY) || !isFiniteNumber(b.maxX) || !isFiniteNumber(b.maxY)) {
    return false;
  }
  if (!inCoordRange(b.minX) || !inCoordRange(b.minY) || !inCoordRange(b.maxX) || !inCoordRange(b.maxY)) {
    return false;
  }
  return b.minX <= b.maxX && b.minY <= b.maxY;
}

/**
 * The one gate every incoming operation passes through before it touches
 * storage or gets rebroadcast. Treats `raw` as fully untrusted: wrong types,
 * missing fields, and out-of-range values are all rejected rather than
 * coerced, since a hostile client is exactly what this exists to stop.
 */
export function validateOperation(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "not-an-object" };
  const o = raw as Record<string, unknown>;

  if (!isValidId(o.id)) return { ok: false, reason: "bad-id" };
  if (!isValidSession(o.session)) return { ok: false, reason: "bad-session" };
  if (!isValidColorIndex(o.color)) return { ok: false, reason: "bad-color" };
  if (!validateBBox(o.bbox)) return { ok: false, reason: "bad-bbox" };

  if (o.type === "stroke") {
    if (!isValidSizeIndex(o.size)) return { ok: false, reason: "bad-size" };
    if (!Array.isArray(o.points) || o.points.length === 0 || o.points.length > MAX_POINTS_PER_STROKE) {
      return { ok: false, reason: "bad-points-count" };
    }
    const points: { x: number; y: number; p: number }[] = [];
    for (const raw of o.points) {
      if (!raw || typeof raw !== "object") return { ok: false, reason: "bad-point" };
      const pt = raw as Record<string, unknown>;
      if (!isFiniteNumber(pt.x) || !isFiniteNumber(pt.y) || !isFiniteNumber(pt.p)) {
        return { ok: false, reason: "bad-point" };
      }
      if (!inCoordRange(pt.x) || !inCoordRange(pt.y)) return { ok: false, reason: "point-out-of-range" };
      if (pt.p < 0 || pt.p > 1) return { ok: false, reason: "bad-pressure" };
      points.push({ x: pt.x, y: pt.y, p: pt.p });
    }
    return {
      ok: true,
      op: {
        type: "stroke",
        id: o.id as string,
        session: o.session as string,
        color: o.color as number,
        size: o.size as number,
        points,
        bbox: o.bbox as BBox,
      },
    };
  }

  if (o.type === "pixels") {
    if (!isValidPixelCellSize(o.cell)) return { ok: false, reason: "bad-cell-size" };
    if (!Array.isArray(o.cells) || o.cells.length === 0 || o.cells.length > MAX_CELLS_PER_PIXELS_OP) {
      return { ok: false, reason: "bad-cells-count" };
    }
    const cells: [number, number][] = [];
    const maxGrid = MAX_COORD / (o.cell as number);
    for (const raw of o.cells) {
      if (!Array.isArray(raw) || raw.length !== 2) return { ok: false, reason: "bad-cell" };
      const [cx, cy] = raw;
      if (!Number.isInteger(cx) || !Number.isInteger(cy)) return { ok: false, reason: "bad-cell" };
      if (Math.abs(cx) > maxGrid || Math.abs(cy) > maxGrid) return { ok: false, reason: "cell-out-of-range" };
      cells.push([cx, cy]);
    }
    return {
      ok: true,
      op: {
        type: "pixels",
        id: o.id as string,
        session: o.session as string,
        color: o.color as number,
        cell: o.cell as number,
        cells,
        bbox: o.bbox as BBox,
      },
    };
  }

  if (o.type === "hide") {
    if (!Array.isArray(o.targetIds) || o.targetIds.length === 0 || o.targetIds.length > MAX_HIDE_TARGETS) {
      return { ok: false, reason: "bad-target-ids" };
    }
    const targetIds: string[] = [];
    for (const id of o.targetIds) {
      if (!isValidId(id)) return { ok: false, reason: "bad-target-id" };
      targetIds.push(id);
    }
    return {
      ok: true,
      op: {
        type: "hide",
        id: o.id as string,
        session: o.session as string,
        color: o.color as number,
        targetIds,
        bbox: o.bbox as BBox,
      },
    };
  }

  return { ok: false, reason: "bad-type" };
}
