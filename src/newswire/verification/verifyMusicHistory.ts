import { requestJsonWithWebSearch } from "../../utils/openaiClient.js";
import { insertRunCandidate } from "../db/researchRunsRepo.js";
import type { NewsRunContext } from "../runContext.js";
import type { HistoryFactCandidate, VerifiedFact, VerifiedHistoryFact } from "../types.js";
import { buildVerificationSystemPrompt, verificationJsonSchema } from "./prompts.js";

interface RawVerificationResult {
  facts: VerifiedFact[];
}

const MAX_CANDIDATES_TO_VERIFY = 6;

function buildHistoryVerificationUserPrompt(year: number, eventDescription: string, nowIso: string): string {
  return [
    `Current time: ${nowIso}`,
    "",
    `Claimed historical event (from discovery, UNVERIFIED): In ${year}, ${eventDescription}.`,
    "",
    "Independently research this via web search and report your own findings as structured facts, including confirming the exact",
    "year is correct - a claim with the wrong year should be labeled UNCONFIRMED or corrected in the claim text, not passed through silently.",
  ].join("\n");
}

/**
 * Independently re-verifies discoverMusicHistory's candidates - same
 * 2-corroborating-source rule as the rest of the pipeline, reusing the
 * generic verification prompt/schema (it only needs a claim to check, not
 * an artist watchlist concept).
 */
export async function verifyMusicHistory(ctx: NewsRunContext, candidates: HistoryFactCandidate[]): Promise<VerifiedHistoryFact[]> {
  const toVerify = candidates.slice(0, MAX_CANDIDATES_TO_VERIFY);
  if (candidates.length > toVerify.length) {
    ctx.logger.info("history-verification", `Capping verification to ${toVerify.length} of ${candidates.length} candidate(s)`);
  }

  const tierList = ctx.editorialFocus.sourceTiers;
  const results: VerifiedHistoryFact[] = [];

  for (const candidate of toVerify) {
    const summary = `${candidate.year}: ${candidate.eventDescription}`;
    let verified: VerifiedHistoryFact;
    try {
      const response = await requestJsonWithWebSearch<RawVerificationResult>(ctx.openai, {
        model: ctx.config.news.verificationModel,
        system: buildVerificationSystemPrompt(tierList, ctx.editorialFocus.entertainmentTradePublishers),
        user: buildHistoryVerificationUserPrompt(candidate.year, candidate.eventDescription, ctx.now.toISOString()),
        jsonSchemaName: "verification_result",
        jsonSchema: verificationJsonSchema(tierList),
        maxOutputTokens: 4096,
      });

      const distinctDomains = new Set<string>();
      for (const fact of response.data.facts) {
        for (const source of fact.sources) distinctDomains.add(source.domain.toLowerCase());
      }

      verified = {
        year: candidate.year,
        eventDescription: candidate.eventDescription,
        facts: response.data.facts,
        meetsSourceBar: response.data.facts.length > 0 && distinctDomains.size >= 2,
      };
    } catch (err) {
      ctx.logger.warn("history-verification", `Verification failed for "${summary}", dropping it`, {
        error: err instanceof Error ? err.message : String(err),
      });
      insertRunCandidate(ctx.db, {
        runId: ctx.hourlyRunId,
        stage: "history-verification",
        candidateSummary: summary,
        decision: "rejected",
        reason: `verification request failed: ${err instanceof Error ? err.message : String(err)}`,
        storyId: null,
      });
      continue;
    }

    insertRunCandidate(ctx.db, {
      runId: ctx.hourlyRunId,
      stage: "history-verification",
      candidateSummary: summary,
      decision: verified.meetsSourceBar ? "accepted" : "rejected",
      reason: verified.meetsSourceBar ? null : "fewer than 2 independent corroborating sources found on re-research",
      storyId: null,
    });

    if (verified.meetsSourceBar) results.push(verified);
  }

  ctx.logger.info(
    "history-verification",
    `Verified ${results.length} of ${toVerify.length} music-history candidate(s) meeting the independent-source bar`
  );
  return results;
}
