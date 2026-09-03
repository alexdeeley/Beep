import type Database from "better-sqlite3";

export interface StoryRow {
  id: number;
  slug: string;
  headline: string;
  summary: string;
  topic_tags: string; // JSON string array
  status: "open" | "archived";
  importance_score: number;
  first_seen_at: string;
  last_updated_at: string;
  last_posted_at: string | null;
  archived_at: string | null;
  created_in_run_id: number | null;
}

export interface StoryEventRow {
  id: number;
  story_id: number;
  summary: string;
  event_time: string | null;
  event_time_confidence: "exact" | "approximate" | "unknown";
  article_published_at: string | null;
  fact_label: "FACT" | "ANALYSIS" | "UNCONFIRMED" | "BACKGROUND" | "PREDICTION";
  is_correction: number;
  corrects_event_id: number | null;
  discovered_in_run_id: number;
  posted_in_run_id: number | null;
  created_at: string;
}

export function insertStory(
  db: Database.Database,
  input: {
    slug: string;
    headline: string;
    summary: string;
    topicTags: string[];
    importanceScore: number;
    createdInRunId: number;
  }
): StoryRow {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO stories (slug, headline, summary, topic_tags, status, importance_score, first_seen_at, last_updated_at, created_in_run_id)
       VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?)`
    )
    .run(input.slug, input.headline, input.summary, JSON.stringify(input.topicTags), input.importanceScore, now, now, input.createdInRunId);
  return getStoryById(db, Number(result.lastInsertRowid))!;
}

export function getStoryById(db: Database.Database, id: number): StoryRow | undefined {
  return db.prepare("SELECT * FROM stories WHERE id = ?").get(id) as StoryRow | undefined;
}

export function getStoryBySlug(db: Database.Database, slug: string): StoryRow | undefined {
  return db.prepare("SELECT * FROM stories WHERE slug = ?").get(slug) as StoryRow | undefined;
}

export function getOpenStories(db: Database.Database): StoryRow[] {
  return db.prepare("SELECT * FROM stories WHERE status = 'open' ORDER BY last_updated_at DESC").all() as StoryRow[];
}

export function touchStory(
  db: Database.Database,
  storyId: number,
  fields: Partial<Pick<StoryRow, "headline" | "summary" | "importance_score" | "last_posted_at">>
): void {
  const now = new Date().toISOString();
  const sets: string[] = ["last_updated_at = ?"];
  const values: unknown[] = [now];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    values.push(v);
  }
  values.push(storyId);
  db.prepare(`UPDATE stories SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

/** Archives stories that haven't been touched in `staleDays` - "archive, don't delete", per the long-term-memory requirement. */
export function archiveStaleStories(db: Database.Database, staleDays: number): number {
  const cutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000).toISOString();
  const result = db
    .prepare("UPDATE stories SET status = 'archived', archived_at = ? WHERE status = 'open' AND last_updated_at < ?")
    .run(new Date().toISOString(), cutoff);
  return result.changes;
}

export function insertStoryEvent(
  db: Database.Database,
  input: {
    storyId: number;
    summary: string;
    eventTime: string | null;
    eventTimeConfidence: StoryEventRow["event_time_confidence"];
    articlePublishedAt: string | null;
    factLabel: StoryEventRow["fact_label"];
    isCorrection: boolean;
    correctsEventId: number | null;
    discoveredInRunId: number;
  }
): StoryEventRow {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO story_events
        (story_id, summary, event_time, event_time_confidence, article_published_at, fact_label, is_correction, corrects_event_id, discovered_in_run_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.storyId,
      input.summary,
      input.eventTime,
      input.eventTimeConfidence,
      input.articlePublishedAt,
      input.factLabel,
      input.isCorrection ? 1 : 0,
      input.correctsEventId,
      input.discoveredInRunId,
      now
    );
  return getStoryEventById(db, Number(result.lastInsertRowid))!;
}

export function getStoryEventById(db: Database.Database, id: number): StoryEventRow | undefined {
  return db.prepare("SELECT * FROM story_events WHERE id = ?").get(id) as StoryEventRow | undefined;
}

export function getEventsForStory(db: Database.Database, storyId: number): StoryEventRow[] {
  return db.prepare("SELECT * FROM story_events WHERE story_id = ? ORDER BY created_at ASC").all(storyId) as StoryEventRow[];
}

/** Events discovered since the story was last posted about - the input to the dedup "what's new" test. */
export function getUnpostedEventsForStory(db: Database.Database, storyId: number): StoryEventRow[] {
  return db
    .prepare(
      `SELECT * FROM story_events WHERE story_id = ? AND posted_in_run_id IS NULL ORDER BY created_at ASC`
    )
    .all(storyId) as StoryEventRow[];
}

export function markEventPosted(db: Database.Database, eventId: number, runId: number): void {
  db.prepare("UPDATE story_events SET posted_in_run_id = ? WHERE id = ?").run(runId, eventId);
}
