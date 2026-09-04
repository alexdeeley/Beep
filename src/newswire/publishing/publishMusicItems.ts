import { createBlueskySession, postThreadMessage, type PostRef } from "../../bluesky/threadPublish.js";
import { insertBlueskyPost } from "../db/postsRepo.js";
import { markMusicItemPosted } from "../db/musicItemsRepo.js";
import type { NewsRunContext } from "../runContext.js";
import type { DraftEdition, PublishResult } from "../types.js";
import { contentHash } from "../duplicateCheck/duplicateCheckEdition.js";
import { splitIntoThread } from "./threadSplitter.js";

interface PhysicalItem {
  itemIds: number[];
  /** Grapheme-safe physical posts for this one item - usually length 1, occasionally a short reply-chain if the announcement ran long. Never mixed with another item's posts. */
  texts: string[];
}

function toPhysicalItems(edition: NonNullable<DraftEdition>): PhysicalItem[] {
  return edition.posts.map((draft) => ({
    itemIds: draft.sourceItemIds,
    texts: splitIntoThread([{ text: draft.text }]),
  }));
}

/**
 * Publishes each music item in the edition as its OWN independent post
 * (or short reply-chain, if a single announcement needed splitting) -
 * never threaded together with another item, since unrelated artists'
 * news sharing one reply chain would read as a non-sequitur. Each
 * physical post is persisted to bluesky_posts immediately after it
 * succeeds, so a failure partway through the edition leaves an accurate
 * record of what actually went out, and whatever didn't post stays
 * queued for the next cycle to reconsider.
 */
export async function publishMusicItems(ctx: NewsRunContext, edition: DraftEdition): Promise<PublishResult> {
  if (edition === null || edition.posts.length === 0) {
    return { posts: [], dryRun: ctx.dryRun };
  }

  const items = toPhysicalItems(edition);

  if (ctx.dryRun) {
    const allTexts = items.flatMap((i) => i.texts);
    ctx.logger.info("publish", `Dry run: would publish ${items.length} item(s), ${allTexts.length} post(s) total`, {
      posts: allTexts,
    });
    let position = 0;
    for (const item of items) {
      for (const text of item.texts) {
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
    }
    return { posts: allTexts.map((text) => ({ text, uri: "", cid: "" })), dryRun: true };
  }

  if (!ctx.config.bluesky.identifier || !ctx.config.bluesky.appPassword) {
    ctx.logger.warn("publish", "BLUESKY_IDENTIFIER / BLUESKY_APP_PASSWORD not configured; skipping publish");
    return { posts: [], dryRun: false };
  }

  const session = await createBlueskySession(ctx.config);
  const published: { text: string; uri: string; cid: string }[] = [];
  let position = 0;

  for (const item of items) {
    let root: PostRef | null = null;
    let parent: PostRef | null = null;
    let itemPublishedAny = false;

    for (const text of item.texts) {
      try {
        const ref = await postThreadMessage(ctx.config, ctx.logger, session, {
          text,
          reply: root && parent ? { root, parent } : null,
        });
        root = root ?? ref;
        parent = ref;
        itemPublishedAny = true;

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

        published.push({ text, uri: ref.uri, cid: ref.cid });
        ctx.logger.info("publish", `Published: ${ref.uri}`);
      } catch (err) {
        ctx.logger.error("publish", "Post failed - stopping this item's thread, continuing with the next item", {
          error: err instanceof Error ? err.message : String(err),
        });
        break;
      }
    }

    if (itemPublishedAny) {
      for (const itemId of item.itemIds) markMusicItemPosted(ctx.db, itemId, ctx.hourlyRunId);
    }
  }

  return { posts: published, dryRun: false };
}
