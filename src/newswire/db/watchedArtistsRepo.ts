import type Database from "better-sqlite3";

export interface WatchedArtistRow {
  id: number;
  name: string;
  last_checked_at: string | null;
  created_at: string;
}

/** Inserts artists that don't already exist by name (case-sensitive, exact) - safe to call every cycle against the full watchlist file. */
export function importArtistNames(db: Database.Database, names: string[]): number {
  const now = new Date().toISOString();
  const insert = db.prepare("INSERT OR IGNORE INTO watched_artists (name, created_at) VALUES (?, ?)");
  const insertMany = db.transaction((rows: string[]) => {
    let inserted = 0;
    for (const name of rows) {
      const result = insert.run(name, now);
      if (result.changes > 0) inserted++;
    }
    return inserted;
  });
  return insertMany(names);
}

/** Rotation batch, oldest-checked-first (never-checked artists come first). */
export function getArtistsDueForCheck(db: Database.Database, limit: number): WatchedArtistRow[] {
  return db
    .prepare(`SELECT * FROM watched_artists ORDER BY (last_checked_at IS NOT NULL), last_checked_at ASC LIMIT ?`)
    .all(limit) as WatchedArtistRow[];
}

export function markArtistsChecked(db: Database.Database, artistIds: number[]): void {
  if (artistIds.length === 0) return;
  const now = new Date().toISOString();
  const update = db.prepare("UPDATE watched_artists SET last_checked_at = ? WHERE id = ?");
  const updateMany = db.transaction((ids: number[]) => {
    for (const id of ids) update.run(now, id);
  });
  updateMany(artistIds);
}

export function getArtistByName(db: Database.Database, name: string): WatchedArtistRow | undefined {
  return db.prepare("SELECT * FROM watched_artists WHERE name = ?").get(name) as WatchedArtistRow | undefined;
}

export function getWatchedArtistCount(db: Database.Database): number {
  const row = db.prepare("SELECT COUNT(*) as c FROM watched_artists").get() as { c: number };
  return row.c;
}
