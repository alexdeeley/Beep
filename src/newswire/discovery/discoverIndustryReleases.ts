import { requestJsonWithWebSearch } from "../../utils/openaiClient.js";
import { insertRunCandidate } from "../db/researchRunsRepo.js";
import { hasSimilarIndustryItem } from "../db/industryReleaseItemsRepo.js";
import type { NewsRunContext } from "../runContext.js";
import type { IndustryReleaseCandidate, ReleaseFormat } from "../types.js";
import {
  buildIndustryDiscoverySystemPrompt,
  buildIndustryDiscoveryUserPrompt,
  INDUSTRY_DISCOVERY_JSON_SCHEMA,
} from "./industryReleasePrompts.js";

interface RawCandidate {
  artistName: string;
  /** The schema allows "single" too, honestly reported, so the model never has to mislabel a single as an album/EP just to report it - see the reject-on-single check below. */
  releaseFormat: ReleaseFormat;
  headline: string;
  summary: string;
  eventTimeIso: string | null;
  eventTimeConfidence: "exact" | "approximate" | "unknown";
  sources: { url: string; title: string; domain: string }[];
}

interface RawDiscoveryResult {
  candidates: RawCandidate[];
}

/**
 * One web-search sweep for major album/EP/compilation releases across the
 * whole music industry, independent of watched-artists.txt - only ever
 * called from postWeeklyRoundup.ts on Fridays. Errors are caught and
 * logged rather than thrown: this is a supplementary feed for the
 * roundup, and a hiccup here must never sink the rest of the hourly
 * cycle (the roundup falls back to watchlist-only albums, and the
 * per-artist hourly flow continues normally either way).
 */
export async function discoverIndustryReleases(ctx: NewsRunContext): Promise<IndustryReleaseCandidate[]> {
  ctx.logger.info("industry-discovery", "Starting industry-wide major-release discovery sweep for the Friday roundup");

  let result: RawDiscoveryResult;
  try {
    const response = await requestJsonWithWebSearch<RawDiscoveryResult>(ctx.openai, {
      model: ctx.config.news.discoveryModel,
      system: buildIndustryDiscoverySystemPrompt(),
      user: buildIndustryDiscoveryUserPrompt(ctx.now.toISOString()),
      jsonSchemaName: "industry_discovery_result",
      jsonSchema: INDUSTRY_DISCOVERY_JSON_SCHEMA,
      maxOutputTokens: 8192,
    });
    result = response.data;
    ctx.logger.info("industry-discovery", `Model performed ${response.searchCount} search(es)`, { queries: response.searchQueries });
  } catch (err) {
    ctx.logger.error("industry-discovery", "Industry-wide discovery request failed - roundup will fall back to watchlist albums only", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const accepted: IndustryReleaseCandidate[] = [];
  for (const candidate of result.candidates) {
    if (candidate.releaseFormat === "single") {
      insertRunCandidate(ctx.db, {
        runId: ctx.hourlyRunId,
        stage: "industry-discovery",
        candidateSummary: candidate.headline,
        decision: "rejected",
        reason: "singles are excluded from the WEEKLY NEW RELEASES roundup - only album/EP/compilation releases belong here",
        storyId: null,
      });
      continue;
    }
    if (candidate.sources.length === 0) {
      insertRunCandidate(ctx.db, {
        runId: ctx.hourlyRunId,
        stage: "industry-discovery",
        candidateSummary: candidate.headline,
        decision: "rejected",
        reason: "no sources reported",
        storyId: null,
      });
      continue;
    }
    if (hasSimilarIndustryItem(ctx.db, candidate.artistName, candidate.headline)) {
      insertRunCandidate(ctx.db, {
        runId: ctx.hourlyRunId,
        stage: "industry-discovery",
        candidateSummary: candidate.headline,
        decision: "rejected",
        reason: "an effectively identical item is already on record for this artist",
        storyId: null,
      });
      continue;
    }

    insertRunCandidate(ctx.db, {
      runId: ctx.hourlyRunId,
      stage: "industry-discovery",
      candidateSummary: candidate.headline,
      decision: "accepted",
      reason: null,
      storyId: null,
    });
    // releaseFormat is narrowed to album/ep/compilation here - "single" was rejected above.
    accepted.push({ ...candidate, releaseFormat: candidate.releaseFormat as "album" | "ep" | "compilation" });
  }

  ctx.logger.info(
    "industry-discovery",
    `Discovered ${accepted.length} industry-wide candidate(s) (${result.candidates.length - accepted.length} rejected)`
  );
  return accepted;
}
