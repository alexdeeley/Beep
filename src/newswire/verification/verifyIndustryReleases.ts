import { requestJsonWithWebSearch } from "../../utils/openaiClient.js";
import { insertRunCandidate } from "../db/researchRunsRepo.js";
import type { NewsRunContext } from "../runContext.js";
import type { IndustryReleaseCandidate, VerifiedFact, VerifiedIndustryRelease } from "../types.js";
import { buildVerificationSystemPrompt, buildVerificationUserPrompt, verificationJsonSchema } from "./prompts.js";

interface RawVerificationResult {
  facts: VerifiedFact[];
}

/** Same reasoning as verifyArtistNews's cap - verification is one live web-search call per candidate. */
const MAX_CANDIDATES_TO_VERIFY = 12;

/**
 * Independently re-verifies discoverIndustryReleases's candidates - same
 * 2-corroborating-source rule as the watchlist path (verifyArtistNews),
 * reusing the exact same prompts/schema since they only need
 * artistName/headline/summary, not a watched_artist_id.
 */
export async function verifyIndustryReleases(
  ctx: NewsRunContext,
  candidates: IndustryReleaseCandidate[]
): Promise<VerifiedIndustryRelease[]> {
  const toVerify = candidates.slice(0, MAX_CANDIDATES_TO_VERIFY);
  if (candidates.length > toVerify.length) {
    ctx.logger.info("industry-verification", `Capping verification to ${toVerify.length} of ${candidates.length} candidate(s)`);
  }

  const tierList = ctx.editorialFocus.sourceTiers;
  const results: VerifiedIndustryRelease[] = [];

  for (const candidate of toVerify) {
    let verified: VerifiedIndustryRelease;
    try {
      const response = await requestJsonWithWebSearch<RawVerificationResult>(ctx.openai, {
        model: ctx.config.news.verificationModel,
        system: buildVerificationSystemPrompt(tierList, ctx.editorialFocus.entertainmentTradePublishers),
        user: buildVerificationUserPrompt(candidate.artistName, candidate.headline, candidate.summary, ctx.now.toISOString()),
        jsonSchemaName: "verification_result",
        jsonSchema: verificationJsonSchema(tierList),
        maxOutputTokens: 4096,
      });

      const distinctDomains = new Set<string>();
      for (const fact of response.data.facts) {
        for (const source of fact.sources) distinctDomains.add(source.domain.toLowerCase());
      }

      verified = {
        artistName: candidate.artistName,
        releaseFormat: candidate.releaseFormat,
        headline: candidate.headline,
        facts: response.data.facts,
        meetsSourceBar: response.data.facts.length > 0 && distinctDomains.size >= 2,
      };
    } catch (err) {
      ctx.logger.warn("industry-verification", `Verification failed for "${candidate.headline}", dropping it`, {
        error: err instanceof Error ? err.message : String(err),
      });
      insertRunCandidate(ctx.db, {
        runId: ctx.hourlyRunId,
        stage: "industry-verification",
        candidateSummary: candidate.headline,
        decision: "rejected",
        reason: `verification request failed: ${err instanceof Error ? err.message : String(err)}`,
        storyId: null,
      });
      continue;
    }

    insertRunCandidate(ctx.db, {
      runId: ctx.hourlyRunId,
      stage: "industry-verification",
      candidateSummary: candidate.headline,
      decision: verified.meetsSourceBar ? "accepted" : "rejected",
      reason: verified.meetsSourceBar ? null : "fewer than 2 independent corroborating sources found on re-research",
      storyId: null,
    });

    if (verified.meetsSourceBar) results.push(verified);
  }

  ctx.logger.info(
    "industry-verification",
    `Verified ${results.length} of ${toVerify.length} industry-wide candidate(s) meeting the independent-source bar`
  );
  return results;
}
