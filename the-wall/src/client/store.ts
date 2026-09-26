import type { Operation, PointSample } from "../shared/types.js";
import { tilesForBBox, tileBBox, bboxesIntersect } from "../shared/coords.js";

export interface LiveStroke {
  session: string;
  color: number;
  size: number;
  points: PointSample[];
}

function tileKey0(tx: number, ty: number): string {
  return `${tx}:${ty}`;
}
function tileKeyFull(level: number, tx: number, ty: number): string {
  return `${level}:${tx}:${ty}`;
}
function parseTileKeyFull(key: string): { level: number; tx: number; ty: number } {
  const [level, tx, ty] = key.split(":").map(Number);
  return { level: level!, tx: tx!, ty: ty! };
}

const EVICT_PAD = 64; // generous brush-radius margin for cache-invalidation checks only

/**
 * Everything the client knows about the wall, held only in memory (the
 * durable copy lives on the server).
 *
 * Tile bitmaps are keyed by (level, tx, ty) since the same (tx, ty) means a
 * different region at every level. Only level 0 gets the seamless overlay
 * treatment - a list of just-committed operations drawn on top of its
 * bitmap every frame, so drawing while zoomed in enough to actually see
 * individual strokes never causes a visible refetch. At coarser levels
 * (the normal view when zoomed out over a big wall), a new operation just
 * evicts that tile's cached bitmap so the next frame re-fetches a fresh
 * server-composited one - simpler, and the flicker that would cause is
 * rare in practice since live drawing is almost always seen zoomed in.
 */
export class WallStore {
  knownIds = new Set<string>();
  headSeq = 0;

  private tileOverlay = new Map<string, Operation[]>(); // level-0 only, key tx:ty
  private tileOverlayBaseSeq = new Map<string, number>(); // level-0 only, key tx:ty

  tileImages = new Map<string, ImageBitmap>(); // key level:tx:ty
  tileLoading = new Set<string>(); // key level:tx:ty

  liveStrokes = new Map<string, LiveStroke>();
  /** The local user's own in-flight mark, drawn instantly and never waiting on the network. */
  localPending:
    | { id: string; type: "stroke"; color: number; size: number; points: PointSample[] }
    | { id: string; type: "pixels"; color: number; cell: number; cells: [number, number][] }
    | null = null;

  /** Idempotent: applying the same committed operation twice is a no-op. */
  addCommitted(op: Operation): void {
    if (this.knownIds.has(op.id)) return;
    this.knownIds.add(op.id);
    if (op.seq && op.seq > this.headSeq) this.headSeq = op.seq;

    for (const t of tilesForBBox(0, op.bbox)) {
      const key0 = tileKey0(t.tx, t.ty);
      const base = this.tileOverlayBaseSeq.get(key0);
      if (base === undefined) continue; // level-0 bitmap for this tile isn't loaded right now
      if ((op.seq ?? 0) <= base) continue; // already baked into that bitmap
      const arr = this.tileOverlay.get(key0) ?? [];
      arr.push(op);
      this.tileOverlay.set(key0, arr);
    }

    const padded = {
      minX: op.bbox.minX - EVICT_PAD,
      minY: op.bbox.minY - EVICT_PAD,
      maxX: op.bbox.maxX + EVICT_PAD,
      maxY: op.bbox.maxY + EVICT_PAD,
    };
    for (const key of [...this.tileImages.keys()]) {
      const t = parseTileKeyFull(key);
      if (t.level === 0) continue; // level 0 uses the overlay instead of eviction
      if (bboxesIntersect(tileBBox(t), padded)) this.tileImages.delete(key);
    }

    this.liveStrokes.delete(op.id);
  }

  registerTileImage(level: number, tx: number, ty: number, image: ImageBitmap, baseSeq: number): void {
    this.tileImages.set(tileKeyFull(level, tx, ty), image);
    if (level === 0) {
      const key0 = tileKey0(tx, ty);
      this.tileOverlayBaseSeq.set(key0, baseSeq);
      const overlay = this.tileOverlay.get(key0);
      if (overlay) this.tileOverlay.set(key0, overlay.filter((op) => (op.seq ?? 0) > baseSeq));
    }
  }

  overlayForLevel0(tx: number, ty: number): Operation[] {
    return this.tileOverlay.get(tileKey0(tx, ty)) ?? [];
  }

  imageFor(level: number, tx: number, ty: number): ImageBitmap | undefined {
    return this.tileImages.get(tileKeyFull(level, tx, ty));
  }

  /** Used when the server says this client is too far behind to resupply incrementally - forces every tile to refetch fresh. */
  resetAllTileCaches(): void {
    this.tileImages.clear();
    this.tileLoading.clear();
    this.tileOverlay.clear();
    this.tileOverlayBaseSeq.clear();
  }
}

export { tileKeyFull, parseTileKeyFull };
