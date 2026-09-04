import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openStoryDb, closeStoryDb } from "../../src/newswire/db/connection.js";
import { startHourlyRun } from "../../src/newswire/db/researchRunsRepo.js";
import { insertBlueskyPost } from "../../src/newswire/db/postsRepo.js";
import { contentHash, normalizePostText, duplicateCheckEdition } from "../../src/newswire/duplicateCheck/duplicateCheckEdition.js";
import type { NewsRunContext } from "../../src/newswire/runContext.js";

describe("contentHash / normalizePostText", () => {
  it("produces the same hash regardless of case or extra whitespace", () => {
    expect(contentHash("Hello   World.")).toBe(contentHash("hello world."));
    expect(normalizePostText("  Hello   World.  ")).toBe("hello world.");
  });

  it("produces different hashes for different text", () => {
    expect(contentHash("Post A")).not.toBe(contentHash("Post B"));
  });
});

describe("duplicateCheckEdition", () => {
  let dir: string;
  let db: Database.Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "newswire-dupecheck-test-"));
    db = openStoryDb(join(dir, "story.db"));
  });
  afterEach(() => {
    closeStoryDb(db);
    rmSync(dir, { recursive: true, force: true });
  });

  function makeCtx(): NewsRunContext {
    return {
      config: {} as NewsRunContext["config"],
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as NewsRunContext["logger"],
      db,
      openai: {} as NewsRunContext["openai"],
      spotifyToken: "test-token",
      editorialFocus: {} as NewsRunContext["editorialFocus"],
      hourlyRunId: 1,
      dryRun: false,
      now: new Date(),
    };
  }

  it("passes a null edition through as not-a-duplicate", () => {
    expect(duplicateCheckEdition(makeCtx(), null)).toEqual({ isDuplicate: false, reason: null });
  });

  it("passes a genuinely new edition as not-a-duplicate", () => {
    const result = duplicateCheckEdition(makeCtx(), { posts: [{ text: "Brand new post text.", sourceReleaseIds: [] }] });
    expect(result.isDuplicate).toBe(false);
  });

  it("blocks an edition containing text identical to something already published", () => {
    const run = startHourlyRun(db, false);
    insertBlueskyPost(db, {
      runId: run.id,
      threadPosition: 0,
      text: "Officials confirmed the deal Tuesday.",
      contentHash: contentHash("Officials confirmed the deal Tuesday."),
      uri: "at://x",
      cid: "y",
      rootUri: null,
      parentUri: null,
      dryRun: false,
    });

    const result = duplicateCheckEdition(makeCtx(), {
      posts: [{ text: "  officials CONFIRMED the deal   Tuesday.  ", sourceReleaseIds: [] }],
    });
    expect(result.isDuplicate).toBe(true);
    expect(result.reason).toContain("Identical text already published");
  });

  it("does not flag a match against a dry-run post (dry-run posts don't count as published)", () => {
    const run = startHourlyRun(db, true);
    insertBlueskyPost(db, {
      runId: run.id,
      threadPosition: 0,
      text: "A dry-run-only post.",
      contentHash: contentHash("A dry-run-only post."),
      uri: null,
      cid: null,
      rootUri: null,
      parentUri: null,
      dryRun: true,
    });

    const result = duplicateCheckEdition(makeCtx(), { posts: [{ text: "A dry-run-only post.", sourceReleaseIds: [] }] });
    expect(result.isDuplicate).toBe(false);
  });
});
