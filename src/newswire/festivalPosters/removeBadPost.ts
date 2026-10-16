import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunLogger } from "../../utils/logger.js";
import type { AppConfig } from "../../config/index.js";
import { downloadStoryDb, uploadStoryDb } from "../db/sync.js";
import { openStoryDb, closeStoryDb } from "../db/connection.js";
import { buildFestivalKey, deleteFestivalPosterPost } from "../db/festivalPostersRepo.js";
import { deleteBlueskyPostByUri } from "../db/postsRepo.js";
import { createBlueskySession } from "../../bluesky/threadPublish.js";
import { deleteAllPosts } from "../../bluesky/deleteAllPosts.js";

export interface RemoveBadPostInput {
  /** The post's at:// URI (e.g. from a feed listing or the live run's "Published: at://..." log line). */
  uri: string;
  /** The exact festivalName this pipeline recorded for the post, so the matching dedup row can be found - see db/festivalPostersRepo.ts's buildFestivalKey (normalized name + year). */
  festivalName: string;
  eventYear: number | null;
}

export interface RemoveBadPostResult {
  postDeleted: boolean;
  dedupRowDeleted: boolean;
  auditRowDeleted: boolean;
}

/**
 * Corrects a single wrongly-published post - the mechanical image extraction found SOME image that
 * cleared its heuristic bar, but a human looking at it afterward determined it isn't actually the real
 * poster (e.g. an unrelated press photo, a crowd shot). Deletes the live Bluesky post, removes its
 * db/postsRepo.ts audit row, and - critically - removes its db/festivalPostersRepo.ts dedup row too, so a
 * later cycle isn't permanently blocked from retrying that same festival/year with a better source. This
 * is a deliberate, manually-triggered correction (never run automatically): the extraction heuristic is
 * documented to sometimes need exactly this kind of human override.
 */
export async function removeBadPost(config: AppConfig, input: RemoveBadPostInput): Promise<RemoveBadPostResult> {
  const runDir = join(config.paths.runsDir, "news", `remove-bad-post-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const logger = new RunLogger(runDir);

  const session = await createBlueskySession(config);
  const deletedCount = await deleteAllPosts(config, logger, session, [{ uri: input.uri }]);
  const postDeleted = deletedCount > 0;

  const tempDir = mkdtempSync(join(tmpdir(), "newswire-db-"));
  const dbPath = join(tempDir, "story.db");
  const handle = await downloadStoryDb(config, logger, dbPath);
  const db = openStoryDb(dbPath);

  try {
    const key = buildFestivalKey(input.festivalName, input.eventYear);
    const dedupRowDeleted = deleteFestivalPosterPost(db, key);
    const auditRowDeleted = deleteBlueskyPostByUri(db, input.uri);
    logger.info("remove-bad-post", `${input.uri}: post ${postDeleted ? "deleted" : "NOT found"}, dedup row ${dedupRowDeleted ? "removed" : "not found"} (key "${key}"), audit row ${auditRowDeleted ? "removed" : "not found"}`);
    return { postDeleted, dedupRowDeleted, auditRowDeleted };
  } finally {
    closeStoryDb(db);
    await uploadStoryDb(handle, logger, dbPath);
  }
}
