import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openStoryDb, closeStoryDb } from "../../src/newswire/db/connection.js";
import { runMigrations } from "../../src/newswire/db/migrate.js";
import {
  insertStory,
  insertStoryEvent,
  getStoryById,
  getStoryBySlug,
  getOpenStories,
  getEventsForStory,
  getUnpostedEventsForStory,
  markEventPosted,
  touchStory,
  archiveStaleStories,
} from "../../src/newswire/db/storiesRepo.js";
import { insertSource, getSourcesForEvent, getDistinctDomainsForEvent } from "../../src/newswire/db/sourcesRepo.js";
import { upsertEntity, linkStoryEntity, getEntitiesForStory, insertRelationship, getStoriesSharingEntities } from "../../src/newswire/db/entitiesRepo.js";
import { startHourlyRun, finishHourlyRun, getHourlyRun, insertRunCandidate, insertResearchSearch } from "../../src/newswire/db/researchRunsRepo.js";
import { insertBlueskyPost, findPostByContentHash, insertCorrection } from "../../src/newswire/db/postsRepo.js";

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
      "stories",
      "story_events",
      "sources",
      "entities",
      "entity_relationships",
      "story_entities",
      "hourly_runs",
      "run_candidates",
      "research_searches",
      "deep_research_runs",
      "bluesky_posts",
      "corrections",
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
      insertSource(db, {
        storyEventId: 999999, // no such story_event
        url: "https://example.com",
        domain: "example.com",
        title: null,
        sourceTier: "general_news",
        isPrimaryForEvent: false,
      })
    ).toThrow();
  });

  it("round-trips a story and its events through insert/get", () => {
    const run = startHourlyRun(db, false);
    const story = insertStory(db, {
      slug: "test-story",
      headline: "Headline",
      summary: "Summary",
      topicTags: ["politics"],
      importanceScore: 0.5,
      createdInRunId: run.id,
    });
    expect(getStoryById(db, story.id)?.slug).toBe("test-story");
    expect(getStoryBySlug(db, "test-story")?.id).toBe(story.id);
    expect(getOpenStories(db).map((s) => s.id)).toContain(story.id);

    const event = insertStoryEvent(db, {
      storyId: story.id,
      summary: "Something happened",
      eventTime: null,
      eventTimeConfidence: "unknown",
      articlePublishedAt: null,
      factLabel: "FACT",
      isCorrection: false,
      correctsEventId: null,
      discoveredInRunId: run.id,
    });
    expect(getEventsForStory(db, story.id)).toHaveLength(1);
    expect(getUnpostedEventsForStory(db, story.id)).toHaveLength(1);

    markEventPosted(db, event.id, run.id);
    expect(getUnpostedEventsForStory(db, story.id)).toHaveLength(0);

    touchStory(db, story.id, { importance_score: 0.9 });
    expect(getStoryById(db, story.id)?.importance_score).toBe(0.9);
  });

  it("archives stories untouched past the stale threshold, without deleting them", () => {
    const run = startHourlyRun(db, false);
    const story = insertStory(db, {
      slug: "stale-story",
      headline: "Old news",
      summary: "Summary",
      topicTags: ["politics"],
      importanceScore: 0.1,
      createdInRunId: run.id,
    });
    // Backdate last_updated_at directly - simulates a story untouched for a long time.
    db.prepare("UPDATE stories SET last_updated_at = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", story.id);

    const archivedCount = archiveStaleStories(db, 30);
    expect(archivedCount).toBe(1);
    expect(getOpenStories(db).map((s) => s.id)).not.toContain(story.id);
    // Still readable by id - archived, not deleted.
    expect(getStoryById(db, story.id)?.status).toBe("archived");
  });

  it("round-trips sources and computes distinct domains for an event", () => {
    const run = startHourlyRun(db, false);
    const story = insertStory(db, {
      slug: "s",
      headline: "h",
      summary: "s",
      topicTags: ["politics"],
      importanceScore: 0,
      createdInRunId: run.id,
    });
    const event = insertStoryEvent(db, {
      storyId: story.id,
      summary: "e",
      eventTime: null,
      eventTimeConfidence: "unknown",
      articlePublishedAt: null,
      factLabel: "FACT",
      isCorrection: false,
      correctsEventId: null,
      discoveredInRunId: run.id,
    });
    insertSource(db, { storyEventId: event.id, url: "https://a.com/1", domain: "a.com", title: null, sourceTier: "general_news", isPrimaryForEvent: true });
    insertSource(db, { storyEventId: event.id, url: "https://b.com/1", domain: "b.com", title: null, sourceTier: "general_news", isPrimaryForEvent: false });
    expect(getSourcesForEvent(db, event.id)).toHaveLength(2);
    expect(getDistinctDomainsForEvent(db, event.id).sort()).toEqual(["a.com", "b.com"]);
  });

  it("dedupes entities on (name, type) and finds stories that share an entity", () => {
    const run = startHourlyRun(db, false);
    const storyA = insertStory(db, { slug: "a", headline: "A", summary: "s", topicTags: ["politics"], importanceScore: 0, createdInRunId: run.id });
    const storyB = insertStory(db, { slug: "b", headline: "B", summary: "s", topicTags: ["politics"], importanceScore: 0, createdInRunId: run.id });
    const eventA = insertStoryEvent(db, { storyId: storyA.id, summary: "e", eventTime: null, eventTimeConfidence: "unknown", articlePublishedAt: null, factLabel: "FACT", isCorrection: false, correctsEventId: null, discoveredInRunId: run.id });

    const entity1 = upsertEntity(db, "Acme Corp", "COMPANY");
    const entity2 = upsertEntity(db, "Acme Corp", "COMPANY"); // same (name, type) - should dedupe
    expect(entity1.id).toBe(entity2.id);

    linkStoryEntity(db, storyA.id, entity1.id);
    linkStoryEntity(db, storyB.id, entity1.id);
    expect(getEntitiesForStory(db, storyA.id)).toHaveLength(1);

    const otherEntity = upsertEntity(db, "Jane Doe", "PERSON");
    insertRelationship(db, { fromEntityId: otherEntity.id, toEntityId: entity1.id, relationshipType: "EMPLOYED_BY", evidenceStoryEventId: eventA.id });

    const sharing = getStoriesSharingEntities(db, storyA.id);
    expect(sharing.map((s) => s.story_id)).toContain(storyB.id);
  });

  it("round-trips hourly_runs, run_candidates, and research_searches", () => {
    const run = startHourlyRun(db, true);
    expect(run.status).toBe("running");
    expect(run.dry_run).toBe(1);

    insertRunCandidate(db, { runId: run.id, stage: "discovery", candidateSummary: "x", decision: "accepted", reason: null, storyId: null });
    insertResearchSearch(db, { runId: run.id, stage: "discovery", query: "test query", resultCount: 3 });

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

  it("round-trips a correction linking two story_events", () => {
    const run = startHourlyRun(db, false);
    const story = insertStory(db, { slug: "c", headline: "C", summary: "s", topicTags: ["politics"], importanceScore: 0, createdInRunId: run.id });
    const original = insertStoryEvent(db, { storyId: story.id, summary: "12 missing", eventTime: null, eventTimeConfidence: "unknown", articlePublishedAt: null, factLabel: "UNCONFIRMED", isCorrection: false, correctsEventId: null, discoveredInRunId: run.id });
    const corrected = insertStoryEvent(db, { storyId: story.id, summary: "3 missing", eventTime: null, eventTimeConfidence: "unknown", articlePublishedAt: null, factLabel: "FACT", isCorrection: true, correctsEventId: original.id, discoveredInRunId: run.id });

    const correction = insertCorrection(db, {
      originalStoryEventId: original.id,
      correctedStoryEventId: corrected.id,
      detectedInRunId: run.id,
      correctionPostId: null,
      explanation: "revised down",
    });
    expect(correction.original_story_event_id).toBe(original.id);
    expect(correction.corrected_story_event_id).toBe(corrected.id);
  });
});
