import { insertRunCandidate } from "../db/researchRunsRepo.js";
import { requestJsonWithWebSearch } from "../../utils/openaiClient.js";
import type { NewsRunContext } from "../runContext.js";
import type { FestivalPosterCandidate, VerifiedFestivalPoster, VerifiedFact } from "../types.js";
import { festivalPostersVerificationJsonSchema, buildFestivalPostersVerificationSystemPrompt } from "./festivalPostersVerificationPrompts.js";
import { isFreshEnough } from "./itemFreshness.js";

interface RawVerificationResult {
  blurb: string | null;
  facts: VerifiedFact[];
}

const MAX_CANDIDATES_TO_VERIFY = 6;

function buildFestivalPostersVerificationUserPrompt(festivalName: string, headline: string, nowIso: string): string {
  return [
    `Current time: ${nowIso}`,
    "",
    `Claimed festival lineup announcement (from discovery, UNVERIFIED): ${festivalName} - ${headline}`,
    "",
    "Independently research this via web search and report your own findings as structured facts.",
  ].join("\n");
}

/**
 * Independently re-verifies discoverFestivalPosters's candidates - same 2-corroborating-source rule as
 * the rest of the pipeline, plus the shared staleness check (itemFreshness.ts) so a genuinely old
 * announcement can't surface as if it happened today. Also carries forward the primary fact's primary
 * source URL (verification's own pick of the most authoritative source, e.g. the festival's own site) -
 * festivalPosters/extractPosterImage.ts fetches THIS URL to find the real poster image.
 */
export async function verifyFestivalPosters(ctx: NewsRunContext, candidates: FestivalPosterCandidate[]): Promise<VerifiedFestivalPoster[]> {
  const toVerify = candidates.slice(0, MAX_CANDIDATES_TO_VERIFY);
  if (candidates.length > toVerify.length) {
    ctx.logger.info("festival-posters-verification", `Capping verification to ${toVerify.length} of ${candidates.length} candidate(s)`);
  }

  const tierList = ctx.editorialFocus.sourceTiers;
  const results: VerifiedFestivalPoster[] = [];

  for (const candidate of toVerify) {
    const summary = `${candidate.festivalName}: ${candidate.headline}`;
    let verified: VerifiedFestivalPoster | null = null;
    let rejectReason = "verification failed";
    try {
      const response = await requestJsonWithWebSearch<RawVerificationResult>(ctx.openai, {
        model: ctx.config.news.verificationModel,
        system: buildFestivalPostersVerificationSystemPrompt(tierList, ctx.editorialFocus.entertainmentTradePublishers),
        user: buildFestivalPostersVerificationUserPrompt(candidate.festivalName, candidate.headline, ctx.now.toISOString()),
        jsonSchemaName: "festival_posters_verification_result",
        jsonSchema: festivalPostersVerificationJsonSchema(tierList),
        maxOutputTokens: 4096,
      });

      const distinctDomains = new Set<string>();
      for (const fact of response.data.facts) {
        for (const source of fact.sources) distinctDomains.add(source.domain.toLowerCase());
      }

      const primaryFact = response.data.facts.find((f) => f.sources.some((s) => s.isPrimary)) ?? response.data.facts[0];
      const primarySource = primaryFact?.sources.find((s) => s.isPrimary) ?? primaryFact?.sources[0] ?? null;
      const fresh = !primaryFact || isFreshEnough(primaryFact.eventTimeIso, primaryFact.eventTimeConfidence, ctx.now, ctx.config.news.maxItemAgeDays);

      const sourceBarMet = response.data.facts.length > 0 && distinctDomains.size >= 2;
      const hasBlurb = Boolean(response.data.blurb && response.data.blurb.trim().length > 0);

      verified = {
        festivalName: candidate.festivalName,
        eventYear: candidate.eventYear,
        headline: candidate.headline,
        blurb: response.data.blurb,
        primarySourceUrl: primarySource?.url ?? null,
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
      ctx.logger.warn("festival-posters-verification", `Verification failed for "${summary}", dropping it`, {
        error: err instanceof Error ? err.message : String(err),
      });
      insertRunCandidate(ctx.db, {
        runId: ctx.hourlyRunId,
        stage: "festival-posters-verification",
        candidateSummary: summary,
        decision: "rejected",
        reason: `verification request failed: ${err instanceof Error ? err.message : String(err)}`,
        storyId: null,
      });
      continue;
    }

    insertRunCandidate(ctx.db, {
      runId: ctx.hourlyRunId,
      stage: "festival-posters-verification",
      candidateSummary: summary,
      decision: verified.meetsSourceBar ? "accepted" : "rejected",
      reason: verified.meetsSourceBar ? null : rejectReason,
      storyId: null,
    });

    if (verified.meetsSourceBar) results.push(verified);
  }

  ctx.logger.info(
    "festival-posters-verification",
    `Verified ${results.length} of ${toVerify.length} candidate(s) meeting the independent-source bar`
  );
  return results;
}
