import { insertRunCandidate } from "../db/researchRunsRepo.js";
import { requestJsonWithWebSearch } from "../../utils/openaiClient.js";
import type { NewsRunContext } from "../runContext.js";
import type { BiggestStoryCandidate, VerifiedBiggestStory, VerifiedFact } from "../types.js";
import { biggestStoriesVerificationJsonSchema, buildBiggestStoriesVerificationSystemPrompt } from "./biggestStoriesVerificationPrompts.js";
import { isFreshEnough } from "./itemFreshness.js";

interface RawVerificationResult {
  blurb: string | null;
  facts: VerifiedFact[];
}

const MAX_CANDIDATES_TO_VERIFY = 8;

function buildBiggestStoriesVerificationUserPrompt(headline: string, nowIso: string): string {
  return [
    `Current time: ${nowIso}`,
    "",
    `Claimed music story (from discovery, UNVERIFIED): ${headline}`,
    "",
    "Independently research this via web search and report your own findings as structured facts.",
  ].join("\n");
}

/**
 * Independently re-verifies discoverBiggestStories's candidates - same 2-corroborating-source rule as
 * the rest of the pipeline, plus the shared staleness check (itemFreshness.ts) so a genuinely old story
 * can't surface as if it happened today. Takes the short public-facing blurb from the dedicated `blurb`
 * field (verification's own finding, never discovery's wording - see biggestStoriesVerificationPrompts.ts).
 * A candidate only survives (meetsSourceBar true) when the source bar is met AND a non-null blurb came
 * back AND the item is still fresh.
 */
export async function verifyBiggestStories(ctx: NewsRunContext, candidates: BiggestStoryCandidate[]): Promise<VerifiedBiggestStory[]> {
  const toVerify = candidates.slice(0, MAX_CANDIDATES_TO_VERIFY);
  if (candidates.length > toVerify.length) {
    ctx.logger.info("biggest-stories-verification", `Capping verification to ${toVerify.length} of ${candidates.length} candidate(s)`);
  }

  const tierList = ctx.editorialFocus.sourceTiers;
  const results: VerifiedBiggestStory[] = [];

  for (const candidate of toVerify) {
    const summary = candidate.headline;
    let verified: VerifiedBiggestStory | null = null;
    let rejectReason = "verification failed";
    try {
      const response = await requestJsonWithWebSearch<RawVerificationResult>(ctx.openai, {
        model: ctx.config.news.verificationModel,
        system: buildBiggestStoriesVerificationSystemPrompt(tierList, ctx.editorialFocus.entertainmentTradePublishers),
        user: buildBiggestStoriesVerificationUserPrompt(candidate.headline, ctx.now.toISOString()),
        jsonSchemaName: "biggest_stories_verification_result",
        jsonSchema: biggestStoriesVerificationJsonSchema(tierList),
        maxOutputTokens: 4096,
      });

      const distinctDomains = new Set<string>();
      for (const fact of response.data.facts) {
        for (const source of fact.sources) distinctDomains.add(source.domain.toLowerCase());
      }

      const primaryFact = response.data.facts.find((f) => f.sources.some((s) => s.isPrimary)) ?? response.data.facts[0];
      const fresh = !primaryFact || isFreshEnough(primaryFact.eventTimeIso, primaryFact.eventTimeConfidence, ctx.now, ctx.config.news.maxItemAgeDays);

      const sourceBarMet = response.data.facts.length > 0 && distinctDomains.size >= 2;
      const hasBlurb = Boolean(response.data.blurb && response.data.blurb.trim().length > 0);

      verified = {
        headline: candidate.headline,
        blurb: response.data.blurb,
        facts: response.data.facts,
        meetsSourceBar: sourceBarMet && hasBlurb && fresh,
      };

      if (!verified.meetsSourceBar) {
        rejectReason = !fresh
          ? `event date is more than ${ctx.config.news.maxItemAgeDays} day(s) old - not current news`
          : !hasBlurb
            ? "verification could not produce a confident blurb"
            : "fewer than 2 independent corroborating source domains";
      }
    } catch (err) {
      ctx.logger.warn("biggest-stories-verification", `Verification failed for "${summary}", dropping it`, {
        error: err instanceof Error ? err.message : String(err),
      });
      insertRunCandidate(ctx.db, {
        runId: ctx.hourlyRunId,
        stage: "biggest-stories-verification",
        candidateSummary: summary,
        decision: "rejected",
        reason: `verification request failed: ${err instanceof Error ? err.message : String(err)}`,
        storyId: null,
      });
      continue;
    }

    insertRunCandidate(ctx.db, {
      runId: ctx.hourlyRunId,
      stage: "biggest-stories-verification",
      candidateSummary: summary,
      decision: verified.meetsSourceBar ? "accepted" : "rejected",
      reason: verified.meetsSourceBar ? null : rejectReason,
      storyId: null,
    });

    if (verified.meetsSourceBar) results.push(verified);
  }

  ctx.logger.info(
    "biggest-stories-verification",
    `Verified ${results.length} of ${toVerify.length} candidate(s) meeting the independent-source bar`
  );
  return results;
}
