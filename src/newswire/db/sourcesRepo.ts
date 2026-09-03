import type Database from "better-sqlite3";

export type SourceTier =
  | "primary_official"
  | "court_filing"
  | "company_statement"
  | "entertainment_trade"
  | "wire_service"
  | "general_news"
  | "aggregator"
  | "blog_social";

export interface SourceRow {
  id: number;
  story_event_id: number;
  url: string;
  domain: string;
  title: string | null;
  source_tier: SourceTier;
  is_primary_for_event: number;
  retrieved_at: string;
}

export function insertSource(
  db: Database.Database,
  input: {
    storyEventId: number;
    url: string;
    domain: string;
    title: string | null;
    sourceTier: SourceTier;
    isPrimaryForEvent: boolean;
  }
): SourceRow {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO sources (story_event_id, url, domain, title, source_tier, is_primary_for_event, retrieved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(input.storyEventId, input.url, input.domain, input.title, input.sourceTier, input.isPrimaryForEvent ? 1 : 0, now);
  return db.prepare("SELECT * FROM sources WHERE id = ?").get(Number(result.lastInsertRowid)) as SourceRow;
}

export function getSourcesForEvent(db: Database.Database, storyEventId: number): SourceRow[] {
  return db.prepare("SELECT * FROM sources WHERE story_event_id = ?").all(storyEventId) as SourceRow[];
}

export function getDistinctDomainsForEvent(db: Database.Database, storyEventId: number): string[] {
  const rows = db
    .prepare("SELECT DISTINCT domain FROM sources WHERE story_event_id = ?")
    .all(storyEventId) as { domain: string }[];
  return rows.map((r) => r.domain);
}
