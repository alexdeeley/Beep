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

export interface ResearchSearchRow {
  id: number;
  run_id: number;
  stage: string;
  query: string;
  result_count: number;
  created_at: string;
}

export interface DeepResearchRunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "failed";
  context_blob: string | null;
  token_usage_json: string | null;
  error_message: string | null;
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

export function insertResearchSearch(
  db: Database.Database,
  input: { runId: number; stage: string; query: string; resultCount: number }
): ResearchSearchRow {
  const now = new Date().toISOString();
  const result = db
    .prepare(`INSERT INTO research_searches (run_id, stage, query, result_count, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(input.runId, input.stage, input.query, input.resultCount, now);
  return db
    .prepare("SELECT * FROM research_searches WHERE id = ?")
    .get(Number(result.lastInsertRowid)) as ResearchSearchRow;
}

export function startDeepResearchRun(db: Database.Database): DeepResearchRunRow {
  const now = new Date().toISOString();
  const result = db.prepare("INSERT INTO deep_research_runs (started_at, status) VALUES (?, 'running')").run(now);
  return db
    .prepare("SELECT * FROM deep_research_runs WHERE id = ?")
    .get(Number(result.lastInsertRowid)) as DeepResearchRunRow;
}

export function finishDeepResearchRun(
  db: Database.Database,
  id: number,
  fields: Partial<Pick<DeepResearchRunRow, "status" | "context_blob" | "token_usage_json" | "error_message">>
): void {
  const sets: string[] = ["finished_at = ?"];
  const values: unknown[] = [new Date().toISOString()];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    values.push(v);
  }
  values.push(id);
  db.prepare(`UPDATE deep_research_runs SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function getLatestDeepResearchRun(db: Database.Database): DeepResearchRunRow | undefined {
  return db.prepare("SELECT * FROM deep_research_runs WHERE status = 'success' ORDER BY started_at DESC LIMIT 1").get() as
    | DeepResearchRunRow
    | undefined;
}
