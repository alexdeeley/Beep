import { createBlueskySession, postThreadMessage, type PostRef } from "../../bluesky/threadPublish.js";
import { insertBlueskyPost } from "../db/postsRepo.js";
import { contentHash } from "../duplicateCheck/duplicateCheckEdition.js";
import type { NewsRunContext } from "../runContext.js";

/**
 * Publishes (or, in dry-run, records) a pre-built list of physical post
 * texts as one reply-chain thread. Shared by postWeeklyRoundup.ts and
 * postMusicHistory.ts, which both build a single mechanical multi-post
 * thread directly from already-verified facts - no writer/copy-edit/
 * fact-check needed, since there's no new model prose to check. Returns
 * whether anything actually went out, so the caller can decide whether to
 * record its own once-a-day idempotency marker.
 */
export async function publishStandalonePostThread(ctx: NewsRunContext, tag: string, posts: string[]): Promise<boolean> {
  if (ctx.dryRun) {
    ctx.logger.info(tag, `Dry run: would publish ${posts.length} post(s)`, { posts });
    let position = 0;
    for (const text of posts) {
      insertBlueskyPost(ctx.db, {
        runId: ctx.hourlyRunId,
        threadPosition: position++,
        text,
        contentHash: contentHash(text),
        uri: null,
        cid: null,
        rootUri: null,
        parentUri: null,
        dryRun: true,
      });
    }
    return true;
  }

  if (!ctx.config.bluesky.identifier || !ctx.config.bluesky.appPassword) {
    ctx.logger.warn(tag, "BLUESKY_IDENTIFIER / BLUESKY_APP_PASSWORD not configured; skipping");
    return false;
  }

  const session = await createBlueskySession(ctx.config);
  let root: PostRef | null = null;
  let parent: PostRef | null = null;
  let position = 0;
  let publishedAny = false;

  for (const text of posts) {
    try {
      const ref = await postThreadMessage(ctx.config, ctx.logger, session, {
        text,
        reply: root && parent ? { root, parent } : null,
      });
      root = root ?? ref;
      parent = ref;
      publishedAny = true;

      insertBlueskyPost(ctx.db, {
        runId: ctx.hourlyRunId,
        threadPosition: position++,
        text,
        contentHash: contentHash(text),
        uri: ref.uri,
        cid: ref.cid,
        rootUri: root.uri,
        parentUri: parent.uri,
        dryRun: false,
      });
      ctx.logger.info(tag, `Published: ${ref.uri}`);
    } catch (err) {
      ctx.logger.error(tag, "Thread stopped partway through after a failure", {
        error: err instanceof Error ? err.message : String(err),
      });
      break;
    }
  }

  return publishedAny;
}
