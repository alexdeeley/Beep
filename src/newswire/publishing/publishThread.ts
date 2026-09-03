import { createBlueskySession, postThreadMessage, type PostRef } from "../../bluesky/threadPublish.js";
import { insertBlueskyPost } from "../db/postsRepo.js";
import { markEventPosted } from "../db/storiesRepo.js";
import type { NewsRunContext } from "../runContext.js";
import type { DraftEdition, PublishResult } from "../types.js";
import { contentHash } from "../duplicateCheck/duplicateCheckEdition.js";
import { splitIntoThread } from "./threadSplitter.js";

interface PhysicalPost {
  text: string;
  sourceEventIds: number[];
}

function toPhysicalPosts(edition: NonNullable<DraftEdition>): PhysicalPost[] {
  const physical: PhysicalPost[] = [];
  for (const draft of edition.posts) {
    const texts = splitIntoThread([{ text: draft.text }]);
    for (const text of texts) {
      physical.push({ text, sourceEventIds: draft.sourceEventIds });
    }
  }
  return physical;
}

/**
 * Publishes the final edition as a Bluesky thread, or - in dry-run mode,
 * or when the edition is null, or when Bluesky credentials aren't
 * configured - records nothing and posts nothing. Each post is persisted
 * to bluesky_posts immediately after it succeeds (not batched at the
 * end), so a mid-thread failure leaves an accurate record: whatever
 * posted stays posted and marked, and the loop simply stops rather than
 * retrying in a way that could double-post the successful prefix.
 */
export async function publishThread(ctx: NewsRunContext, edition: DraftEdition): Promise<PublishResult> {
  if (edition === null || edition.posts.length === 0) {
    return { posts: [], dryRun: ctx.dryRun };
  }

  const physicalPosts = toPhysicalPosts(edition);

  if (ctx.dryRun) {
    ctx.logger.info("publish", `Dry run: would publish a ${physicalPosts.length}-post thread`, {
      posts: physicalPosts.map((p) => p.text),
    });
    for (const [i, post] of physicalPosts.entries()) {
      insertBlueskyPost(ctx.db, {
        runId: ctx.hourlyRunId,
        threadPosition: i,
        text: post.text,
        contentHash: contentHash(post.text),
        uri: null,
        cid: null,
        rootUri: null,
        parentUri: null,
        dryRun: true,
      });
    }
    return { posts: physicalPosts.map((p) => ({ text: p.text, uri: "", cid: "" })), dryRun: true };
  }

  if (!ctx.config.bluesky.identifier || !ctx.config.bluesky.appPassword) {
    ctx.logger.warn("publish", "BLUESKY_IDENTIFIER / BLUESKY_APP_PASSWORD not configured; skipping publish");
    return { posts: [], dryRun: false };
  }

  const session = await createBlueskySession(ctx.config);
  const published: { text: string; uri: string; cid: string }[] = [];
  let root: PostRef | null = null;
  let parent: PostRef | null = null;

  for (const [i, post] of physicalPosts.entries()) {
    try {
      const ref = await postThreadMessage(ctx.config, ctx.logger, session, {
        text: post.text,
        reply: root && parent ? { root, parent } : null,
      });
      root = root ?? ref;
      parent = ref;

      insertBlueskyPost(ctx.db, {
        runId: ctx.hourlyRunId,
        threadPosition: i,
        text: post.text,
        contentHash: contentHash(post.text),
        uri: ref.uri,
        cid: ref.cid,
        rootUri: root.uri,
        parentUri: parent.uri,
        dryRun: false,
      });
      for (const eventId of post.sourceEventIds) markEventPosted(ctx.db, eventId, ctx.hourlyRunId);

      published.push({ text: post.text, uri: ref.uri, cid: ref.cid });
      ctx.logger.info("publish", `Published post ${i + 1}/${physicalPosts.length}: ${ref.uri}`);
    } catch (err) {
      ctx.logger.error("publish", `Thread publish stopped at post ${i + 1}/${physicalPosts.length} after a failure`, {
        error: err instanceof Error ? err.message : String(err),
      });
      break;
    }
  }

  return { posts: published, dryRun: false };
}
