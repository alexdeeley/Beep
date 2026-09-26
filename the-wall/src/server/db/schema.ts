import type { ColumnType, Generated } from "kysely";

/**
 * `seq` doubles as the primary key and the canonical order - it's an
 * auto-incrementing integer, so "assign a seq" is just "insert a row" on
 * both SQLite and Postgres, with no separate sequence bookkeeping.
 */
export interface OperationsTable {
  seq: Generated<number>;
  id: string; // client UUID, unique - the idempotency key
  type: "stroke" | "pixels" | "hide";
  session: string;
  color: number;
  ts: ColumnType<number, number, never>;
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
  /** Type-specific payload (points/cells/targetIds + size/cell), JSON-encoded. */
  payload: string;
}

/** Level-0 tile membership for each operation - the fan-out that makes "ops touching this tile" fast. */
export interface TileIndexTable {
  seq: number;
  tx: number;
  ty: number;
}

/** One cached raster per (level, tx, ty), tagged with the highest seq baked into it. */
export interface TileCacheTable {
  level: number;
  tx: number;
  ty: number;
  seq: number;
  png: Buffer;
}

export interface SnapshotsTable {
  id: Generated<number>;
  seq: number;
  created_at: ColumnType<number, number, never>;
}

export interface Database {
  operations: OperationsTable;
  tile_index: TileIndexTable;
  tile_cache: TileCacheTable;
  snapshots: SnapshotsTable;
}
