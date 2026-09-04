import type Database from "better-sqlite3";
import type { FactLabel, RoundupReleaseFormat, VerifiedFact } from "../types.js";
import { normalizeHeadline } from "./musicItemsRepo.js";

/**
 * A major album/EP/compilation release surfaced by the industry-wide
 * discoverIndustryReleases sweep - independent of watched-artists.txt, so
 * (unlike music_items) there is no watched_artist_id to key off. Feeds the
 * Friday WEEKLY NEW RELEASES roundup alongside watchlist album items (see
 * weeklyRoundup/postWeeklyRoundup.ts).
 */
export interface IndustryReleaseItemRow {
  id: number;
  artist_name: string;
  release_format: RoundupReleaseFormat;
  headline: string;
  summary: string;
  fact_label: FactLabel;
  event_time: string | null;
  event_time_confidence: "exact" | "approximate" | "unknown";
  article_published_at: string | null;
  primary_source_url: string;
  source_domains_json: string;
  facts_json: string;
  discovered_in_run_id: number;
  posted_in_run_id: number | null;
  created_at: string;
}

/** Same "effectively identical headline already on record" guard as musicItemsRepo's hasSimilarItem, scoped by artist name instead of a watched_artist_id FK. */
export function hasSimilarIndustryItem(db: Database.Database, artistName: string, headline: string): boolean {
  const normalized = normalizeHeadline(headline);
  const rows = db
    .prepare("SELECT headline FROM industry_release_items WHERE artist_name = ? COLLATE NOCASE")
    .all(artistName) as { headline: string }[];
  return rows.some((r) => normalizeHeadline(r.headline) === normalized);
}

/** Insert-or-ignore on (artist_name, primary_source_url) - returns the existing row if this exact source was already recorded for this artist. */
export function insertIndustryReleaseItem(
  db: Database.Database,
  input: {
    artistName: string;
    releaseFormat: RoundupReleaseFormat;
    headline: string;
    summary: string;
    factLabel: FactLabel;
    eventTime: string | null;
    eventTimeConfidence: "exact" | "approximate" | "unknown";
    articlePublishedAt: string | null;
    primarySourceUrl: string;
    sourceDomains: string[];
    facts: VerifiedFact[];
    discoveredInRunId: number;
  }
): IndustryReleaseItemRow {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO industry_release_items
        (artist_name, release_format, headline, summary, fact_label, event_time, event_time_confidence, article_published_at, primary_source_url, source_domains_json, facts_json, discovered_in_run_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.artistName,
      input.releaseFormat,
      input.headline,
      input.summary,
      input.factLabel,
      input.eventTime,
      input.eventTimeConfidence,
      input.articlePublishedAt,
      input.primarySourceUrl,
      JSON.stringify(input.sourceDomains),
      JSON.stringify(input.facts),
      input.discoveredInRunId,
      now
    );
  const id = result.changes > 0 ? Number(result.lastInsertRowid) : undefined;
  const row = id
    ? (db.prepare("SELECT * FROM industry_release_items WHERE id = ?").get(id) as IndustryReleaseItemRow)
    : (db
        .prepare("SELECT * FROM industry_release_items WHERE artist_name = ? AND primary_source_url = ?")
        .get(input.artistName, input.primarySourceUrl) as IndustryReleaseItemRow);
  return row;
}

/** Every industry-wide release not yet posted, oldest-discovered-first - the candidate pool postWeeklyRoundup.ts merges with watchlist albums. */
export function getUnpostedIndustryReleaseItems(db: Database.Database): IndustryReleaseItemRow[] {
  return db
    .prepare(`SELECT * FROM industry_release_items WHERE posted_in_run_id IS NULL ORDER BY discovered_in_run_id ASC, created_at ASC`)
    .all() as IndustryReleaseItemRow[];
}

export function markIndustryReleaseItemPosted(db: Database.Database, itemId: number, runId: number): void {
  db.prepare("UPDATE industry_release_items SET posted_in_run_id = ? WHERE id = ?").run(runId, itemId);
}
