import type { Kysely } from "kysely";
import type { Schema } from "./db/index.js";
import { createSnapshot } from "./db/store.js";
import { getOrRenderTile } from "./tiles.js";

export const SNAPSHOT_INTERVAL = 10_000;

/**
 * A snapshot is a checkpoint: every level-0 tile ever touched gets forced
 * fresh in the tile cache, then a marker row records the seq that
 * checkpoint covers. Reconstructing the wall at any seq is then "load the
 * nearest snapshot at or before it, replay operations after it" - which in
 * practice this project already does implicitly via the tile cache's own
 * per-tile seq tracking; this just guarantees a known-good, fully-warmed
 * state exists at round seq milestones (useful for the timelapse and for
 * `admin snapshot`).
 */
export async function takeSnapshot(db: Kysely<Schema>, headSeq: number): Promise<void> {
  const rows = await db.selectFrom("tile_index").select(["tx", "ty"]).distinct().execute();
  for (const r of rows) {
    await getOrRenderTile(db, { level: 0, tx: r.tx, ty: r.ty });
  }
  await createSnapshot(db, headSeq);
}

export function shouldSnapshot(seq: number): boolean {
  return seq > 0 && seq % SNAPSHOT_INTERVAL === 0;
}
