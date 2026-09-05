import type Database from "better-sqlite3";

export interface WeeklyRoundupRunRow {
  id: number;
  roundup_date: string;
  posted_in_run_id: number;
  item_count: number;
  created_at: string;
}

/** True if a roundup has already been recorded for this local date (YYYY-MM-DD) - the idempotency guard against posting NEW MUSIC FRIDAY twice on the same Friday. */
export function hasRoundupForDate(db: Database.Database, roundupDate: string): boolean {
  return db.prepare("SELECT 1 FROM weekly_roundup_runs WHERE roundup_date = ?").get(roundupDate) !== undefined;
}

export function recordRoundupRun(
  db: Database.Database,
  input: { roundupDate: string; postedInRunId: number; itemCount: number }
): WeeklyRoundupRunRow {
  const now = new Date().toISOString();
  const result = db
    .prepare("INSERT INTO weekly_roundup_runs (roundup_date, posted_in_run_id, item_count, created_at) VALUES (?, ?, ?, ?)")
    .run(input.roundupDate, input.postedInRunId, input.itemCount, now);
  return db.prepare("SELECT * FROM weekly_roundup_runs WHERE id = ?").get(Number(result.lastInsertRowid)) as WeeklyRoundupRunRow;
}

export function getLastRoundupRun(db: Database.Database): WeeklyRoundupRunRow | undefined {
  return db.prepare("SELECT * FROM weekly_roundup_runs ORDER BY roundup_date DESC LIMIT 1").get() as
    | WeeklyRoundupRunRow
    | undefined;
}
