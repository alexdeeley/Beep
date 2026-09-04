import type Database from "better-sqlite3";
import type { FactLabel, MusicItemType, ReleaseFormat, VerifiedFact } from "../types.js";

export interface MusicItemRow {
  id: number;
  watched_artist_id: number;
  item_type: MusicItemType;
  release_format: ReleaseFormat | null;
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

/** release_format values that are batched into the weekly Friday roundup rather than posted individually. */
const BATCHED_RELEASE_FORMATS: ReleaseFormat[] = ["album", "ep", "compilation"];

function normalizeHeadline(headline: string): string {
  return headline
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True if this artist already has a recorded item (posted or not) with an
 * effectively identical headline - a second line of defense against
 * re-surfacing the same underlying event from a different source URL
 * (the DB's unique index only catches an identical source_url, not a
 * different outlet covering the same story). Not exhaustive semantic
 * dedup - just an exact-normalized-headline check, cheap and mechanical,
 * matching this pipeline's existing content-hash duplicate-check pattern.
 */
export function hasSimilarItem(db: Database.Database, watchedArtistId: number, headline: string): boolean {
  const normalized = normalizeHeadline(headline);
  const rows = db
    .prepare("SELECT headline FROM music_items WHERE watched_artist_id = ?")
    .all(watchedArtistId) as { headline: string }[];
  return rows.some((r) => normalizeHeadline(r.headline) === normalized);
}

/** Insert-or-ignore on (watched_artist_id, primary_source_url) - returns the existing row if this exact source was already recorded for this artist. */
export function insertMusicItem(
  db: Database.Database,
  input: {
    watchedArtistId: number;
    itemType: MusicItemType;
    releaseFormat: ReleaseFormat | null;
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
): MusicItemRow {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO music_items
        (watched_artist_id, item_type, release_format, headline, summary, fact_label, event_time, event_time_confidence, article_published_at, primary_source_url, source_domains_json, facts_json, discovered_in_run_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.watchedArtistId,
      input.itemType,
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
    ? (db.prepare("SELECT * FROM music_items WHERE id = ?").get(id) as MusicItemRow)
    : (db
        .prepare("SELECT * FROM music_items WHERE watched_artist_id = ? AND primary_source_url = ?")
        .get(input.watchedArtistId, input.primarySourceUrl) as MusicItemRow);
  return row;
}

export interface UnpostedMusicItemRow extends MusicItemRow {
  artist_name: string;
}

/** The candidate pool for this cycle's edition: every item discovered (this run or an earlier one) that hasn't been posted yet, oldest-discovered-first so nothing starves behind a busier week. */
export function getUnpostedMusicItems(db: Database.Database): UnpostedMusicItemRow[] {
  return db
    .prepare(
      `SELECT m.*, a.name as artist_name FROM music_items m
       JOIN watched_artists a ON a.id = m.watched_artist_id
       WHERE m.posted_in_run_id IS NULL
       ORDER BY m.discovered_in_run_id ASC, m.created_at ASC`
    )
    .all() as UnpostedMusicItemRow[];
}

/** Everything eligible for the normal hourly per-item flow: singles and news, but NOT album/EP/compilation releases - those are held back for the weekly Friday roundup instead (see getUnpostedAlbumItems). */
export function getUnpostedIndividualItems(db: Database.Database): UnpostedMusicItemRow[] {
  return db
    .prepare(
      `SELECT m.*, a.name as artist_name FROM music_items m
       JOIN watched_artists a ON a.id = m.watched_artist_id
       WHERE m.posted_in_run_id IS NULL
         AND (m.item_type != 'release' OR m.release_format NOT IN ('album', 'ep', 'compilation') OR m.release_format IS NULL)
       ORDER BY m.discovered_in_run_id ASC, m.created_at ASC`
    )
    .all() as UnpostedMusicItemRow[];
}

/** Album/EP/compilation releases accumulated since the last WEEKLY NEW RELEASES roundup - the candidate pool for postWeeklyRoundup.ts. */
export function getUnpostedAlbumItems(db: Database.Database): UnpostedMusicItemRow[] {
  return db
    .prepare(
      `SELECT m.*, a.name as artist_name FROM music_items m
       JOIN watched_artists a ON a.id = m.watched_artist_id
       WHERE m.posted_in_run_id IS NULL
         AND m.item_type = 'release' AND m.release_format IN ('album', 'ep', 'compilation')
       ORDER BY m.discovered_in_run_id ASC, m.created_at ASC`
    )
    .all() as UnpostedMusicItemRow[];
}

export function markMusicItemPosted(db: Database.Database, itemId: number, runId: number): void {
  db.prepare("UPDATE music_items SET posted_in_run_id = ? WHERE id = ?").run(runId, itemId);
}

export function getRecentlyPostedMusicItems(db: Database.Database, limit: number): UnpostedMusicItemRow[] {
  return db
    .prepare(
      `SELECT m.*, a.name as artist_name FROM music_items m
       JOIN watched_artists a ON a.id = m.watched_artist_id
       WHERE m.posted_in_run_id IS NOT NULL
       ORDER BY m.created_at DESC LIMIT ?`
    )
    .all(limit) as UnpostedMusicItemRow[];
}
