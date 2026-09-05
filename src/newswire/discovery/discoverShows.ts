import { requestJsonWithWebSearch } from "../../utils/openaiClient.js";
import { insertRunCandidate } from "../db/researchRunsRepo.js";
import type { NewsRunContext } from "../runContext.js";
import type { ShowCandidate } from "../types.js";
import { buildShowsDiscoverySystemPrompt, buildShowsDiscoveryUserPrompt, SHOWS_DISCOVERY_JSON_SCHEMA } from "./showsPrompts.js";

interface RawShow {
  artistName: string;
  venueName: string | null;
  eventDateIso: string | null;
  eventDateConfidence: "exact" | "approximate" | "unknown";
  sources: { url: string; title: string; domain: string }[];
}

interface RawDiscoveryResult {
  shows: RawShow[];
}

/**
 * One web-search sweep for upcoming Portland/Pacific-Northwest shows in
 * a given date window - only ever called from postWeeklyShows.ts on the
 * weekly SHOWS cycle. Errors are caught and logged rather than thrown: a
 * hiccup here must never sink the rest of the cycle, it just means no
 * SHOWS post this week.
 */
export async function discoverShows(ctx: NewsRunContext, startIso: string, endIso: string): Promise<ShowCandidate[]> {
  ctx.logger.info("shows-discovery", `Starting regional-shows discovery sweep for ${startIso} to ${endIso}`);

  let result: RawDiscoveryResult;
  try {
    const response = await requestJsonWithWebSearch<RawDiscoveryResult>(ctx.openai, {
      model: ctx.config.news.discoveryModel,
      system: buildShowsDiscoverySystemPrompt(),
      user: buildShowsDiscoveryUserPrompt(startIso, endIso, ctx.now.toISOString()),
      jsonSchemaName: "shows_discovery_result",
      jsonSchema: SHOWS_DISCOVERY_JSON_SCHEMA,
      maxOutputTokens: 8192,
    });
    result = response.data;
    ctx.logger.info("shows-discovery", `Model performed ${response.searchCount} search(es)`, { queries: response.searchQueries });
  } catch (err) {
    ctx.logger.error("shows-discovery", "Regional-shows discovery request failed - no SHOWS post this week", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const accepted: ShowCandidate[] = [];
  for (const show of result.shows) {
    if (show.sources.length === 0 || !show.eventDateIso) {
      insertRunCandidate(ctx.db, {
        runId: ctx.hourlyRunId,
        stage: "shows-discovery",
        candidateSummary: `${show.artistName} @ ${show.venueName ?? "unknown venue"}`,
        decision: "rejected",
        reason: "no sources reported, or no confirmed date",
        storyId: null,
      });
      continue;
    }
    insertRunCandidate(ctx.db, {
      runId: ctx.hourlyRunId,
      stage: "shows-discovery",
      candidateSummary: `${show.artistName} @ ${show.venueName ?? "unknown venue"} on ${show.eventDateIso}`,
      decision: "accepted",
      reason: null,
      storyId: null,
    });
    accepted.push(show);
  }

  ctx.logger.info("shows-discovery", `Discovered ${accepted.length} show(s) (${result.shows.length - accepted.length} rejected)`);
  return accepted;
}
