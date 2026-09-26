import type { BBox } from "./types.js";

/** Camera: world point (x,y) under the viewport centre, at z screen-px per world-unit. */
export interface Camera {
  x: number;
  y: number;
  z: number;
}

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function screenToWorld(cam: Camera, vw: number, vh: number, sx: number, sy: number) {
  return {
    x: cam.x + (sx - vw / 2) / cam.z,
    y: cam.y + (sy - vh / 2) / cam.z,
  };
}

export function worldToScreen(cam: Camera, vw: number, vh: number, wx: number, wy: number) {
  return {
    x: (wx - cam.x) * cam.z + vw / 2,
    y: (wy - cam.y) * cam.z + vh / 2,
  };
}

/**
 * Zoom to `newZ` while keeping the world point currently under screen point
 * (sx, sy) fixed under that same screen point after the change. This is the
 * one invariant the whole interaction model depends on: it must hold exactly
 * for both wheel-zoom-toward-cursor and pinch-zoom-toward-midpoint.
 */
export function zoomAroundScreenPoint(
  cam: Camera,
  vw: number,
  vh: number,
  sx: number,
  sy: number,
  newZ: number
): Camera {
  const z = clampZoom(newZ);
  const before = screenToWorld(cam, vw, vh, sx, sy);
  const x = before.x - (sx - vw / 2) / z;
  const y = before.y - (sy - vh / 2) / z;
  return { x, y, z };
}

export function viewportWorldBBox(cam: Camera, vw: number, vh: number): BBox {
  const a = screenToWorld(cam, vw, vh, 0, 0);
  const b = screenToWorld(cam, vw, vh, vw, vh);
  return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
}

/** Quantise to 1/16 world unit, the on-disk precision for stroke points. */
export function quantize(v: number): number {
  return Math.round(v * 16) / 16;
}

export function bboxOfPoints(points: { x: number; y: number }[], pad = 0): BBox {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

export function bboxesIntersect(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

// ---------------------------------------------------------------------------
// Tile pyramid: level 0 tiles are 512x512 world units; each level up doubles
// the side length (quadruples the area). A tile is identified by (level, tx, ty).
// ---------------------------------------------------------------------------

export const TILE_BASE_SIZE = 512;

export function tileWorldSize(level: number): number {
  return TILE_BASE_SIZE * 2 ** level;
}

export interface TileIndex {
  level: number;
  tx: number;
  ty: number;
}

export function tileKey(t: TileIndex): string {
  return `${t.level}/${t.tx}/${t.ty}`;
}

export function worldToTile(level: number, wx: number, wy: number): TileIndex {
  const s = tileWorldSize(level);
  return { level, tx: Math.floor(wx / s), ty: Math.floor(wy / s) };
}

export function tileBBox(t: TileIndex): BBox {
  const s = tileWorldSize(t.level);
  return { minX: t.tx * s, minY: t.ty * s, maxX: (t.tx + 1) * s, maxY: (t.ty + 1) * s };
}

/**
 * Every level-0 tile a (padded) bounding box intersects. Padding by the brush
 * radius before calling this is the caller's job - it's how a stroke whose
 * centreline sits just inside a tile edge still marks the neighbour dirty for
 * the part of its ink that bleeds across the boundary.
 */
export function tilesForBBox(level: number, bbox: BBox): TileIndex[] {
  const s = tileWorldSize(level);
  const tx0 = Math.floor(bbox.minX / s);
  const tx1 = Math.floor(bbox.maxX / s);
  const ty0 = Math.floor(bbox.minY / s);
  const ty1 = Math.floor(bbox.maxY / s);
  const out: TileIndex[] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      out.push({ level, tx, ty });
    }
  }
  return out;
}

export function parentTile(t: TileIndex): TileIndex {
  return { level: t.level + 1, tx: Math.floor(t.tx / 2), ty: Math.floor(t.ty / 2) };
}

/** The 4 level-(L-1) tiles that compose parent tile t (only valid for t.level > 0). */
export function childTiles(t: TileIndex): TileIndex[] {
  const level = t.level - 1;
  const tx = t.tx * 2;
  const ty = t.ty * 2;
  return [
    { level, tx, ty },
    { level, tx: tx + 1, ty },
    { level, tx, ty: ty + 1 },
    { level, tx: tx + 1, ty: ty + 1 },
  ];
}
