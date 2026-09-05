import { insertRunCandidate } from "../db/researchRunsRepo.js";
import { requestJsonWithWebSearch } from "../../utils/openaiClient.js";
import type { NewsRunContext } from "../runContext.js";
import type { ShowCandidate, VerifiedFact, VerifiedShow } from "../types.js";
import { buildShowsVerificationSystemPrompt, showsVerificationJsonSchema } from "./showsVerificationPrompts.js";

interface RawVerificationResult {
  confirmedVenue: string | null;
  facts: VerifiedFact[];
}

const MAX_CANDIDATES_TO_VERIFY = 20;

function buildShowVerificationUserPrompt(artistName: string, venueName: string | null, eventDateIso: string, nowIso: string): string {
  const venue = venueName ? ` at ${venueName}` : "";
  return [
    `Current time: ${nowIso}`,
    "",
    `Claimed show (from discovery, UNVERIFIED): ${artistName}${venue} on ${eventDateIso}, in Portland, Oregon or the broader Pacific`,
    "Northwest.",
    "",
    "Independently research this via web search and report your own findings as structured facts, confirming the exact date. Only",
    "the calendar date of the show matters here, not the doors/showtime - report eventTimeIso as a bare YYYY-MM-DD date",
    '(e.g. "2026-09-11"), never a full timestamp with a time-of-day or UTC offset attached.',
  ].join("\n");
}

/**
 * Independently re-verifies discoverShows's candidates - same
 * 2-corroborating-source rule as the rest of the pipeline. Extracts the
 * confirmed date from the verified fact's eventTimeIso, and takes the
 * venue from the dedicated confirmedVenue field (its own independent
 * finding, not a substring match against discovery's guess - see
 * showsVerificationPrompts.ts for why that approach was replaced).
 */
export async function verifyShows(ctx: NewsRunContext, candidates: ShowCandidate[]): Promise<VerifiedShow[]> {
  const toVerify = candidates.slice(0, MAX_CANDIDATES_TO_VERIFY);
  if (candidates.length > toVerify.length) {
    ctx.logger.info("shows-verification", `Capping verification to ${toVerify.length} of ${candidates.length} candidate(s)`);
  }

  const tierList = ctx.editorialFocus.sourceTiers;
  const results: VerifiedShow[] = [];

  for (const candidate of toVerify) {
    const summary = `${candidate.artistName} @ ${candidate.venueName ?? "unknown venue"} on ${candidate.eventDateIso}`;
    let verified: VerifiedShow | null = null;
    try {
      const response = await requestJsonWithWebSearch<RawVerificationResult>(ctx.openai, {
        model: ctx.config.news.verificationModel,
        system: buildShowsVerificationSystemPrompt(tierList, ctx.editorialFocus.entertainmentTradePublishers),
        user: buildShowVerificationUserPrompt(candidate.artistName, candidate.venueName, candidate.eventDateIso!, ctx.now.toISOString()),
        jsonSchemaName: "shows_verification_result",
        jsonSchema: showsVerificationJsonSchema(tierList),
        maxOutputTokens: 4096,
      });

      const distinctDomains = new Set<string>();
      for (const fact of response.data.facts) {
        for (const source of fact.sources) distinctDomains.add(source.domain.toLowerCase());
      }

      const primaryFact = response.data.facts.find((f) => f.sources.some((s) => s.isPrimary)) ?? response.data.facts[0];
      const confirmedDate = primaryFact?.eventTimeConfidence === "exact" ? primaryFact.eventTimeIso : null;

      if (confirmedDate) {
        verified = {
          artistName: candidate.artistName,
          venueName: response.data.confirmedVenue,
          eventDateIso: confirmedDate,
          facts: response.data.facts,
          meetsSourceBar: response.data.facts.length > 0 && distinctDomains.size >= 2,
        };
      }
    } catch (err) {
      ctx.logger.warn("shows-verification", `Verification failed for "${summary}", dropping it`, {
        error: err instanceof Error ? err.message : String(err),
      });
      insertRunCandidate(ctx.db, {
        runId: ctx.hourlyRunId,
        stage: "shows-verification",
        candidateSummary: summary,
        decision: "rejected",
        reason: `verification request failed: ${err instanceof Error ? err.message : String(err)}`,
        storyId: null,
      });
      continue;
    }

    insertRunCandidate(ctx.db, {
      runId: ctx.hourlyRunId,
      stage: "shows-verification",
      candidateSummary: summary,
      decision: verified?.meetsSourceBar ? "accepted" : "rejected",
      reason: verified?.meetsSourceBar ? null : "date not independently confirmed as exact, or fewer than 2 corroborating source domains",
      storyId: null,
    });

    if (verified?.meetsSourceBar) results.push(verified);
  }

  ctx.logger.info("shows-verification", `Verified ${results.length} of ${toVerify.length} show candidate(s) meeting the independent-source bar`);
  return results;
}
