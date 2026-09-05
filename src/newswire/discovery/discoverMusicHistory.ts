import type { DateTime } from "luxon";
import { requestJsonWithWebSearch } from "../../utils/openaiClient.js";
import { insertRunCandidate } from "../db/researchRunsRepo.js";
import type { NewsRunContext } from "../runContext.js";
import type { HistoryFactCandidate } from "../types.js";
import { buildMusicHistorySystemPrompt, buildMusicHistoryUserPrompt, MUSIC_HISTORY_DISCOVERY_JSON_SCHEMA } from "./musicHistoryPrompts.js";

interface RawCandidate {
  year: number;
  eventDescription: string;
  sources: { url: string; title: string; domain: string }[];
}

interface RawDiscoveryResult {
  candidates: RawCandidate[];
}

/**
 * One web-search sweep for "on this day in music history" events for
 * today's calendar date (any year) - only ever called from
 * postMusicHistory.ts, once a day. Errors are caught and logged rather
 * than thrown: a hiccup here must never sink the rest of the cycle, it
 * just means no TODAY IN HISTORY post today (a later cycle the same day
 * will retry, since no idempotency marker gets recorded on failure).
 */
export async function discoverMusicHistory(ctx: NewsRunContext, dt: DateTime): Promise<HistoryFactCandidate[]> {
  const monthDay = dt.toFormat("MMMM d");
  ctx.logger.info("history-discovery", `Starting music-history discovery sweep for ${monthDay}`);

  let result: RawDiscoveryResult;
  try {
    const response = await requestJsonWithWebSearch<RawDiscoveryResult>(ctx.openai, {
      model: ctx.config.news.discoveryModel,
      system: buildMusicHistorySystemPrompt(),
      user: buildMusicHistoryUserPrompt(monthDay, ctx.now.toISOString()),
      jsonSchemaName: "music_history_discovery_result",
      jsonSchema: MUSIC_HISTORY_DISCOVERY_JSON_SCHEMA,
      maxOutputTokens: 4096,
    });
    result = response.data;
    ctx.logger.info("history-discovery", `Model performed ${response.searchCount} search(es)`, { queries: response.searchQueries });
  } catch (err) {
    ctx.logger.error("history-discovery", "Music-history discovery request failed - no TODAY IN HISTORY post this cycle", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const accepted: HistoryFactCandidate[] = [];
  for (const candidate of result.candidates) {
    if (candidate.sources.length === 0) {
      insertRunCandidate(ctx.db, {
        runId: ctx.hourlyRunId,
        stage: "history-discovery",
        candidateSummary: `${candidate.year}: ${candidate.eventDescription}`,
        decision: "rejected",
        reason: "no sources reported",
        storyId: null,
      });
      continue;
    }
    insertRunCandidate(ctx.db, {
      runId: ctx.hourlyRunId,
      stage: "history-discovery",
      candidateSummary: `${candidate.year}: ${candidate.eventDescription}`,
      decision: "accepted",
      reason: null,
      storyId: null,
    });
    accepted.push(candidate);
  }

  ctx.logger.info(
    "history-discovery",
    `Discovered ${accepted.length} music-history candidate(s) (${result.candidates.length - accepted.length} rejected)`
  );
  return accepted;
}
