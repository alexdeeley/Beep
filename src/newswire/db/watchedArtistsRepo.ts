import type Database from "better-sqlite3";

export type ArtistResolutionStatus = "pending" | "resolved" | "unresolved";

export interface WatchedArtistRow {
  id: number;
  name: string;
  spotify_artist_id: string | null;
  resolution_status: ArtistResolutionStatus;
  resolve_attempts: number;
  genres_json: string | null;
  popularity: number | null;
  last_checked_at: string | null;
  last_seen_release_id: string | null;
  last_seen_release_date: string | null;
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

/** Never-resolved-yet artists first, then artists that have failed resolution the fewest times - so retries interleave rather than starving new entries. */
export function getPendingArtists(db: Database.Database, limit: number): WatchedArtistRow[] {
  return db
    .prepare(
      `SELECT * FROM watched_artists WHERE resolution_status = 'pending' ORDER BY resolve_attempts ASC, id ASC LIMIT ?`
    )
    .all(limit) as WatchedArtistRow[];
}

export function markArtistResolved(
  db: Database.Database,
  id: number,
  fields: { spotifyArtistId: string; genres: string[]; popularity: number }
): void {
  db.prepare(
    `UPDATE watched_artists SET spotify_artist_id = ?, resolution_status = 'resolved', genres_json = ?, popularity = ? WHERE id = ?`
  ).run(fields.spotifyArtistId, JSON.stringify(fields.genres), fields.popularity, id);
}

/** Attempts below the cap stay 'pending' so they're retried on a later cycle (e.g. a transient search API failure); at the cap the artist is marked 'unresolved' so it stops being retried every cycle. */
export const MAX_RESOLVE_ATTEMPTS = 3;

export function recordFailedResolveAttempt(db: Database.Database, id: number): void {
  const row = db.prepare("SELECT resolve_attempts FROM watched_artists WHERE id = ?").get(id) as
    | { resolve_attempts: number }
    | undefined;
  const attempts = (row?.resolve_attempts ?? 0) + 1;
  const status: ArtistResolutionStatus = attempts >= MAX_RESOLVE_ATTEMPTS ? "unresolved" : "pending";
  db.prepare("UPDATE watched_artists SET resolve_attempts = ?, resolution_status = ? WHERE id = ?").run(attempts, status, id);
}

/** Oldest-checked-first (nulls - never checked - first) rotation through resolved artists. */
export function getArtistsDueForReleaseCheck(db: Database.Database, limit: number): WatchedArtistRow[] {
  return db
    .prepare(
      `SELECT * FROM watched_artists WHERE resolution_status = 'resolved'
       ORDER BY (last_checked_at IS NOT NULL), last_checked_at ASC LIMIT ?`
    )
    .all(limit) as WatchedArtistRow[];
}

export function markArtistChecked(
  db: Database.Database,
  id: number,
  fields: { lastSeenReleaseId: string | null; lastSeenReleaseDate: string | null }
): void {
  db.prepare(
    `UPDATE watched_artists SET last_checked_at = ?, last_seen_release_id = ?, last_seen_release_date = ? WHERE id = ?`
  ).run(new Date().toISOString(), fields.lastSeenReleaseId, fields.lastSeenReleaseDate, id);
}

export interface ArtistResolutionCounts {
  pending: number;
  resolved: number;
  unresolved: number;
}

export function getArtistResolutionCounts(db: Database.Database): ArtistResolutionCounts {
  const rows = db
    .prepare("SELECT resolution_status, COUNT(*) as n FROM watched_artists GROUP BY resolution_status")
    .all() as { resolution_status: ArtistResolutionStatus; n: number }[];
  const counts: ArtistResolutionCounts = { pending: 0, resolved: 0, unresolved: 0 };
  for (const row of rows) counts[row.resolution_status] = row.n;
  return counts;
}
