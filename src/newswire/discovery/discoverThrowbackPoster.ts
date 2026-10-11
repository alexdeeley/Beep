import { requestJsonWithWebSearch } from "../../utils/openaiClient.js";
import { insertRunCandidate } from "../db/researchRunsRepo.js";
import type { NewsRunContext } from "../runContext.js";
import type { ThrowbackPosterCandidate } from "../types.js";
import {
  buildThrowbackPosterDiscoverySystemPrompt,
  buildThrowbackPosterDiscoveryUserPrompt,
  THROWBACK_POSTER_DISCOVERY_JSON_SCHEMA,
} from "./throwbackPosterPrompts.js";

interface RawDiscoveryResult {
  item: ThrowbackPosterCandidate | null;
}

/**
 * One weekly web-search sweep for a single real, historically notable festival poster from any past
 * year - only ever called from postThrowbackPoster.ts. `alreadyFeatured` is a short list of
 * "festival year" strings pulled from recent throwback posts (db/festivalPostersRepo.ts's
 * getRecentThrowbackPosts), passed so the model doesn't immediately repeat itself; the real dedup
 * guarantee still comes from the DB check in postThrowbackPoster.ts, not from the model remembering.
 * Errors are caught and logged rather than thrown: a hiccup here must never sink the cycle, it just means
 * no throwback found this week.
 */
export async function discoverThrowbackPoster(ctx: NewsRunContext, alreadyFeatured: string[]): Promise<ThrowbackPosterCandidate | null> {
  ctx.logger.info("throwback-poster-discovery", "Starting Throwback Thursday discovery sweep");

  let result: RawDiscoveryResult;
  try {
    const response = await requestJsonWithWebSearch<RawDiscoveryResult>(ctx.openai, {
      model: ctx.config.news.discoveryModel,
      system: buildThrowbackPosterDiscoverySystemPrompt(alreadyFeatured),
      user: buildThrowbackPosterDiscoveryUserPrompt(ctx.now.toISOString()),
      jsonSchemaName: "throwback_poster_discovery_result",
      jsonSchema: THROWBACK_POSTER_DISCOVERY_JSON_SCHEMA,
      maxOutputTokens: 4096,
    });
    result = response.data;
    ctx.logger.info("throwback-poster-discovery", `Model performed ${response.searchCount} search(es)`, { queries: response.searchQueries });
  } catch (err) {
    ctx.logger.error("throwback-poster-discovery", "Throwback discovery request failed - none found this week", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  if (!result.item || result.item.sources.length === 0) {
    insertRunCandidate(ctx.db, {
      runId: ctx.hourlyRunId,
      stage: "throwback-poster-discovery",
      candidateSummary: result.item ? `${result.item.festivalName} ${result.item.eventYear}` : "(none)",
      decision: "rejected",
      reason: result.item ? "no sources reported" : "model returned no candidate",
      storyId: null,
    });
    return null;
  }

  insertRunCandidate(ctx.db, {
    runId: ctx.hourlyRunId,
    stage: "throwback-poster-discovery",
    candidateSummary: `${result.item.festivalName} ${result.item.eventYear}: ${result.item.whyNotable}`,
    decision: "accepted",
    reason: null,
    storyId: null,
  });

  return result.item;
}
