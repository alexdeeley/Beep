import type Database from "better-sqlite3";

export interface BiggestStoriesPostRow {
  id: number;
  post_date: string;
  posted_in_run_id: number;
  item_count: number;
  created_at: string;
}

/** True if a TOP MUSIC STORIES recap has already been recorded for this local date (YYYY-MM-DD) - the once-a-day idempotency guard. */
export function hasBiggestStoriesPostForDate(db: Database.Database, postDate: string): boolean {
  return db.prepare("SELECT 1 FROM biggest_stories_posts WHERE post_date = ?").get(postDate) !== undefined;
}

export function recordBiggestStoriesPost(
  db: Database.Database,
  input: { postDate: string; postedInRunId: number; itemCount: number }
): BiggestStoriesPostRow {
  const now = new Date().toISOString();
  const result = db
    .prepare("INSERT INTO biggest_stories_posts (post_date, posted_in_run_id, item_count, created_at) VALUES (?, ?, ?, ?)")
    .run(input.postDate, input.postedInRunId, input.itemCount, now);
  return db.prepare("SELECT * FROM biggest_stories_posts WHERE id = ?").get(Number(result.lastInsertRowid)) as BiggestStoriesPostRow;
}
