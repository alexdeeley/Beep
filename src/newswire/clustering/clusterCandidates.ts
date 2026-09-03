import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requestJson } from "../../utils/openaiClient.js";
import { insertRunCandidate } from "../db/researchRunsRepo.js";
import type { NewsRunContext } from "../runContext.js";
import type { CandidateCluster, DiscoveryCandidate } from "../types.js";

const clusterGroupResultSchema = z.object({
  groups: z.array(
    z.object({
      candidateIndexes: z.array(z.number().int()),
      representativeHeadline: z.string(),
      representativeSummary: z.string(),
    })
  ),
});
type ClusterGroupResult = z.infer<typeof clusterGroupResultSchema>;

const SYSTEM_PROMPT = [
  "You group a list of news candidates into clusters, where each cluster is one underlying real-world event that multiple",
  "sources may have reported on separately (syndication/duplicate coverage). Two candidates belong in the same cluster only",
  "if they describe the same specific event - not merely the same broad topic. Every candidate index must appear in exactly",
  "one group, including groups of size 1 for candidates with no duplicates. For each group, write one representative headline",
  "and summary that best captures the event (prefer the most complete/neutral phrasing among the group's members).",
  'Respond with ONLY a JSON object of the exact shape: {"groups":[{"candidateIndexes":[0,2],"representativeHeadline":"...","representativeSummary":"..."}]}. No other keys, no markdown fences, no commentary.',
].join(" ");

/** Requests a cluster grouping and validates its shape, retrying once with a corrective reminder on a malformed/mis-shaped response. */
async function requestClusterGroups(ctx: NewsRunContext, user: string): Promise<ClusterGroupResult> {
  const attempt = async (extra?: string): Promise<ClusterGroupResult> => {
    const raw = await requestJson<unknown>(ctx.openai, {
      model: ctx.config.news.discoveryModel,
      system: SYSTEM_PROMPT,
      user: extra ? `${user}\n\n${extra}` : user,
      temperature: 0.1,
      maxOutputTokens: 2048,
    });
    return clusterGroupResultSchema.parse(raw);
  };

  try {
    return await attempt();
  } catch {
    return await attempt(
      'IMPORTANT: Your previous response did not match the required shape. Respond with ONLY {"groups":[{"candidateIndexes":[...],"representativeHeadline":"...","representativeSummary":"..."}]}.'
    );
  }
}

/**
 * Collapses discovery candidates that describe the same underlying event
 * (wire-service syndication, multiple outlets covering one announcement)
 * into single clusters, grouped separately per topic so an unrelated
 * politics item and games item never merge just for sharing a sentence
 * structure.
 */
export async function clusterCandidates(ctx: NewsRunContext, candidates: DiscoveryCandidate[]): Promise<CandidateCluster[]> {
  if (candidates.length === 0) return [];

  const byTopic = new Map<string, DiscoveryCandidate[]>();
  for (const c of candidates) {
    const list = byTopic.get(c.topicKey) ?? [];
    list.push(c);
    byTopic.set(c.topicKey, list);
  }

  const clusters: CandidateCluster[] = [];

  for (const [topicKey, topicCandidates] of byTopic) {
    if (topicCandidates.length === 1) {
      clusters.push(singletonCluster(topicKey, topicCandidates[0]!));
      continue;
    }

    const listing = topicCandidates
      .map((c, i) => `${i}. HEADLINE: ${c.headline}\n   SUMMARY: ${c.summary}`)
      .join("\n");

    let result: ClusterGroupResult;
    try {
      result = await requestClusterGroups(ctx, `Candidates for topic "${topicKey}":\n\n${listing}`);
    } catch (err) {
      ctx.logger.warn("clustering", `Clustering call failed for topic "${topicKey}", treating each candidate as its own cluster`, {
        error: err instanceof Error ? err.message : String(err),
      });
      for (const c of topicCandidates) clusters.push(singletonCluster(topicKey, c));
      continue;
    }

    const seen = new Set<number>();
    for (const group of result.groups) {
      const members = group.candidateIndexes
        .filter((i) => Number.isInteger(i) && i >= 0 && i < topicCandidates.length && !seen.has(i))
        .map((i) => {
          seen.add(i);
          return topicCandidates[i]!;
        });
      if (members.length === 0) continue;

      const cluster: CandidateCluster = {
        id: randomUUID(),
        topicKey,
        representativeHeadline: group.representativeHeadline,
        representativeSummary: group.representativeSummary,
        memberCandidates: members,
      };
      clusters.push(cluster);

      if (members.length > 1) {
        insertRunCandidate(ctx.db, {
          runId: ctx.hourlyRunId,
          stage: "clustering",
          candidateSummary: cluster.representativeHeadline,
          decision: "accepted",
          reason: `merged ${members.length} duplicate/syndicated candidates`,
          storyId: null,
        });
      }
    }

    // Any candidate the model failed to place gets its own cluster rather than being silently dropped.
    for (let i = 0; i < topicCandidates.length; i++) {
      if (!seen.has(i)) clusters.push(singletonCluster(topicKey, topicCandidates[i]!));
    }
  }

  ctx.logger.info("clustering", `Grouped ${candidates.length} candidate(s) into ${clusters.length} cluster(s)`);
  return clusters;
}

function singletonCluster(topicKey: string, candidate: DiscoveryCandidate): CandidateCluster {
  return {
    id: randomUUID(),
    topicKey,
    representativeHeadline: candidate.headline,
    representativeSummary: candidate.summary,
    memberCandidates: [candidate],
  };
}
