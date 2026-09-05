import type Database from "better-sqlite3";

export interface ShowsRunRow {
  id: number;
  run_date: string;
  posted_in_run_id: number;
  item_count: number;
  created_at: string;
}

/** True if a SHOWS post has already been recorded for this local date (YYYY-MM-DD) - the once-a-week idempotency guard. */
export function hasShowsPostForDate(db: Database.Database, runDate: string): boolean {
  return db.prepare("SELECT 1 FROM shows_runs WHERE run_date = ?").get(runDate) !== undefined;
}

export function recordShowsPost(
  db: Database.Database,
  input: { runDate: string; postedInRunId: number; itemCount: number }
): ShowsRunRow {
  const now = new Date().toISOString();
  const result = db
    .prepare("INSERT INTO shows_runs (run_date, posted_in_run_id, item_count, created_at) VALUES (?, ?, ?, ?)")
    .run(input.runDate, input.postedInRunId, input.itemCount, now);
  return db.prepare("SELECT * FROM shows_runs WHERE id = ?").get(Number(result.lastInsertRowid)) as ShowsRunRow;
}

export function getLastShowsRun(db: Database.Database): ShowsRunRow | undefined {
  return db.prepare("SELECT * FROM shows_runs ORDER BY run_date DESC LIMIT 1").get() as ShowsRunRow | undefined;
}
