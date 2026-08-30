import type { RunLogger } from "../utils/logger.js";
import { phraseToTag } from "../caption/hashtagExtraction.js";

interface TrendingTopic {
  topic: string;
  displayName: string;
  description: string;
  link: string;
}

interface TrendingTopicsResponse {
  topics?: TrendingTopic[];
  suggested?: TrendingTopic[];
}

const TRENDING_ENDPOINT = "https://public.api.bsky.app/xrpc/app.bsky.unspecced.getTrendingTopics";

/**
 * Fetches Bluesky's current platform-wide trending topics via its public
 * (unspecced, unofficial) API and converts each into a bare tag-shaped
 * token. Per explicit direction, this is used as the PRIMARY hashtag
 * source (ahead of the day's content-derived tags) even though these
 * topics are whatever is trending on Bluesky right now - current events,
 * memes, sports, politics - not history-related. That mismatch is a
 * deliberate, acknowledged tradeoff, not an oversight: the goal is
 * maximum discovery reach via genuinely popular tags, not thematic
 * relevance.
 *
 * This is an unofficial endpoint that can change shape or go down without
 * notice, so any failure here must never block publishing - the caller
 * falls back to the content-derived/evergreen tag pools when this
 * returns an empty array.
 */
export async function fetchTrendingTags(logger: RunLogger, limit = 12): Promise<string[]> {
  try {
    const res = await fetch(TRENDING_ENDPOINT, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as TrendingTopicsResponse;
    const tags = (data.topics ?? [])
      .slice(0, limit)
      .map((t) => phraseToTag(t.displayName || t.topic, 4))
      .filter((t): t is string => Boolean(t));
    logger.info("bluesky", `Fetched ${tags.length} trending tag(s) from Bluesky`, { tags });
    return tags;
  } catch (err) {
    logger.warn("bluesky", "Failed to fetch Bluesky trending topics; continuing without them", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
