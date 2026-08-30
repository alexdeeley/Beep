import type { AppConfig } from "../config/index.js";
import type { RunLogger } from "../utils/logger.js";
import { CARD_POST_MARKER } from "./generateCardCaption.js";

interface AuthorFeedImage {
  alt?: string;
}

interface AuthorFeedResponse {
  feed?: { post?: { record?: { embed?: { images?: AuthorFeedImage[] } } } }[];
}

/**
 * Idempotency safety net for the weekly card pipeline, mirroring
 * bluesky/publish.ts's isAlreadyPublishedOnBluesky but implemented
 * independently and matched on this pipeline's own marker (see
 * generateCardCaption.ts) rather than a human-formatted date string.
 * This is a deliberate duplication, not a shared helper: the daily
 * pipeline's alt text never contains "Card Draw" and this pipeline's alt
 * text never contains the daily pipeline's "<Month Day, Year>" format, so
 * the two checks can never cross-match each other's posts even though
 * both pipelines publish to the same Bluesky account. Best-effort and
 * read-only (public API, no auth) - on any failure this returns false
 * rather than blocking the run, same reasoning as the daily pipeline's
 * equivalent check.
 */
export async function isCardAlreadyPublishedOnBluesky(config: AppConfig, logger: RunLogger, isoDate: string): Promise<boolean> {
  const identifier = config.bluesky.identifier;
  if (!identifier) return false;

  try {
    const res = await fetch(
      `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(identifier)}&limit=20`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as AuthorFeedResponse;
    const alreadyPosted = (data.feed ?? []).some((item) =>
      (item.post?.record?.embed?.images ?? []).some((img) => img.alt?.includes(CARD_POST_MARKER) && img.alt?.includes(isoDate))
    );
    if (alreadyPosted) {
      logger.info("weekly-card", `Found an existing "${CARD_POST_MARKER}" post for ${isoDate}; treating this week as already published`);
    }
    return alreadyPosted;
  } catch (err) {
    logger.warn("weekly-card", "Failed to check Bluesky's own post history for idempotency; falling back to the local file check only", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
