import type Database from "better-sqlite3";

export interface HistoryPostRow {
  id: number;
  post_date: string;
  posted_in_run_id: number;
  item_count: number;
  created_at: string;
}

/** True if a TODAY IN HISTORY post has already been recorded for this local date (YYYY-MM-DD) - the once-a-day idempotency guard. */
export function hasHistoryPostForDate(db: Database.Database, postDate: string): boolean {
  return db.prepare("SELECT 1 FROM history_posts WHERE post_date = ?").get(postDate) !== undefined;
}

export function recordHistoryPost(
  db: Database.Database,
  input: { postDate: string; postedInRunId: number; itemCount: number }
): HistoryPostRow {
  const now = new Date().toISOString();
  const result = db
    .prepare("INSERT INTO history_posts (post_date, posted_in_run_id, item_count, created_at) VALUES (?, ?, ?, ?)")
    .run(input.postDate, input.postedInRunId, input.itemCount, now);
  return db.prepare("SELECT * FROM history_posts WHERE id = ?").get(Number(result.lastInsertRowid)) as HistoryPostRow;
}

export function getLastHistoryPost(db: Database.Database): HistoryPostRow | undefined {
  return db.prepare("SELECT * FROM history_posts ORDER BY post_date DESC LIMIT 1").get() as HistoryPostRow | undefined;
}
