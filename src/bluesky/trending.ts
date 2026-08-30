import type { RunLogger } from "../utils/logger.js";
import { phraseToTag } from "../caption/hashtagExtraction.js";

export interface TrendingTopic {
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
 * (unspecced, unofficial) API. Per explicit direction this single fetch
 * feeds BOTH the day's hashtags (see trendingTopicsToTags below) AND the
 * art prompt's thematic material (see art/generateArt.ts), so what
 * inspired the art and what's tagged on the post always agree - even
 * though these topics are whatever is trending on Bluesky right now -
 * current events, memes, sports, politics - not history-related. That
 * mismatch is a deliberate, acknowledged tradeoff, not an oversight: the
 * goal is maximum discovery reach via genuinely popular tags/moods, not
 * strict historical relevance.
 *
 * This is an unofficial endpoint that can change shape or go down without
 * notice, so any failure here must never block publishing - callers must
 * treat an empty array as "no trending data available today" and fall
 * back to their own content-derived defaults.
 */
export async function fetchTrendingTopics(logger: RunLogger, limit = 12): Promise<TrendingTopic[]> {
  try {
    const res = await fetch(TRENDING_ENDPOINT, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as TrendingTopicsResponse;
    const topics = (data.topics ?? []).slice(0, limit);
    logger.info("bluesky", `Fetched ${topics.length} trending topic(s) from Bluesky`, {
      topics: topics.map((t) => t.displayName || t.topic),
    });
    return topics;
  } catch (err) {
    logger.warn("bluesky", "Failed to fetch Bluesky trending topics; continuing without them", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/** Converts already-fetched trending topics into bare tag-shaped tokens, highest-priority first. */
export function trendingTopicsToTags(topics: TrendingTopic[]): string[] {
  return topics.map((t) => phraseToTag(t.displayName || t.topic, 4)).filter((t): t is string => Boolean(t));
}
