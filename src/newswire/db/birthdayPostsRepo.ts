import type Database from "better-sqlite3";

export interface BirthdayPostRow {
  id: number;
  watched_artist_id: number;
  year: number;
  posted_in_run_id: number;
  created_at: string;
}

/** True if this artist already got a birthday post for this calendar year - the once-a-year idempotency guard. */
export function hasBirthdayPostForYear(db: Database.Database, watchedArtistId: number, year: number): boolean {
  return db.prepare("SELECT 1 FROM birthday_posts WHERE watched_artist_id = ? AND year = ?").get(watchedArtistId, year) !== undefined;
}

export function recordBirthdayPost(
  db: Database.Database,
  input: { watchedArtistId: number; year: number; postedInRunId: number }
): BirthdayPostRow {
  const now = new Date().toISOString();
  const result = db
    .prepare("INSERT INTO birthday_posts (watched_artist_id, year, posted_in_run_id, created_at) VALUES (?, ?, ?, ?)")
    .run(input.watchedArtistId, input.year, input.postedInRunId, now);
  return db.prepare("SELECT * FROM birthday_posts WHERE id = ?").get(Number(result.lastInsertRowid)) as BirthdayPostRow;
}
