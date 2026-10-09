import { insertRunCandidate } from "../db/researchRunsRepo.js";
import { requestJsonWithWebSearch } from "../../utils/openaiClient.js";
import type { NewsRunContext } from "../runContext.js";
import type { ThrowbackPosterCandidate, VerifiedThrowbackPoster } from "../types.js";
import { throwbackPosterVerificationJsonSchema, buildThrowbackPosterVerificationSystemPrompt } from "./throwbackPosterVerificationPrompts.js";

interface RawVerificationResult {
  blurb: string | null;
  lineupArtists: string[];
  primarySourceUrl: string | null;
  facts: { claim: string; factLabel: string; sources: { url: string; title: string; domain: string; sourceTier: string }[] }[];
}

function buildThrowbackPosterVerificationUserPrompt(candidate: ThrowbackPosterCandidate, nowIso: string): string {
  return [
    `Current time: ${nowIso}`,
    "",
    `Claimed historical festival poster (from discovery, UNVERIFIED): ${candidate.festivalName} ${candidate.eventYear} - ${candidate.whyNotable}`,
    "",
    "Independently research this via web search and report your own findings as structured facts.",
  ].join("\n");
}

/**
 * Independently re-verifies discoverThrowbackPoster's single candidate - same 2-corroborating-source
 * rule as the rest of the pipeline, but with NO freshness check at all (see
 * throwbackPosterVerificationPrompts.ts). Only ever called from postThrowbackPoster.ts with exactly one
 * candidate (there's never more than one Throwback Thursday candidate per cycle).
 */
export async function verifyThrowbackPoster(ctx: NewsRunContext, candidate: ThrowbackPosterCandidate): Promise<VerifiedThrowbackPoster | null> {
  const summary = `${candidate.festivalName} ${candidate.eventYear}`;
  const tierList = ctx.editorialFocus.sourceTiers;

  let verified: VerifiedThrowbackPoster;
  let rejectReason = "verification failed";
  try {
    const response = await requestJsonWithWebSearch<RawVerificationResult>(ctx.openai, {
      model: ctx.config.news.verificationModel,
      system: buildThrowbackPosterVerificationSystemPrompt(tierList, ctx.editorialFocus.entertainmentTradePublishers),
      user: buildThrowbackPosterVerificationUserPrompt(candidate, ctx.now.toISOString()),
      jsonSchemaName: "throwback_poster_verification_result",
      jsonSchema: throwbackPosterVerificationJsonSchema(tierList),
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
        ? "verification could not find a page to extract the poster image from"
        : !hasBlurb
          ? "verification could not produce a confident blurb"
          : "fewer than 2 independent corroborating source domains";
    }
  } catch (err) {
    ctx.logger.warn("throwback-poster-verification", `Verification failed for "${summary}", dropping it`, {
      error: err instanceof Error ? err.message : String(err),
    });
    insertRunCandidate(ctx.db, {
      runId: ctx.hourlyRunId,
      stage: "throwback-poster-verification",
      candidateSummary: summary,
      decision: "rejected",
      reason: `verification request failed: ${err instanceof Error ? err.message : String(err)}`,
      storyId: null,
    });
    return null;
  }

  insertRunCandidate(ctx.db, {
    runId: ctx.hourlyRunId,
    stage: "throwback-poster-verification",
    candidateSummary: summary,
    decision: verified.meetsSourceBar ? "accepted" : "rejected",
    reason: verified.meetsSourceBar ? null : rejectReason,
    storyId: null,
  });

  ctx.logger.info("throwback-poster-verification", verified.meetsSourceBar ? `Verified "${summary}"` : `Rejected "${summary}": ${rejectReason}`);
  return verified.meetsSourceBar ? verified : null;
}
