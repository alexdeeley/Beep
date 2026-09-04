import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openStoryDb, closeStoryDb } from "../../src/newswire/db/connection.js";
import { runMigrations } from "../../src/newswire/db/migrate.js";
import {
  importArtistNames,
  getPendingArtists,
  markArtistResolved,
  recordFailedResolveAttempt,
  MAX_RESOLVE_ATTEMPTS,
  getArtistsDueForReleaseCheck,
  markArtistChecked,
  getArtistResolutionCounts,
} from "../../src/newswire/db/watchedArtistsRepo.js";
import { insertRelease, getUnpostedReleases, markReleasePosted, getRecentlyPostedReleases } from "../../src/newswire/db/releasesRepo.js";
import { startHourlyRun, finishHourlyRun, getHourlyRun } from "../../src/newswire/db/researchRunsRepo.js";
import { insertBlueskyPost, findPostByContentHash } from "../../src/newswire/db/postsRepo.js";

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
    for (const t of ["schema_migrations", "hourly_runs", "bluesky_posts", "watched_artists", "releases"]) {
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
      insertRelease(db, {
        watchedArtistId: 999999, // no such watched_artists row
        spotifyReleaseId: "r1",
        releaseType: "single",
        title: "T",
        releaseDate: "2026-01-01",
        releaseDatePrecision: "day",
        totalTracks: 1,
        spotifyUrl: "https://open.spotify.com/album/r1",
        imageUrl: null,
        discoveredInRunId: 1,
      })
    ).toThrow();
  });

  it("round-trips hourly_runs", () => {
    const run = startHourlyRun(db, true);
    expect(run.status).toBe("running");
    expect(run.dry_run).toBe(1);
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
    });

    it("returns pending artists never-tried-first, then fewest-attempts-first", () => {
      importArtistNames(db, ["A", "B", "C"]);
      const [a] = getPendingArtists(db, 1);
      recordFailedResolveAttempt(db, a!.id); // A now has 1 attempt
      const pending = getPendingArtists(db, 10).map((r) => r.name);
      // B and C (0 attempts) should come before A (1 attempt)
      expect(pending.indexOf("B")).toBeLessThan(pending.indexOf("A"));
      expect(pending.indexOf("C")).toBeLessThan(pending.indexOf("A"));
    });

    it("marks an artist unresolved after MAX_RESOLVE_ATTEMPTS failed attempts, pending before that", () => {
      importArtistNames(db, ["Ghost Band"]);
      const [artist] = getPendingArtists(db, 1);
      for (let i = 0; i < MAX_RESOLVE_ATTEMPTS - 1; i++) recordFailedResolveAttempt(db, artist!.id);
      let counts = getArtistResolutionCounts(db);
      expect(counts.pending).toBe(1);
      expect(counts.unresolved).toBe(0);

      recordFailedResolveAttempt(db, artist!.id); // final attempt hits the cap
      counts = getArtistResolutionCounts(db);
      expect(counts.pending).toBe(0);
      expect(counts.unresolved).toBe(1);
    });

    it("marks an artist resolved with Spotify metadata", () => {
      importArtistNames(db, ["Wilco"]);
      const [artist] = getPendingArtists(db, 1);
      markArtistResolved(db, artist!.id, { spotifyArtistId: "spotify123", genres: ["alt-country"], popularity: 55 });
      const counts = getArtistResolutionCounts(db);
      expect(counts.resolved).toBe(1);
      const due = getArtistsDueForReleaseCheck(db, 10);
      expect(due).toHaveLength(1);
      expect(due[0]!.spotify_artist_id).toBe("spotify123");
      expect(due[0]!.genres_json).toBe(JSON.stringify(["alt-country"]));
    });

    it("orders release-check rotation never-checked-first, then oldest-checked-first", () => {
      importArtistNames(db, ["X", "Y"]);
      const pending = getPendingArtists(db, 2);
      for (const p of pending) markArtistResolved(db, p.id, { spotifyArtistId: `sp-${p.name}`, genres: [], popularity: 0 });

      const [x, y] = getArtistsDueForReleaseCheck(db, 2);
      // Both never checked - order between them doesn't matter, but marking one checked should push it behind the other.
      markArtistChecked(db, x!.id, { lastSeenReleaseId: null, lastSeenReleaseDate: null });
      const due = getArtistsDueForReleaseCheck(db, 2);
      expect(due[0]!.id).toBe(y!.id); // never-checked Y comes before now-checked X
      expect(due[1]!.id).toBe(x!.id);
    });
  });

  describe("releases", () => {
    function makeResolvedArtist(name: string): number {
      importArtistNames(db, [name]);
      const [artist] = getPendingArtists(db, 1);
      markArtistResolved(db, artist!.id, { spotifyArtistId: `sp-${name}`, genres: [], popularity: 50 });
      return artist!.id;
    }

    it("round-trips a release and finds it as unposted", () => {
      const run = startHourlyRun(db, false);
      const artistId = makeResolvedArtist("Alvvays");
      const release = insertRelease(db, {
        watchedArtistId: artistId,
        spotifyReleaseId: "album1",
        releaseType: "album",
        title: "Blue Rev",
        releaseDate: "2026-09-01",
        releaseDatePrecision: "day",
        totalTracks: 12,
        spotifyUrl: "https://open.spotify.com/album/album1",
        imageUrl: null,
        discoveredInRunId: run.id,
      });
      expect(release.title).toBe("Blue Rev");

      const unposted = getUnpostedReleases(db);
      expect(unposted).toHaveLength(1);
      expect(unposted[0]!.artist_name).toBe("Alvvays");
      expect(unposted[0]!.artist_popularity).toBe(50);

      markReleasePosted(db, release.id, run.id);
      expect(getUnpostedReleases(db)).toHaveLength(0);
      expect(getRecentlyPostedReleases(db, 5).map((r) => r.id)).toContain(release.id);
    });

    it("is idempotent on spotify_release_id (INSERT OR IGNORE)", () => {
      const run = startHourlyRun(db, false);
      const artistId = makeResolvedArtist("Beck");
      const first = insertRelease(db, {
        watchedArtistId: artistId,
        spotifyReleaseId: "dup1",
        releaseType: "single",
        title: "Single A",
        releaseDate: "2026-09-01",
        releaseDatePrecision: "day",
        totalTracks: 1,
        spotifyUrl: "https://open.spotify.com/album/dup1",
        imageUrl: null,
        discoveredInRunId: run.id,
      });
      const second = insertRelease(db, {
        watchedArtistId: artistId,
        spotifyReleaseId: "dup1",
        releaseType: "single",
        title: "Single A (should be ignored)",
        releaseDate: "2026-09-01",
        releaseDatePrecision: "day",
        totalTracks: 1,
        spotifyUrl: "https://open.spotify.com/album/dup1",
        imageUrl: null,
        discoveredInRunId: run.id,
      });
      expect(first.id).toBe(second.id);
      expect(getUnpostedReleases(db)).toHaveLength(1);
    });

    it("orders unposted releases FIFO by discovered run, not by popularity", () => {
      const runOld = startHourlyRun(db, false);
      const runNew = startHourlyRun(db, false);
      const smallArtist = makeResolvedArtist("Small Band");
      const bigArtist = makeResolvedArtist("Big Star");
      db.prepare("UPDATE watched_artists SET popularity = 90 WHERE id = ?").run(bigArtist);

      insertRelease(db, {
        watchedArtistId: smallArtist,
        spotifyReleaseId: "old-release",
        releaseType: "single",
        title: "Old",
        releaseDate: "2026-08-01",
        releaseDatePrecision: "day",
        totalTracks: 1,
        spotifyUrl: "https://open.spotify.com/album/old-release",
        imageUrl: null,
        discoveredInRunId: runOld.id,
      });
      insertRelease(db, {
        watchedArtistId: bigArtist,
        spotifyReleaseId: "new-release",
        releaseType: "single",
        title: "New",
        releaseDate: "2026-09-01",
        releaseDatePrecision: "day",
        totalTracks: 1,
        spotifyUrl: "https://open.spotify.com/album/new-release",
        imageUrl: null,
        discoveredInRunId: runNew.id,
      });

      const unposted = getUnpostedReleases(db);
      expect(unposted[0]!.title).toBe("Old"); // discovered first, even though the popular artist's release is newer
      expect(unposted[1]!.title).toBe("New");
    });
  });
});
