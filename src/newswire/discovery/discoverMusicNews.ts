import { requestJsonWithWebSearch } from "../../utils/openaiClient.js";
import { insertRunCandidate } from "../db/researchRunsRepo.js";
import type { NewsRunContext } from "../runContext.js";
import type { DramaticNewsCandidate } from "../types.js";
import { buildMusicNewsDiscoverySystemPrompt, buildMusicNewsDiscoveryUserPrompt, MUSIC_NEWS_DISCOVERY_JSON_SCHEMA } from "./musicNewsPrompts.js";

interface RawItem {
  artistName: string;
  headline: string;
  eventTimeIso: string | null;
  eventTimeConfidence: "exact" | "approximate" | "unknown";
  sources: { url: string; title: string; domain: string }[];
}

interface RawDiscoveryResult {
  items: RawItem[];
}

/**
 * One industry-wide web-search sweep for today's genuinely major, dramatic music news (arrest,
 * death, breakup, etc.) - only ever called once a day from postMusicNewsRecap.ts. Not scoped to
 * watched-artists.txt at this stage (11k+ names don't fit the prompt) - postMusicNewsRecap.ts
 * cross-checks each surviving candidate's artistName against the watchlist after verification.
 * Errors are caught and logged rather than thrown: a hiccup here must never sink the rest of the
 * cycle, it just means no MUSIC NEWS post today.
 */
export async function discoverMusicNews(ctx: NewsRunContext): Promise<DramaticNewsCandidate[]> {
  ctx.logger.info("music-news-discovery", "Starting daily MUSIC NEWS discovery sweep");

  let result: RawDiscoveryResult;
  try {
    const response = await requestJsonWithWebSearch<RawDiscoveryResult>(ctx.openai, {
      model: ctx.config.news.discoveryModel,
      system: buildMusicNewsDiscoverySystemPrompt(),
      user: buildMusicNewsDiscoveryUserPrompt(ctx.now.toISOString()),
      jsonSchemaName: "music_news_discovery_result",
      jsonSchema: MUSIC_NEWS_DISCOVERY_JSON_SCHEMA,
      maxOutputTokens: 8192,
    });
    result = response.data;
    ctx.logger.info("music-news-discovery", `Model performed ${response.searchCount} search(es)`, { queries: response.searchQueries });
  } catch (err) {
    ctx.logger.error("music-news-discovery", "MUSIC NEWS discovery request failed - no recap today", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const accepted: DramaticNewsCandidate[] = [];
  for (const item of result.items) {
    if (item.sources.length === 0) {
      insertRunCandidate(ctx.db, {
        runId: ctx.hourlyRunId,
        stage: "music-news-discovery",
        candidateSummary: `${item.artistName}: ${item.headline}`,
        decision: "rejected",
        reason: "no sources reported",
        storyId: null,
      });
      continue;
    }
    insertRunCandidate(ctx.db, {
      runId: ctx.hourlyRunId,
      stage: "music-news-discovery",
      candidateSummary: `${item.artistName}: ${item.headline}`,
      decision: "accepted",
      reason: null,
      storyId: null,
    });
    accepted.push(item);
  }

  ctx.logger.info("music-news-discovery", `Discovered ${accepted.length} candidate(s) (${result.items.length - accepted.length} rejected)`);
  return accepted;
}
