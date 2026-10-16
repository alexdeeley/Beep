import type { AppConfig } from "../config/index.js";
import type { RunLogger } from "../utils/logger.js";
import { loadOrRefreshThreadsToken } from "./threadsAuth.js";
import { uploadImageForThreads, postImageToThreads } from "./threadsPublish.js";

const TAG = "threads";

/**
 * Cross-posts the same image-only poster this run already (or is about to) post to Bluesky, onto
 * Threads. Deliberately isolated from the Bluesky posting path - every call site fires this
 * AFTER its own Bluesky publish succeeds, and it NEVER throws, so a Threads outage, a missing/expired
 * token, or incomplete config can never block, delay, or roll back the Bluesky post, which remains
 * this pipeline's primary, fully-independent posting target. A no-op (not even a log line beyond
 * debug-level silence) when Threads simply isn't configured at all (no THREADS_USER_ID), so accounts
 * that never set this up see no change in behavior.
 */
export async function postToThreadsIfConfigured(
  config: AppConfig,
  logger: RunLogger,
  opts: { imageBytes: Buffer; mimeType: string; altText: string }
): Promise<void> {
  if (!config.threads.userId) return;

  try {
    const accessToken = await loadOrRefreshThreadsToken(config, logger);
    if (!accessToken) return; // already logged inside loadOrRefreshThreadsToken

    const imageUrl = await uploadImageForThreads(config, logger, opts.imageBytes, opts.mimeType);
    if (!imageUrl) {
      logger.warn(TAG, "Could not host image for Threads (storage not configured) - skipping Threads cross-post");
      return;
    }

    const postId = await postImageToThreads(config, accessToken, { imageUrl, altText: opts.altText });
    logger.info(TAG, `Cross-posted to Threads: ${postId}`);
  } catch (err) {
    logger.warn(TAG, `Threads cross-post failed (Bluesky post is unaffected): ${err instanceof Error ? err.message : String(err)}`);
  }
}
