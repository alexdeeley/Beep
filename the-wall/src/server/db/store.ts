import type { Kysely } from "kysely";
import type { Schema } from "./index.js";
import type { Operation, StrokeOp, PixelsOp, HideOp } from "../../shared/types.js";
import { tilesForBBox, type TileIndex } from "../../shared/coords.js";
import { SIZES } from "../../shared/palette.js";

interface OperationRow {
  seq: number;
  id: string;
  type: string;
  session: string;
  color: number;
  ts: number;
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
  payload: string;
}

function rowToOperation(row: OperationRow): Operation {
  const payload = JSON.parse(row.payload);
  const base = {
    id: row.id,
    seq: row.seq,
    ts: row.ts,
    session: row.session,
    color: row.color,
    bbox: { minX: row.min_x, minY: row.min_y, maxX: row.max_x, maxY: row.max_y },
  };
  if (row.type === "stroke") {
    return { ...base, type: "stroke", size: payload.size, points: payload.points } as StrokeOp;
  }
  if (row.type === "pixels") {
    return { ...base, type: "pixels", cell: payload.cell, cells: payload.cells } as PixelsOp;
  }
  return { ...base, type: "hide", targetIds: payload.targetIds } as HideOp;
}

function payloadOf(op: Operation): string {
  if (op.type === "stroke") return JSON.stringify({ size: op.size, points: op.points });
  if (op.type === "pixels") return JSON.stringify({ cell: op.cell, cells: op.cells });
  return JSON.stringify({ targetIds: op.targetIds });
}

/** Brush-radius padding so tile membership accounts for stroke thickness, not just the centreline bbox. */
function paddingFor(op: Operation): number {
  if (op.type === "stroke") return (SIZES[op.size] ?? SIZES[0]!) / 2;
  return 0;
}

/**
 * Insert an operation, assigning it a seq and server timestamp. Idempotent
 * on `op.id`: resubmitting the same id (a retried commit after a dropped
 * ack, for instance) returns the row that already exists instead of
 * inserting a duplicate or throwing.
 */
export async function insertOperation(db: Kysely<Schema>, op: Operation): Promise<Operation> {
  const existing = await db
    .selectFrom("operations")
    .selectAll()
    .where("id", "=", op.id)
    .executeTakeFirst();
  if (existing) return rowToOperation(existing as unknown as OperationRow);

  const ts = Date.now();
  try {
    const inserted = await db
      .insertInto("operations")
      .values({
        id: op.id,
        type: op.type,
        session: op.session,
        color: op.color,
        ts,
        min_x: op.bbox.minX,
        min_y: op.bbox.minY,
        max_x: op.bbox.maxX,
        max_y: op.bbox.maxY,
        payload: payloadOf(op),
      })
      .returningAll()
      .executeTakeFirst();

    let row = inserted as unknown as OperationRow | undefined;
    if (!row) {
      // Some SQLite configurations don't support RETURNING through this driver path; fall back to a lookup.
      row = (await db.selectFrom("operations").selectAll().where("id", "=", op.id).executeTakeFirst()) as unknown as
        | OperationRow
        | undefined;
    }
    if (!row) throw new Error("insert did not return a row");

    const pad = paddingFor(op);
    const tiles = tilesForBBox(0, {
      minX: op.bbox.minX - pad,
      minY: op.bbox.minY - pad,
      maxX: op.bbox.maxX + pad,
      maxY: op.bbox.maxY + pad,
    });
    if (tiles.length > 0) {
      await db
        .insertInto("tile_index")
        .values(tiles.map((t) => ({ seq: row!.seq, tx: t.tx, ty: t.ty })))
        .execute();
    }

    return rowToOperation(row);
  } catch (err) {
    // Lost a race: another call inserted this same id between our pre-check above and our
    // insert just now (two near-simultaneous commits of the same op, e.g. an offline-queue
    // flush racing a fresh submission). That caller already wrote the tile_index rows for it -
    // recover by returning the row that won, rather than crashing the whole process on the
    // id's unique-constraint violation.
    const winner = await db.selectFrom("operations").selectAll().where("id", "=", op.id).executeTakeFirst();
    if (winner) return rowToOperation(winner as unknown as OperationRow);
    throw err;
  }
}

export async function getHeadSeq(db: Kysely<Schema>): Promise<number> {
  const row = await db
    .selectFrom("operations")
    .select((eb) => eb.fn.max("seq").as("maxSeq"))
    .executeTakeFirst();
  const v = row?.maxSeq;
  return typeof v === "number" ? v : v ? Number(v) : 0;
}

export async function getOpsSince(db: Kysely<Schema>, sinceSeq: number, limit = 5000): Promise<Operation[]> {
  const rows = await db
    .selectFrom("operations")
    .selectAll()
    .where("seq", ">", sinceSeq)
    .orderBy("seq", "asc")
    .limit(limit)
    .execute();
  return (rows as unknown as OperationRow[]).map(rowToOperation);
}

/** All operations ever indexed into a given level-0 tile, in seq order. */
export async function getOpsForTile0(db: Kysely<Schema>, tx: number, ty: number): Promise<Operation[]> {
  const rows = await db
    .selectFrom("tile_index")
    .innerJoin("operations", "operations.seq", "tile_index.seq")
    .selectAll("operations")
    .where("tile_index.tx", "=", tx)
    .where("tile_index.ty", "=", ty)
    .orderBy("operations.seq", "asc")
    .execute();
  return (rows as unknown as OperationRow[]).map(rowToOperation);
}

/** Operations in a level-0 tile with seq strictly greater than `sinceSeq` (used to know if a cached raster is stale). */
export async function getOpsForTile0Since(
  db: Kysely<Schema>,
  tx: number,
  ty: number,
  sinceSeq: number
): Promise<Operation[]> {
  const rows = await db
    .selectFrom("tile_index")
    .innerJoin("operations", "operations.seq", "tile_index.seq")
    .selectAll("operations")
    .where("tile_index.tx", "=", tx)
    .where("tile_index.ty", "=", ty)
    .where("operations.seq", ">", sinceSeq)
    .orderBy("operations.seq", "asc")
    .execute();
  return (rows as unknown as OperationRow[]).map(rowToOperation);
}

export async function getAllTargetedByHides(db: Kysely<Schema>): Promise<Set<string>> {
  const rows = await db.selectFrom("operations").select(["payload"]).where("type", "=", "hide").execute();
  const hidden = new Set<string>();
  for (const r of rows) {
    try {
      const payload = JSON.parse((r as { payload: string }).payload);
      for (const id of payload.targetIds ?? []) hidden.add(id);
    } catch {
      /* ignore malformed payload */
    }
  }
  return hidden;
}

export async function getTileCache(
  db: Kysely<Schema>,
  level: number,
  tx: number,
  ty: number
): Promise<{ seq: number; png: Buffer } | undefined> {
  const row = await db
    .selectFrom("tile_cache")
    .select(["seq", "png"])
    .where("level", "=", level)
    .where("tx", "=", tx)
    .where("ty", "=", ty)
    .executeTakeFirst();
  if (!row) return undefined;
  return { seq: row.seq, png: Buffer.from(row.png as unknown as Uint8Array) };
}

/**
 * An atomic upsert, not select-then-branch: under concurrent requests for the
 * same never-yet-cached tile (a real scenario under load - many clients
 * committing near the same region trigger overlapping `warmTiles` calls),
 * two connections can both see "no existing row" and both attempt an
 * INSERT, and the loser crashes on the primary key constraint. A raced
 * write "winning" with a slightly stale `seq` is harmless either way:
 * `getOrRenderTile` always compares the cached seq against a freshly
 * computed current seq, never against what it itself last wrote, so a
 * stale entry just triggers one extra re-render on the next read rather
 * than serving stale content forever.
 */
export async function setTileCache(
  db: Kysely<Schema>,
  level: number,
  tx: number,
  ty: number,
  seq: number,
  png: Buffer
): Promise<void> {
  await db
    .insertInto("tile_cache")
    .values({ level, tx, ty, seq, png })
    .onConflict((oc) => oc.columns(["level", "tx", "ty"]).doUpdateSet({ seq, png }))
    .execute();
}

export async function createSnapshot(db: Kysely<Schema>, seq: number): Promise<void> {
  await db.insertInto("snapshots").values({ seq, created_at: Date.now() }).execute();
}

export async function getLatestSnapshot(db: Kysely<Schema>): Promise<{ seq: number } | undefined> {
  const row = await db.selectFrom("snapshots").select(["seq"]).orderBy("seq", "desc").limit(1).executeTakeFirst();
  return row;
}

export async function worldBBox(db: Kysely<Schema>): Promise<{ minX: number; minY: number; maxX: number; maxY: number } | undefined> {
  const row = await db
    .selectFrom("operations")
    .select((eb) => [
      eb.fn.min("min_x").as("minX"),
      eb.fn.min("min_y").as("minY"),
      eb.fn.max("max_x").as("maxX"),
      eb.fn.max("max_y").as("maxY"),
    ])
    .executeTakeFirst();
  if (!row || row.minX == null) return undefined;
  return { minX: Number(row.minX), minY: Number(row.minY), maxX: Number(row.maxX), maxY: Number(row.maxY) };
}

/** Bounding box of activity in the last `sinceMs` milliseconds - used to pick the initial camera. */
export async function recentActivityBBox(
  db: Kysely<Schema>,
  sinceMs: number
): Promise<{ minX: number; minY: number; maxX: number; maxY: number } | undefined> {
  const cutoff = Date.now() - sinceMs;
  const row = await db
    .selectFrom("operations")
    .select((eb) => [
      eb.fn.min("min_x").as("minX"),
      eb.fn.min("min_y").as("minY"),
      eb.fn.max("max_x").as("maxX"),
      eb.fn.max("max_y").as("maxY"),
    ])
    .where("ts", ">=", cutoff)
    .executeTakeFirst();
  if (!row || row.minX == null) return undefined;
  return { minX: Number(row.minX), minY: Number(row.minY), maxX: Number(row.maxX), maxY: Number(row.maxY) };
}

export async function operationCount(db: Kysely<Schema>): Promise<number> {
  const row = await db
    .selectFrom("operations")
    .select((eb) => eb.fn.countAll().as("n"))
    .executeTakeFirst();
  return Number(row?.n ?? 0);
}

export { rowToOperation, type TileIndex };
