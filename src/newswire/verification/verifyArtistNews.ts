import { requestJsonWithWebSearch } from "../../utils/openaiClient.js";
import { insertRunCandidate } from "../db/researchRunsRepo.js";
import type { NewsRunContext } from "../runContext.js";
import type { MusicNewsCandidate, VerifiedFact, VerifiedMusicItem } from "../types.js";
import { buildVerificationSystemPrompt, buildVerificationUserPrompt, verificationJsonSchema } from "./prompts.js";

interface RawVerificationResult {
  facts: VerifiedFact[];
}

/**
 * Hard cap on candidates independently re-researched per hourly cycle.
 * Verification is the expensive, must-not-skip stage (one live web-search
 * call per candidate) - an hourly cadence realistically only ever needs to
 * post a handful of items, so there is no editorial reason to verify
 * dozens of candidates just because discovery found them.
 */
const MAX_CANDIDATES_TO_VERIFY = 15;

export async function verifyArtistNews(ctx: NewsRunContext, candidates: MusicNewsCandidate[]): Promise<VerifiedMusicItem[]> {
  const toVerify = candidates.slice(0, MAX_CANDIDATES_TO_VERIFY);
  if (candidates.length > toVerify.length) {
    ctx.logger.info("verification", `Capping verification to ${toVerify.length} of ${candidates.length} candidate(s) this cycle`);
  }

  const tierList = ctx.editorialFocus.sourceTiers;
  const results: VerifiedMusicItem[] = [];

  for (const candidate of toVerify) {
    let verified: VerifiedMusicItem;
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
        watchedArtistId: candidate.watchedArtistId,
        artistName: candidate.artistName,
        itemType: candidate.itemType,
        headline: candidate.headline,
        facts: response.data.facts,
        meetsSourceBar: response.data.facts.length > 0 && distinctDomains.size >= 2,
      };
    } catch (err) {
      ctx.logger.warn("verification", `Verification failed for "${candidate.headline}", dropping it`, {
        error: err instanceof Error ? err.message : String(err),
      });
      insertRunCandidate(ctx.db, {
        runId: ctx.hourlyRunId,
        stage: "verification",
        candidateSummary: candidate.headline,
        decision: "rejected",
        reason: `verification request failed: ${err instanceof Error ? err.message : String(err)}`,
        storyId: null,
      });
      continue;
    }

    insertRunCandidate(ctx.db, {
      runId: ctx.hourlyRunId,
      stage: "verification",
      candidateSummary: candidate.headline,
      decision: verified.meetsSourceBar ? "accepted" : "rejected",
      reason: verified.meetsSourceBar ? null : "fewer than 2 independent corroborating sources found on re-research",
      storyId: null,
    });

    if (verified.meetsSourceBar) results.push(verified);
  }

  ctx.logger.info("verification", `Verified ${results.length} of ${toVerify.length} candidate(s) meeting the independent-source bar`);
  return results;
}
