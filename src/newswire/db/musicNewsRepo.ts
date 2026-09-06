import type Database from "better-sqlite3";

export interface MusicNewsPostRow {
  id: number;
  post_date: string;
  posted_in_run_id: number;
  item_count: number;
  created_at: string;
}

/** True if a MUSIC NEWS recap has already been recorded for this local date (YYYY-MM-DD) - the once-a-day idempotency guard. */
export function hasMusicNewsPostForDate(db: Database.Database, postDate: string): boolean {
  return db.prepare("SELECT 1 FROM music_news_posts WHERE post_date = ?").get(postDate) !== undefined;
}

export function recordMusicNewsPost(
  db: Database.Database,
  input: { postDate: string; postedInRunId: number; itemCount: number }
): MusicNewsPostRow {
  const now = new Date().toISOString();
  const result = db
    .prepare("INSERT INTO music_news_posts (post_date, posted_in_run_id, item_count, created_at) VALUES (?, ?, ?, ?)")
    .run(input.postDate, input.postedInRunId, input.itemCount, now);
  return db.prepare("SELECT * FROM music_news_posts WHERE id = ?").get(Number(result.lastInsertRowid)) as MusicNewsPostRow;
}
