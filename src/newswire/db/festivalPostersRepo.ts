import type Database from "better-sqlite3";

export interface FestivalPosterPostRow {
  id: number;
  festival_key: string;
  festival_name: string;
  posted_in_run_id: number;
  created_at: string;
}

/** Case/punctuation-insensitive normalization for the dedup key, same comparison rule used throughout this pipeline. */
function normalizeHeadline(headline: string): string {
  return headline
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The dedup key: normalized festival name + edition year, so "Coachella 2027" and next year's
 * "Coachella 2028" are tracked independently. A null year falls back to just the normalized name -
 * rare (only when neither discovery nor verification could pin down an edition year), and means a
 * same-named festival without a year can only ever post once.
 */
export function buildFestivalKey(festivalName: string, eventYear: number | null): string {
  const name = normalizeHeadline(festivalName);
  return eventYear !== null ? `${name}|${eventYear}` : name;
}

export function hasPostedFestivalPoster(db: Database.Database, festivalKey: string): boolean {
  return db.prepare("SELECT 1 FROM festival_poster_posts WHERE festival_key = ?").get(festivalKey) !== undefined;
}

export function recordFestivalPosterPost(
  db: Database.Database,
  input: { festivalKey: string; festivalName: string; postedInRunId: number }
): FestivalPosterPostRow {
  const now = new Date().toISOString();
  const result = db
    .prepare("INSERT INTO festival_poster_posts (festival_key, festival_name, posted_in_run_id, created_at) VALUES (?, ?, ?, ?)")
    .run(input.festivalKey, input.festivalName, input.postedInRunId, now);
  return db.prepare("SELECT * FROM festival_poster_posts WHERE id = ?").get(Number(result.lastInsertRowid)) as FestivalPosterPostRow;
}

export function getFestivalPosterCount(db: Database.Database): number {
  const row = db.prepare("SELECT COUNT(*) as c FROM festival_poster_posts").get() as { c: number };
  return row.c;
}

export function getRecentFestivalPosterPosts(db: Database.Database, limit: number): FestivalPosterPostRow[] {
  return db.prepare("SELECT * FROM festival_poster_posts ORDER BY id DESC LIMIT ?").all(limit) as FestivalPosterPostRow[];
}
