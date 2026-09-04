import type Database from "better-sqlite3";

export interface HourlyRunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "failed" | "silent";
  quiet_hours_outcome: "normal" | "slow" | "silent" | null;
  candidates_found: number;
  candidates_rejected: number;
  final_edition_json: string | null;
  publish_status: "published" | "skipped" | "failed" | "dry_run" | null;
  token_usage_json: string | null;
  error_message: string | null;
  dry_run: number;
}

export function startHourlyRun(db: Database.Database, dryRun: boolean): HourlyRunRow {
  const now = new Date().toISOString();
  const result = db
    .prepare("INSERT INTO hourly_runs (started_at, status, dry_run) VALUES (?, 'running', ?)")
    .run(now, dryRun ? 1 : 0);
  return getHourlyRun(db, Number(result.lastInsertRowid))!;
}

export function getHourlyRun(db: Database.Database, id: number): HourlyRunRow | undefined {
  return db.prepare("SELECT * FROM hourly_runs WHERE id = ?").get(id) as HourlyRunRow | undefined;
}

export function finishHourlyRun(
  db: Database.Database,
  runId: number,
  fields: Partial<
    Pick<
      HourlyRunRow,
      | "status"
      | "quiet_hours_outcome"
      | "candidates_found"
      | "candidates_rejected"
      | "final_edition_json"
      | "publish_status"
      | "token_usage_json"
      | "error_message"
    >
  >
): void {
  const sets: string[] = ["finished_at = ?"];
  const values: unknown[] = [new Date().toISOString()];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    values.push(v);
  }
  values.push(runId);
  db.prepare(`UPDATE hourly_runs SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function getLastHourlyRun(db: Database.Database): HourlyRunRow | undefined {
  return db.prepare("SELECT * FROM hourly_runs WHERE dry_run = 0 ORDER BY started_at DESC LIMIT 1").get() as
    | HourlyRunRow
    | undefined;
}

export function getRecentHourlyRuns(db: Database.Database, limit: number): HourlyRunRow[] {
  return db.prepare("SELECT * FROM hourly_runs ORDER BY started_at DESC LIMIT ?").all(limit) as HourlyRunRow[];
}

export interface RunCandidateRow {
  id: number;
  run_id: number;
  stage: string;
  candidate_summary: string;
  decision: "accepted" | "rejected";
  reason: string | null;
  story_id: number | null;
  created_at: string;
}

/** Per-stage accept/reject audit trail (discovery/verification), keyed loosely to `storyId` for the pre-V3 general pipeline - null for the current music pipeline, which has no equivalent concept. */
export function insertRunCandidate(
  db: Database.Database,
  input: {
    runId: number;
    stage: string;
    candidateSummary: string;
    decision: "accepted" | "rejected";
    reason: string | null;
    storyId: number | null;
  }
): RunCandidateRow {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO run_candidates (run_id, stage, candidate_summary, decision, reason, story_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(input.runId, input.stage, input.candidateSummary, input.decision, input.reason, input.storyId, now);
  return db.prepare("SELECT * FROM run_candidates WHERE id = ?").get(Number(result.lastInsertRowid)) as RunCandidateRow;
}
