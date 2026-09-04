import type Database from "better-sqlite3";

export type ReleaseType = "album" | "single" | "compilation";

export interface ReleaseRow {
  id: number;
  watched_artist_id: number;
  spotify_release_id: string;
  release_type: ReleaseType;
  title: string;
  release_date: string;
  release_date_precision: string;
  total_tracks: number;
  spotify_url: string;
  image_url: string | null;
  discovered_in_run_id: number;
  posted_in_run_id: number | null;
  created_at: string;
}

export function insertRelease(
  db: Database.Database,
  input: {
    watchedArtistId: number;
    spotifyReleaseId: string;
    releaseType: ReleaseType;
    title: string;
    releaseDate: string;
    releaseDatePrecision: string;
    totalTracks: number;
    spotifyUrl: string;
    imageUrl: string | null;
    discoveredInRunId: number;
  }
): ReleaseRow {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO releases
        (watched_artist_id, spotify_release_id, release_type, title, release_date, release_date_precision, total_tracks, spotify_url, image_url, discovered_in_run_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.watchedArtistId,
      input.spotifyReleaseId,
      input.releaseType,
      input.title,
      input.releaseDate,
      input.releaseDatePrecision,
      input.totalTracks,
      input.spotifyUrl,
      input.imageUrl,
      input.discoveredInRunId,
      now
    );
  const id = result.changes > 0 ? Number(result.lastInsertRowid) : undefined;
  const row = id
    ? (db.prepare("SELECT * FROM releases WHERE id = ?").get(id) as ReleaseRow)
    : (db.prepare("SELECT * FROM releases WHERE spotify_release_id = ?").get(input.spotifyReleaseId) as ReleaseRow);
  return row;
}

export interface UnpostedReleaseRow extends ReleaseRow {
  artist_name: string;
  artist_popularity: number | null;
  artist_genres_json: string | null;
}

/** The candidate pool for this cycle's edition: every release discovered (this run or an earlier one) that hasn't been posted yet, oldest-discovered-first so nothing starves behind a busier week. */
export function getUnpostedReleases(db: Database.Database): UnpostedReleaseRow[] {
  return db
    .prepare(
      `SELECT r.*, a.name as artist_name, a.popularity as artist_popularity, a.genres_json as artist_genres_json FROM releases r
       JOIN watched_artists a ON a.id = r.watched_artist_id
       WHERE r.posted_in_run_id IS NULL
       ORDER BY r.discovered_in_run_id ASC, r.release_date ASC`
    )
    .all() as UnpostedReleaseRow[];
}

export function markReleasePosted(db: Database.Database, releaseId: number, runId: number): void {
  db.prepare("UPDATE releases SET posted_in_run_id = ? WHERE id = ?").run(runId, releaseId);
}

export function getRecentlyPostedReleases(db: Database.Database, limit: number): (ReleaseRow & { artist_name: string })[] {
  return db
    .prepare(
      `SELECT r.*, a.name as artist_name FROM releases r
       JOIN watched_artists a ON a.id = r.watched_artist_id
       WHERE r.posted_in_run_id IS NOT NULL
       ORDER BY r.created_at DESC LIMIT ?`
    )
    .all(limit) as (ReleaseRow & { artist_name: string })[];
}
