import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openStoryDb, closeStoryDb } from "../../src/newswire/db/connection.js";
import { runMigrations } from "../../src/newswire/db/migrate.js";
import { buildFestivalKey, hasPostedFestivalPoster, recordFestivalPosterPost, getFestivalPosterCount } from "../../src/newswire/db/festivalPostersRepo.js";
import { startHourlyRun, finishHourlyRun, getHourlyRun, getLastHourlyRun, insertRunCandidate } from "../../src/newswire/db/researchRunsRepo.js";
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
    for (const t of ["schema_migrations", "hourly_runs", "run_candidates", "bluesky_posts", "festival_poster_posts"]) {
      expect(tables).toContain(t);
    }
  });

  it("is idempotent - running migrations again on an already-migrated DB is a no-op, not an error", () => {
    expect(() => runMigrations(db)).not.toThrow();
    const migrationRows = db.prepare("SELECT COUNT(*) as c FROM schema_migrations").get() as { c: number };
    expect(migrationRows.c).toBeGreaterThan(0);
  });

  it("enforces foreign key constraints (PRAGMA foreign_keys=ON actually took effect)", () => {
    // hourly_runs has no FK-bearing columns itself, but run_candidates.run_id references it -
    // inserting a run_candidates row against a nonexistent run_id should fail with FKs on.
    expect(() =>
      db
        .prepare("INSERT INTO run_candidates (run_id, stage, candidate_summary, decision, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(999999, "discovery", "x", "accepted", new Date().toISOString())
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

  it("getLastHourlyRun ignores dry runs", () => {
    expect(getLastHourlyRun(db)).toBeUndefined();
    startHourlyRun(db, true); // dry run - should not count
    expect(getLastHourlyRun(db)).toBeUndefined();
    const real = startHourlyRun(db, false);
    expect(getLastHourlyRun(db)?.id).toBe(real.id);
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

  describe("festival_poster_posts", () => {
    it("has not posted a festival until recordFestivalPosterPost is called", () => {
      expect(hasPostedFestivalPoster(db, buildFestivalKey("Coachella", 2027))).toBe(false);
      expect(getFestivalPosterCount(db)).toBe(0);
    });

    it("round-trips a recorded festival poster post and enforces once-per-key via UNIQUE", () => {
      const run = startHourlyRun(db, false);
      const key = buildFestivalKey("Coachella", 2027);
      const recorded = recordFestivalPosterPost(db, { festivalKey: key, festivalName: "Coachella", postedInRunId: run.id });
      expect(recorded.festival_key).toBe(key);
      expect(hasPostedFestivalPoster(db, key)).toBe(true);
      expect(hasPostedFestivalPoster(db, buildFestivalKey("Coachella", 2028))).toBe(false);
      expect(getFestivalPosterCount(db)).toBe(1);

      expect(() => recordFestivalPosterPost(db, { festivalKey: key, festivalName: "Coachella", postedInRunId: run.id })).toThrow();
    });
  });
});
