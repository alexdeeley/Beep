import { requestJsonWithWebSearch } from "../../utils/openaiClient.js";
import { insertResearchSearch, insertRunCandidate } from "../db/researchRunsRepo.js";
import type { NewsRunContext } from "../runContext.js";
import type { CandidateCluster, VerifiedCluster, VerifiedFact } from "../types.js";
import { buildVerificationSystemPrompt, buildVerificationUserPrompt, verificationJsonSchema } from "./prompts.js";

interface RawVerificationResult {
  facts: VerifiedFact[];
}

/**
 * Hard cap on clusters independently re-researched per hourly cycle.
 * Verification is the expensive, must-not-skip stage (one live web-search
 * call per cluster) - an hourly cadence realistically only ever needs to
 * post a handful of items (maxPostsPerEdition), so there is no editorial
 * reason to verify dozens of clusters just because discovery found them.
 */
const MAX_CLUSTERS_TO_VERIFY = 15;

export async function verifyClusters(ctx: NewsRunContext, clusters: CandidateCluster[]): Promise<VerifiedCluster[]> {
  const toVerify = clusters.slice(0, MAX_CLUSTERS_TO_VERIFY);
  if (clusters.length > toVerify.length) {
    ctx.logger.info("verification", `Capping verification to ${toVerify.length} of ${clusters.length} clusters this cycle`);
  }

  const results: VerifiedCluster[] = [];

  for (const cluster of toVerify) {
    const topic = ctx.editorialFocus.priorityTopics.find((t) => t.key === cluster.topicKey);
    const track = topic?.sourceTierTrack ?? "hard_news";
    const tierList = ctx.editorialFocus.sourceTiers[track] ?? ctx.editorialFocus.sourceTiers["hard_news"] ?? [];

    let verified: VerifiedCluster;
    try {
      const response = await requestJsonWithWebSearch<RawVerificationResult>(ctx.openai, {
        model: ctx.config.news.verificationModel,
        system: buildVerificationSystemPrompt(track, tierList, ctx.editorialFocus.entertainmentTradePublishers),
        user: buildVerificationUserPrompt(cluster, ctx.editorialFocus, ctx.now.toISOString()),
        jsonSchemaName: "verification_result",
        jsonSchema: verificationJsonSchema(tierList),
        maxOutputTokens: 4096,
      });

      for (const query of response.searchQueries) {
        insertResearchSearch(ctx.db, { runId: ctx.hourlyRunId, stage: "verification", query, resultCount: response.data.facts.length });
      }

      const distinctDomains = new Set<string>();
      for (const fact of response.data.facts) {
        for (const source of fact.sources) distinctDomains.add(source.domain.toLowerCase());
      }

      verified = {
        clusterId: cluster.id,
        topicKey: cluster.topicKey,
        headline: cluster.representativeHeadline,
        facts: response.data.facts,
        meetsSourceBar: distinctDomains.size >= 2,
      };
    } catch (err) {
      ctx.logger.warn("verification", `Verification failed for cluster "${cluster.representativeHeadline}", dropping it`, {
        error: err instanceof Error ? err.message : String(err),
      });
      insertRunCandidate(ctx.db, {
        runId: ctx.hourlyRunId,
        stage: "verification",
        candidateSummary: cluster.representativeHeadline,
        decision: "rejected",
        reason: `verification request failed: ${err instanceof Error ? err.message : String(err)}`,
        storyId: null,
      });
      continue;
    }

    insertRunCandidate(ctx.db, {
      runId: ctx.hourlyRunId,
      stage: "verification",
      candidateSummary: cluster.representativeHeadline,
      decision: verified.meetsSourceBar ? "accepted" : "rejected",
      reason: verified.meetsSourceBar ? null : "fewer than 2 independent corroborating sources found on re-research",
      storyId: null,
    });

    if (verified.meetsSourceBar) results.push(verified);
  }

  ctx.logger.info(
    "verification",
    `Verified ${results.length} of ${toVerify.length} cluster(s) meeting the independent-source bar`
  );
  return results;
}
