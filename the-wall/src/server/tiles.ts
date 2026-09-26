import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { Kysely } from "kysely";
import type { Schema } from "./db/index.js";
import { getOpsForTile0, getTileCache, setTileCache, getAllTargetedByHides } from "./db/store.js";
import { renderOperation, type DrawContext2D } from "../shared/draw.js";
import { PALETTE } from "../shared/palette.js";
import { tileBBox, tileWorldSize, childTiles, type TileIndex } from "../shared/coords.js";

/** Fixed raster resolution for every cached tile, at every level. */
export const TILE_PX = 512;

async function currentSeqForTile(db: Kysely<Schema>, t: TileIndex): Promise<number> {
  if (t.level === 0) {
    const row = await db
      .selectFrom("tile_index")
      .select((eb) => eb.fn.max("seq").as("m"))
      .where("tx", "=", t.tx)
      .where("ty", "=", t.ty)
      .executeTakeFirst();
    return Number(row?.m ?? 0);
  }
  let m = 0;
  for (const k of childTiles(t)) m = Math.max(m, await currentSeqForTile(db, k));
  return m;
}

async function renderTile0(db: Kysely<Schema>, tx: number, ty: number): Promise<{ seq: number; png: Buffer }> {
  const [ops, hidden] = await Promise.all([getOpsForTile0(db, tx, ty), getAllTargetedByHides(db)]);
  const bbox = tileBBox({ level: 0, tx, ty });
  const scale = TILE_PX / tileWorldSize(0);
  const canvas = createCanvas(TILE_PX, TILE_PX);
  const ctx = canvas.getContext("2d") as unknown as DrawContext2D;

  let maxSeq = 0;
  for (const op of ops) {
    if (op.seq && op.seq > maxSeq) maxSeq = op.seq;
    if (hidden.has(op.id)) continue;
    renderOperation(
      ctx,
      op,
      {
        toLocalX: (wx) => (wx - bbox.minX) * scale,
        toLocalY: (wy) => (wy - bbox.minY) * scale,
        scale,
      },
      PALETTE
    );
  }
  return { seq: maxSeq, png: canvas.toBuffer("image/png") };
}

async function renderTileComposite(db: Kysely<Schema>, t: TileIndex): Promise<{ seq: number; png: Buffer }> {
  const kids = childTiles(t);
  const canvas = createCanvas(TILE_PX, TILE_PX);
  const ctx = canvas.getContext("2d");
  const half = TILE_PX / 2;
  // childTiles() order: [ (2tx,2ty), (2tx+1,2ty), (2tx,2ty+1), (2tx+1,2ty+1) ] -
  // i.e. [top-left, top-right, bottom-left, bottom-right] of the parent tile.
  const positions = [
    [0, 0],
    [half, 0],
    [0, half],
    [half, half],
  ] as const;

  let maxSeq = 0;
  for (let i = 0; i < 4; i++) {
    const kid = kids[i]!;
    const rendered = await getOrRenderTile(db, kid);
    maxSeq = Math.max(maxSeq, rendered.seq);
    if (rendered.seq === 0) continue; // skip drawing known-empty children entirely
    const img = await loadImage(rendered.png);
    const [dx, dy] = positions[i]!;
    ctx.drawImage(img, dx, dy, half, half);
  }
  return { seq: maxSeq, png: canvas.toBuffer("image/png") };
}

/**
 * Get a tile's raster, using the cache when it's still fresh and
 * re-rendering (then re-caching) when newer operations have touched it.
 * Tiles nothing has ever touched are rendered on the fly as blank
 * transparent PNGs and never written to the cache table - an "infinite"
 * canvas would otherwise mean persisting infinitely many empty tiles.
 */
export async function getOrRenderTile(
  db: Kysely<Schema>,
  t: TileIndex
): Promise<{ seq: number; png: Buffer }> {
  const [cached, current] = await Promise.all([
    getTileCache(db, t.level, t.tx, t.ty),
    currentSeqForTile(db, t),
  ]);
  if (cached && cached.seq >= current) return cached;

  if (current === 0) {
    const canvas = createCanvas(TILE_PX, TILE_PX);
    return { seq: 0, png: canvas.toBuffer("image/png") };
  }

  const rendered = t.level === 0 ? await renderTile0(db, t.tx, t.ty) : await renderTileComposite(db, t);
  const seq = Math.max(rendered.seq, current);
  await setTileCache(db, t.level, t.tx, t.ty, seq, rendered.png);
  return { seq, png: rendered.png };
}

/** Invalidation is lazy (handled by the seq comparison above) - this just forces the check for a set of tiles, used after a batch of writes to warm the cache before clients ask for it. */
export async function warmTiles(db: Kysely<Schema>, tiles: TileIndex[]): Promise<void> {
  await Promise.all(tiles.map((t) => getOrRenderTile(db, t)));
}
