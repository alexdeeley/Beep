import { createHash } from "node:crypto";
import { findPostByContentHash } from "../db/postsRepo.js";
import type { NewsRunContext } from "../runContext.js";
import type { DraftEdition, DuplicateCheckResult } from "../types.js";

/** Normalizes text before hashing so trivial whitespace differences don't defeat the exact-repost guard. */
export function normalizePostText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function contentHash(text: string): string {
  return createHash("sha256").update(normalizePostText(text)).digest("hex");
}

/**
 * The exact-repost guard: DB-backed, content-hash based, checking whether
 * any post in this edition is byte-for-byte (modulo whitespace/case) the
 * same as something already published. This is deliberately NOT where
 * the real "is this genuinely new information" judgment happens - that
 * semantic test already ran upstream, in story-memory's dedup test and
 * in the writer only being given genuinely-new events to work from. This
 * stage exists purely to catch the narrow, mechanical failure mode of
 * literally re-posting identical text (e.g. after a retry).
 */
export function duplicateCheckEdition(ctx: NewsRunContext, edition: DraftEdition): DuplicateCheckResult {
  if (edition === null) return { isDuplicate: false, reason: null };

  for (const post of edition.posts) {
    const hash = contentHash(post.text);
    const existing = findPostByContentHash(ctx.db, hash);
    if (existing) {
      ctx.logger.warn("duplicate-check", "Edition contains a post identical to one already published - blocking publish", {
        text: post.text.slice(0, 120),
        existingPostId: existing.id,
      });
      return { isDuplicate: true, reason: `Identical text already published as post ${existing.id} (run ${existing.run_id})` };
    }
  }

  return { isDuplicate: false, reason: null };
}
