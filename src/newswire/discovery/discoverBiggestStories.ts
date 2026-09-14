import { requestJsonWithWebSearch } from "../../utils/openaiClient.js";
import { insertRunCandidate } from "../db/researchRunsRepo.js";
import type { NewsRunContext } from "../runContext.js";
import type { BiggestStoryCandidate } from "../types.js";
import {
  buildBiggestStoriesDiscoverySystemPrompt,
  buildBiggestStoriesDiscoveryUserPrompt,
  BIGGEST_STORIES_DISCOVERY_JSON_SCHEMA,
} from "./biggestStoriesPrompts.js";

interface RawItem {
  headline: string;
  eventTimeIso: string | null;
  eventTimeConfidence: "exact" | "approximate" | "unknown";
  sources: { url: string; title: string; domain: string }[];
}

interface RawDiscoveryResult {
  items: RawItem[];
}

/**
 * One industry-wide web-search sweep for today's biggest, most significant music-industry stories of
 * any kind - only ever called once a day from postBiggestStoriesRecap.ts. Unlike discoverMusicNews.ts
 * (which deliberately excludes releases/tours/awards as "routine"), this sweep is broad by design: the
 * selection bar is significance, not category. Errors are caught and logged rather than thrown: a
 * hiccup here must never sink the rest of the cycle, it just means no recap today.
 */
export async function discoverBiggestStories(ctx: NewsRunContext): Promise<BiggestStoryCandidate[]> {
  ctx.logger.info("biggest-stories-discovery", "Starting daily TOP MUSIC STORIES discovery sweep");

  let result: RawDiscoveryResult;
  try {
    const response = await requestJsonWithWebSearch<RawDiscoveryResult>(ctx.openai, {
      model: ctx.config.news.discoveryModel,
      system: buildBiggestStoriesDiscoverySystemPrompt(),
      user: buildBiggestStoriesDiscoveryUserPrompt(ctx.now.toISOString()),
      jsonSchemaName: "biggest_stories_discovery_result",
      jsonSchema: BIGGEST_STORIES_DISCOVERY_JSON_SCHEMA,
      maxOutputTokens: 8192,
    });
    result = response.data;
    ctx.logger.info("biggest-stories-discovery", `Model performed ${response.searchCount} search(es)`, { queries: response.searchQueries });
  } catch (err) {
    ctx.logger.error("biggest-stories-discovery", "TOP MUSIC STORIES discovery request failed - no recap today", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const accepted: BiggestStoryCandidate[] = [];
  for (const item of result.items) {
    if (item.sources.length === 0) {
      insertRunCandidate(ctx.db, {
        runId: ctx.hourlyRunId,
        stage: "biggest-stories-discovery",
        candidateSummary: item.headline,
        decision: "rejected",
        reason: "no sources reported",
        storyId: null,
      });
      continue;
    }
    insertRunCandidate(ctx.db, {
      runId: ctx.hourlyRunId,
      stage: "biggest-stories-discovery",
      candidateSummary: item.headline,
      decision: "accepted",
      reason: null,
      storyId: null,
    });
    accepted.push(item);
  }

  ctx.logger.info("biggest-stories-discovery", `Discovered ${accepted.length} candidate(s) (${result.items.length - accepted.length} rejected)`);
  return accepted;
}
