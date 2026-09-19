import { requestJsonWithWebSearch } from "../../utils/openaiClient.js";
import { insertRunCandidate } from "../db/researchRunsRepo.js";
import type { NewsRunContext } from "../runContext.js";
import type { FestivalPosterCandidate } from "../types.js";
import {
  buildFestivalPostersDiscoverySystemPrompt,
  buildFestivalPostersDiscoveryUserPrompt,
  FESTIVAL_POSTERS_DISCOVERY_JSON_SCHEMA,
} from "./festivalPostersPrompts.js";

interface RawItem {
  festivalName: string;
  eventYear: number | null;
  headline: string;
  eventTimeIso: string | null;
  eventTimeConfidence: "exact" | "approximate" | "unknown";
  sources: { url: string; title: string; domain: string }[];
}

interface RawDiscoveryResult {
  items: RawItem[];
}

/**
 * One industry-wide web-search sweep for major festivals that have just announced their lineup/poster -
 * only ever called from postFestivalPosters.ts. "Major" is judged by the model itself (see
 * festivalPostersPrompts.ts's high bar and calibration examples), not restricted to any fixed list.
 * Errors are caught and logged rather than thrown: a hiccup here must never sink the rest of the cycle,
 * it just means no festival posters found this cycle.
 */
export async function discoverFestivalPosters(ctx: NewsRunContext): Promise<FestivalPosterCandidate[]> {
  ctx.logger.info("festival-posters-discovery", "Starting daily FESTIVAL LINEUP discovery sweep");

  let result: RawDiscoveryResult;
  try {
    const response = await requestJsonWithWebSearch<RawDiscoveryResult>(ctx.openai, {
      model: ctx.config.news.discoveryModel,
      system: buildFestivalPostersDiscoverySystemPrompt(),
      user: buildFestivalPostersDiscoveryUserPrompt(ctx.now.toISOString()),
      jsonSchemaName: "festival_posters_discovery_result",
      jsonSchema: FESTIVAL_POSTERS_DISCOVERY_JSON_SCHEMA,
      maxOutputTokens: 8192,
    });
    result = response.data;
    ctx.logger.info("festival-posters-discovery", `Model performed ${response.searchCount} search(es)`, { queries: response.searchQueries });
  } catch (err) {
    ctx.logger.error("festival-posters-discovery", "FESTIVAL LINEUP discovery request failed - none found this cycle", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const accepted: FestivalPosterCandidate[] = [];
  for (const item of result.items) {
    if (item.sources.length === 0) {
      insertRunCandidate(ctx.db, {
        runId: ctx.hourlyRunId,
        stage: "festival-posters-discovery",
        candidateSummary: `${item.festivalName}: ${item.headline}`,
        decision: "rejected",
        reason: "no sources reported",
        storyId: null,
      });
      continue;
    }
    insertRunCandidate(ctx.db, {
      runId: ctx.hourlyRunId,
      stage: "festival-posters-discovery",
      candidateSummary: `${item.festivalName}: ${item.headline}`,
      decision: "accepted",
      reason: null,
      storyId: null,
    });
    accepted.push(item);
  }

  ctx.logger.info("festival-posters-discovery", `Discovered ${accepted.length} candidate(s) (${result.items.length - accepted.length} rejected)`);
  return accepted;
}
