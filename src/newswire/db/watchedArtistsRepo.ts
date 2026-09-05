import type Database from "better-sqlite3";

export interface WatchedArtistRow {
  id: number;
  name: string;
  last_checked_at: string | null;
  created_at: string;
  birth_month: number | null;
  birth_day: number | null;
  birth_year: number | null;
  birth_date_checked_at: string | null;
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

/** Artists whose birth date has never been looked up - the pool for discoverBirthDates.ts's per-cycle batch. Oldest-added-first. */
export function getArtistsNeedingBirthDateCheck(db: Database.Database, limit: number): WatchedArtistRow[] {
  return db
    .prepare("SELECT * FROM watched_artists WHERE birth_date_checked_at IS NULL ORDER BY created_at ASC LIMIT ?")
    .all(limit) as WatchedArtistRow[];
}

/**
 * Records the outcome of a birth-date lookup - always sets birth_date_checked_at, even when
 * month/day/year all come back null (nothing confirmable found), so that artist is never re-searched
 * every cycle forever. A band/group, or an artist whose birth date genuinely isn't verifiable, simply
 * never becomes eligible for a birthday post - that's fine, not an error.
 */
export function recordBirthDate(
  db: Database.Database,
  artistId: number,
  input: { month: number | null; day: number | null; year: number | null }
): void {
  const now = new Date().toISOString();
  db.prepare("UPDATE watched_artists SET birth_month = ?, birth_day = ?, birth_year = ?, birth_date_checked_at = ? WHERE id = ?").run(
    input.month,
    input.day,
    input.year,
    now,
    artistId
  );
}

/** Every watchlist artist with a confirmed birth month/day matching today's local date. */
export function getArtistsWithBirthdayOn(db: Database.Database, month: number, day: number): WatchedArtistRow[] {
  return db.prepare("SELECT * FROM watched_artists WHERE birth_month = ? AND birth_day = ?").all(month, day) as WatchedArtistRow[];
}
