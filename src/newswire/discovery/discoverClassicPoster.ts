import { requestJsonWithWebSearch } from "../../utils/openaiClient.js";
import { insertRunCandidate } from "../db/researchRunsRepo.js";
import type { NewsRunContext } from "../runContext.js";
import type { ClassicPosterCandidate } from "../types.js";
import {
  buildClassicPosterDiscoverySystemPrompt,
  buildClassicPosterDiscoveryUserPrompt,
  CLASSIC_POSTER_DISCOVERY_JSON_SCHEMA,
} from "./classicPosterPrompts.js";

interface RawDiscoveryResult {
  item: ClassicPosterCandidate | null;
}

/**
 * One daily web-search sweep for a single real, famous piece of music graphic design, chosen for color/
 * typography/simplicity rather than news value - only ever called from postClassicPoster.ts.
 * `alreadyFeatured` is a short list of "name year" strings pulled from recent classic-poster posts
 * (db/festivalPostersRepo.ts's getRecentClassicPosters), passed so the model doesn't immediately repeat
 * itself; the real dedup guarantee still comes from the DB check in postClassicPoster.ts, not from the
 * model remembering. Errors are caught and logged rather than thrown: a hiccup here must never sink the
 * cycle, it just means no classic poster found today.
 */
export async function discoverClassicPoster(ctx: NewsRunContext, alreadyFeatured: string[]): Promise<ClassicPosterCandidate | null> {
  ctx.logger.info("classic-poster-discovery", "Starting Classic Poster discovery sweep");

  let result: RawDiscoveryResult;
  try {
    const response = await requestJsonWithWebSearch<RawDiscoveryResult>(ctx.openai, {
      model: ctx.config.news.discoveryModel,
      system: buildClassicPosterDiscoverySystemPrompt(alreadyFeatured),
      user: buildClassicPosterDiscoveryUserPrompt(ctx.now.toISOString()),
      jsonSchemaName: "classic_poster_discovery_result",
      jsonSchema: CLASSIC_POSTER_DISCOVERY_JSON_SCHEMA,
      maxOutputTokens: 4096,
    });
    result = response.data;
    ctx.logger.info("classic-poster-discovery", `Model performed ${response.searchCount} search(es)`, { queries: response.searchQueries });
  } catch (err) {
    ctx.logger.error("classic-poster-discovery", "Classic poster discovery request failed - none found today", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  if (!result.item || result.item.sources.length === 0) {
    insertRunCandidate(ctx.db, {
      runId: ctx.hourlyRunId,
      stage: "classic-poster-discovery",
      candidateSummary: result.item ? `${result.item.festivalName} ${result.item.eventYear}` : "(none)",
      decision: "rejected",
      reason: result.item ? "no sources reported" : "model returned no candidate",
      storyId: null,
    });
    return null;
  }

  insertRunCandidate(ctx.db, {
    runId: ctx.hourlyRunId,
    stage: "classic-poster-discovery",
    candidateSummary: `${result.item.festivalName} ${result.item.eventYear}: ${result.item.whyNotable}`,
    decision: "accepted",
    reason: null,
    storyId: null,
  });

  return result.item;
}
