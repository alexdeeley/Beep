import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openStoryDb, closeStoryDb } from "../../src/newswire/db/connection.js";
import { runMigrations } from "../../src/newswire/db/migrate.js";
import {
  importArtistNames,
  getArtistsDueForCheck,
  markArtistsChecked,
  getArtistByName,
  getWatchedArtistCount,
} from "../../src/newswire/db/watchedArtistsRepo.js";
import {
  insertMusicItem,
  getUnpostedMusicItems,
  getUnpostedIndividualItems,
  getUnpostedAlbumItems,
  markMusicItemPosted,
  getRecentlyPostedMusicItems,
  hasSimilarItem,
} from "../../src/newswire/db/musicItemsRepo.js";
import {
  insertIndustryReleaseItem,
  getUnpostedIndustryReleaseItems,
  markIndustryReleaseItemPosted,
  hasSimilarIndustryItem,
} from "../../src/newswire/db/industryReleaseItemsRepo.js";
import { startHourlyRun, finishHourlyRun, getHourlyRun, insertRunCandidate } from "../../src/newswire/db/researchRunsRepo.js";
import { insertBlueskyPost, findPostByContentHash } from "../../src/newswire/db/postsRepo.js";
import type { VerifiedFact } from "../../src/newswire/types.js";

const SAMPLE_FACTS: VerifiedFact[] = [
  {
    claim: "Alvvays released a new album titled Blue Rev II.",
    factLabel: "FACT",
    eventTimeIso: "2026-09-01T00:00:00.000Z",
    eventTimeConfidence: "exact",
    articlePublishedAtIso: "2026-09-01T12:00:00.000Z",
    sources: [{ url: "https://pitchfork.com/a", title: "Alvvays announce new album", domain: "pitchfork.com", sourceTier: "entertainment_trade", isPrimary: true }],
  },
];

describe("newswire SQLite DB layer", () => {
  let dir: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "newswire-db-test-"));
    dbPath = join(dir, "story.db");
    db = openStoryDb(dbPath);
  });
  afterEach(() => {
    closeStoryDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates the database file and all expected tables on first open", () => {
    expect(existsSync(dbPath)).toBe(true);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => (r as { name: string }).name);
    for (const t of [
      "schema_migrations",
      "hourly_runs",
      "run_candidates",
      "bluesky_posts",
      "watched_artists",
      "music_items",
      "industry_release_items",
    ]) {
      expect(tables).toContain(t);
    }
  });

  it("is idempotent - running migrations again on an already-migrated DB is a no-op, not an error", () => {
    expect(() => runMigrations(db)).not.toThrow();
    const migrationRows = db.prepare("SELECT COUNT(*) as c FROM schema_migrations").get() as { c: number };
    expect(migrationRows.c).toBeGreaterThan(0);
  });

  it("enforces foreign key constraints (PRAGMA foreign_keys=ON actually took effect)", () => {
    expect(() =>
      insertMusicItem(db, {
        watchedArtistId: 999999, // no such watched_artists row
        itemType: "release",
        releaseFormat: null,
        headline: "H",
        summary: "S",
        factLabel: "FACT",
        eventTime: null,
        eventTimeConfidence: "unknown",
        articlePublishedAt: null,
        primarySourceUrl: "https://example.com/a",
        sourceDomains: ["example.com"],
        facts: SAMPLE_FACTS,
        discoveredInRunId: 1,
      })
    ).toThrow();
  });

  it("round-trips hourly_runs and run_candidates", () => {
    const run = startHourlyRun(db, true);
    expect(run.status).toBe("running");
    expect(run.dry_run).toBe(1);

    insertRunCandidate(db, { runId: run.id, stage: "discovery", candidateSummary: "x", decision: "accepted", reason: null, storyId: null });

    finishHourlyRun(db, run.id, { status: "success", publish_status: "dry_run" });
    const finished = getHourlyRun(db, run.id);
    expect(finished?.status).toBe("success");
    expect(finished?.finished_at).not.toBeNull();
  });

  it("round-trips bluesky_posts and finds a post by content hash", () => {
    const run = startHourlyRun(db, false);
    const post = insertBlueskyPost(db, {
      runId: run.id,
      threadPosition: 0,
      text: "Hello",
      contentHash: "abc123",
      uri: "at://did:plc:x/app.bsky.feed.post/1",
      cid: "bafy...",
      rootUri: null,
      parentUri: null,
      dryRun: false,
    });
    expect(findPostByContentHash(db, "abc123")?.id).toBe(post.id);
    expect(findPostByContentHash(db, "does-not-exist")).toBeUndefined();
  });

  describe("watched_artists", () => {
    it("imports names idempotently (unique by name)", () => {
      const first = importArtistNames(db, ["Radiohead", "Wilco", "Radiohead"]);
      expect(first).toBe(2); // "Radiohead" only inserted once even though listed twice
      const second = importArtistNames(db, ["Radiohead", "Beck"]);
      expect(second).toBe(1); // only "Beck" is new
      expect(getWatchedArtistCount(db)).toBe(3);
    });

    it("finds an artist by exact name", () => {
      importArtistNames(db, ["Wilco"]);
      expect(getArtistByName(db, "Wilco")?.name).toBe("Wilco");
      expect(getArtistByName(db, "wilco")).toBeUndefined(); // case-sensitive exact match
    });

    it("orders the rotation batch never-checked-first, then oldest-checked-first", () => {
      importArtistNames(db, ["X", "Y"]);
      const [x, y] = getArtistsDueForCheck(db, 2);
      // Both never checked - marking one checked should push it behind the other.
      markArtistsChecked(db, [x!.id]);
      const due = getArtistsDueForCheck(db, 2);
      expect(due[0]!.id).toBe(y!.id); // never-checked Y comes before now-checked X
      expect(due[1]!.id).toBe(x!.id);
    });
  });

  describe("music_items", () => {
    function makeArtist(name: string): number {
      importArtistNames(db, [name]);
      return getArtistByName(db, name)!.id;
    }

    it("round-trips a music item and finds it as unposted", () => {
      const run = startHourlyRun(db, false);
      const artistId = makeArtist("Alvvays");
      const item = insertMusicItem(db, {
        watchedArtistId: artistId,
        itemType: "release",
        releaseFormat: null,
        headline: "Alvvays release Blue Rev II",
        summary: "Alvvays released a new album titled Blue Rev II.",
        factLabel: "FACT",
        eventTime: "2026-09-01T00:00:00.000Z",
        eventTimeConfidence: "exact",
        articlePublishedAt: "2026-09-01T12:00:00.000Z",
        primarySourceUrl: "https://pitchfork.com/a",
        sourceDomains: ["pitchfork.com", "billboard.com"],
        facts: SAMPLE_FACTS,
        discoveredInRunId: run.id,
      });
      expect(item.headline).toBe("Alvvays release Blue Rev II");
      expect(JSON.parse(item.facts_json)).toEqual(SAMPLE_FACTS);

      const unposted = getUnpostedMusicItems(db);
      expect(unposted).toHaveLength(1);
      expect(unposted[0]!.artist_name).toBe("Alvvays");

      markMusicItemPosted(db, item.id, run.id);
      expect(getUnpostedMusicItems(db)).toHaveLength(0);
      expect(getRecentlyPostedMusicItems(db, 5).map((r) => r.id)).toContain(item.id);
    });

    it("is idempotent on (watched_artist_id, primary_source_url) via INSERT OR IGNORE", () => {
      const run = startHourlyRun(db, false);
      const artistId = makeArtist("Beck");
      const input = {
        watchedArtistId: artistId,
        itemType: "release" as const,
        releaseFormat: null,
        headline: "Beck news",
        summary: "S",
        factLabel: "FACT" as const,
        eventTime: null,
        eventTimeConfidence: "unknown" as const,
        articlePublishedAt: null,
        primarySourceUrl: "https://example.com/dup",
        sourceDomains: ["example.com"],
        facts: SAMPLE_FACTS,
        discoveredInRunId: run.id,
      };
      const first = insertMusicItem(db, input);
      const second = insertMusicItem(db, { ...input, headline: "Different headline, same source URL" });
      expect(first.id).toBe(second.id);
      expect(getUnpostedMusicItems(db)).toHaveLength(1);
    });

    it("orders unposted items FIFO by discovered run", () => {
      const runOld = startHourlyRun(db, false);
      const runNew = startHourlyRun(db, false);
      const artistId = makeArtist("Some Band");

      insertMusicItem(db, {
        watchedArtistId: artistId,
        itemType: "news",
        releaseFormat: null,
        headline: "Old news",
        summary: "S",
        factLabel: "FACT",
        eventTime: null,
        eventTimeConfidence: "unknown",
        articlePublishedAt: null,
        primarySourceUrl: "https://example.com/old",
        sourceDomains: ["example.com"],
        facts: SAMPLE_FACTS,
        discoveredInRunId: runOld.id,
      });
      insertMusicItem(db, {
        watchedArtistId: artistId,
        itemType: "news",
        releaseFormat: null,
        headline: "New news",
        summary: "S",
        factLabel: "FACT",
        eventTime: null,
        eventTimeConfidence: "unknown",
        articlePublishedAt: null,
        primarySourceUrl: "https://example.com/new",
        sourceDomains: ["example.com"],
        facts: SAMPLE_FACTS,
        discoveredInRunId: runNew.id,
      });

      const unposted = getUnpostedMusicItems(db);
      expect(unposted[0]!.headline).toBe("Old news");
      expect(unposted[1]!.headline).toBe("New news");
    });

    it("hasSimilarItem detects an effectively identical headline for the same artist", () => {
      const run = startHourlyRun(db, false);
      const artistId = makeArtist("Wilco");
      insertMusicItem(db, {
        watchedArtistId: artistId,
        itemType: "release",
        releaseFormat: null,
        headline: "Wilco Announce New Album!",
        summary: "S",
        factLabel: "FACT",
        eventTime: null,
        eventTimeConfidence: "unknown",
        articlePublishedAt: null,
        primarySourceUrl: "https://a.com/1",
        sourceDomains: ["a.com"],
        facts: SAMPLE_FACTS,
        discoveredInRunId: run.id,
      });

      expect(hasSimilarItem(db, artistId, "wilco announce new album")).toBe(true); // case/punctuation-insensitive match
      expect(hasSimilarItem(db, artistId, "Wilco cancels tour dates")).toBe(false);
    });

    it("splits unposted items into individual (single/news) vs album/EP/compilation buckets", () => {
      const run = startHourlyRun(db, false);
      const artistId = makeArtist("Fontaines D.C.");

      const single = insertMusicItem(db, {
        watchedArtistId: artistId,
        itemType: "release",
        releaseFormat: "single",
        headline: "New single",
        summary: "S",
        factLabel: "FACT",
        eventTime: null,
        eventTimeConfidence: "unknown",
        articlePublishedAt: null,
        primarySourceUrl: "https://a.com/single",
        sourceDomains: ["a.com"],
        facts: SAMPLE_FACTS,
        discoveredInRunId: run.id,
      });
      const news = insertMusicItem(db, {
        watchedArtistId: artistId,
        itemType: "news",
        releaseFormat: null,
        headline: "Tour announced",
        summary: "S",
        factLabel: "FACT",
        eventTime: null,
        eventTimeConfidence: "unknown",
        articlePublishedAt: null,
        primarySourceUrl: "https://a.com/tour",
        sourceDomains: ["a.com"],
        facts: SAMPLE_FACTS,
        discoveredInRunId: run.id,
      });
      const album = insertMusicItem(db, {
        watchedArtistId: artistId,
        itemType: "release",
        releaseFormat: "album",
        headline: "New album",
        summary: "S",
        factLabel: "FACT",
        eventTime: null,
        eventTimeConfidence: "unknown",
        articlePublishedAt: null,
        primarySourceUrl: "https://a.com/album",
        sourceDomains: ["a.com"],
        facts: SAMPLE_FACTS,
        discoveredInRunId: run.id,
      });

      const individual = getUnpostedIndividualItems(db).map((r) => r.id);
      expect(individual).toContain(single.id);
      expect(individual).toContain(news.id);
      expect(individual).not.toContain(album.id);

      const albums = getUnpostedAlbumItems(db).map((r) => r.id);
      expect(albums).toEqual([album.id]);
    });
  });

  describe("industry_release_items", () => {
    it("round-trips an industry-wide release item, independent of any watched_artist_id", () => {
      const run = startHourlyRun(db, false);
      const item = insertIndustryReleaseItem(db, {
        artistName: "Some Non-Watchlist Band",
        releaseFormat: "album",
        headline: "Some Non-Watchlist Band release Loud Colors",
        summary: "Some Non-Watchlist Band released a new album titled Loud Colors.",
        factLabel: "FACT",
        eventTime: "2026-09-04T00:00:00.000Z",
        eventTimeConfidence: "exact",
        articlePublishedAt: "2026-09-04T12:00:00.000Z",
        primarySourceUrl: "https://pitchfork.com/b",
        sourceDomains: ["pitchfork.com", "billboard.com"],
        facts: SAMPLE_FACTS,
        discoveredInRunId: run.id,
      });
      expect(item.artist_name).toBe("Some Non-Watchlist Band");
      expect(JSON.parse(item.facts_json)).toEqual(SAMPLE_FACTS);

      const unposted = getUnpostedIndustryReleaseItems(db);
      expect(unposted).toHaveLength(1);
      expect(unposted[0]!.id).toBe(item.id);

      markIndustryReleaseItemPosted(db, item.id, run.id);
      expect(getUnpostedIndustryReleaseItems(db)).toHaveLength(0);
    });

    it("is idempotent on (artist_name, primary_source_url) via INSERT OR IGNORE", () => {
      const run = startHourlyRun(db, false);
      const input = {
        artistName: "Dup Band",
        releaseFormat: "ep" as const,
        headline: "Dup Band drop new EP",
        summary: "S",
        factLabel: "FACT" as const,
        eventTime: null,
        eventTimeConfidence: "unknown" as const,
        articlePublishedAt: null,
        primarySourceUrl: "https://example.com/dup-ep",
        sourceDomains: ["example.com"],
        facts: SAMPLE_FACTS,
        discoveredInRunId: run.id,
      };
      const first = insertIndustryReleaseItem(db, input);
      const second = insertIndustryReleaseItem(db, { ...input, headline: "Different headline, same source URL" });
      expect(first.id).toBe(second.id);
      expect(getUnpostedIndustryReleaseItems(db)).toHaveLength(1);
    });

    it("hasSimilarIndustryItem detects an effectively identical headline for the same artist name", () => {
      const run = startHourlyRun(db, false);
      insertIndustryReleaseItem(db, {
        artistName: "Loud Colors",
        releaseFormat: "album",
        headline: "Loud Colors Announce New Album!",
        summary: "S",
        factLabel: "FACT",
        eventTime: null,
        eventTimeConfidence: "unknown",
        articlePublishedAt: null,
        primarySourceUrl: "https://a.com/1",
        sourceDomains: ["a.com"],
        facts: SAMPLE_FACTS,
        discoveredInRunId: run.id,
      });

      expect(hasSimilarIndustryItem(db, "Loud Colors", "loud colors announce new album")).toBe(true);
      expect(hasSimilarIndustryItem(db, "Loud Colors", "Loud Colors cancels tour dates")).toBe(false);
      expect(hasSimilarIndustryItem(db, "A Totally Different Band", "loud colors announce new album")).toBe(false);
    });
  });
});
