import { insertRunCandidate } from "../db/researchRunsRepo.js";
import { requestJsonWithWebSearch } from "../../utils/openaiClient.js";
import type { NewsRunContext } from "../runContext.js";
import type { ClassicPosterCandidate, VerifiedClassicPoster } from "../types.js";
import { classicPosterVerificationJsonSchema, buildClassicPosterVerificationSystemPrompt } from "./classicPosterVerificationPrompts.js";

interface RawVerificationResult {
  blurb: string | null;
  lineupArtists: string[];
  primarySourceUrl: string | null;
  facts: { claim: string; factLabel: string; sources: { url: string; title: string; domain: string; sourceTier: string }[] }[];
}

function buildClassicPosterVerificationUserPrompt(candidate: ClassicPosterCandidate, nowIso: string): string {
  return [
    `Current time: ${nowIso}`,
    "",
    `Claimed classic piece of music graphic design (from discovery, UNVERIFIED): ${candidate.festivalName} ${candidate.eventYear} - ${candidate.whyNotable}`,
    "",
    "Independently research this via web search and report your own findings as structured facts.",
  ].join("\n");
}

/**
 * Independently re-verifies discoverClassicPoster's single candidate - same 2-corroborating-source rule
 * as the rest of the pipeline, but with NO freshness check and NO date/location-on-the-artwork requirement
 * at all (see classicPosterVerificationPrompts.ts). Only ever called from postClassicPoster.ts with
 * exactly one candidate (there's never more than one Classic Poster candidate per cycle).
 */
export async function verifyClassicPoster(ctx: NewsRunContext, candidate: ClassicPosterCandidate): Promise<VerifiedClassicPoster | null> {
  const summary = `${candidate.festivalName} ${candidate.eventYear}`;
  const tierList = ctx.editorialFocus.sourceTiers;

  let verified: VerifiedClassicPoster;
  let rejectReason = "verification failed";
  try {
    const response = await requestJsonWithWebSearch<RawVerificationResult>(ctx.openai, {
      model: ctx.config.news.verificationModel,
      system: buildClassicPosterVerificationSystemPrompt(tierList, ctx.editorialFocus.entertainmentTradePublishers),
      user: buildClassicPosterVerificationUserPrompt(candidate, ctx.now.toISOString()),
      jsonSchemaName: "classic_poster_verification_result",
      jsonSchema: classicPosterVerificationJsonSchema(tierList),
      maxOutputTokens: 4096,
    });

    const distinctDomains = new Set<string>();
    for (const fact of response.data.facts) {
      for (const source of fact.sources) distinctDomains.add(source.domain.toLowerCase());
    }

    const sourceBarMet = response.data.facts.length > 0 && distinctDomains.size >= 2;
    const hasBlurb = Boolean(response.data.blurb && response.data.blurb.trim().length > 0);
    const hasSourceUrl = Boolean(response.data.primarySourceUrl && response.data.primarySourceUrl.trim().length > 0);

    verified = {
      festivalName: candidate.festivalName,
      eventYear: candidate.eventYear,
      blurb: response.data.blurb,
      lineupArtists: response.data.lineupArtists,
      primarySourceUrl: response.data.primarySourceUrl,
      meetsSourceBar: sourceBarMet && hasBlurb && hasSourceUrl,
    };

    if (!verified.meetsSourceBar) {
      rejectReason = !hasSourceUrl
        ? "verification could not find a page to extract the artwork image from"
        : !hasBlurb
          ? "verification could not produce a confident blurb"
          : "fewer than 2 independent corroborating source domains";
    }
  } catch (err) {
    ctx.logger.warn("classic-poster-verification", `Verification failed for "${summary}", dropping it`, {
      error: err instanceof Error ? err.message : String(err),
    });
    insertRunCandidate(ctx.db, {
      runId: ctx.hourlyRunId,
      stage: "classic-poster-verification",
      candidateSummary: summary,
      decision: "rejected",
      reason: `verification request failed: ${err instanceof Error ? err.message : String(err)}`,
      storyId: null,
    });
    return null;
  }

  insertRunCandidate(ctx.db, {
    runId: ctx.hourlyRunId,
    stage: "classic-poster-verification",
    candidateSummary: summary,
    decision: verified.meetsSourceBar ? "accepted" : "rejected",
    reason: verified.meetsSourceBar ? null : rejectReason,
    storyId: null,
  });

  ctx.logger.info("classic-poster-verification", verified.meetsSourceBar ? `Verified "${summary}"` : `Rejected "${summary}": ${rejectReason}`);
  return verified.meetsSourceBar ? verified : null;
}
