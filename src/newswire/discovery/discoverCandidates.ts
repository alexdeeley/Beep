import { requestJsonWithWebSearch } from "../../utils/openaiClient.js";
import { getLatestDeepResearchRun, insertResearchSearch, insertRunCandidate } from "../db/researchRunsRepo.js";
import type { NewsRunContext } from "../runContext.js";
import type { DiscoveryCandidate } from "../types.js";
import { buildDiscoverySystemPrompt, buildDiscoveryUserPrompt, DISCOVERY_JSON_SCHEMA } from "./prompts.js";

interface RawDiscoveryResult {
  candidates: DiscoveryCandidate[];
}

function isExcluded(candidate: DiscoveryCandidate, ctx: NewsRunContext): boolean {
  const haystack = `${candidate.headline} ${candidate.summary}`.toLowerCase();
  return ctx.editorialFocus.exclude.some((entry) => {
    if (entry.key && candidate.topicKey === entry.key) return true;
    if (entry.phrase && haystack.includes(entry.phrase.toLowerCase())) return true;
    return false;
  });
}

const KNOWN_TOPIC_KEYS = new Set<string>();

/**
 * Runs one broad web-search sweep across every priority topic in
 * editorial-focus.json (rather than one call per topic) to keep hourly
 * cost bounded - the per-cluster independent re-search in the
 * verification stage is where the real multi-call fan-out happens, and
 * that's what actually satisfies the 2-source rule.
 */
export async function discoverCandidates(ctx: NewsRunContext): Promise<DiscoveryCandidate[]> {
  KNOWN_TOPIC_KEYS.clear();
  for (const t of ctx.editorialFocus.priorityTopics) KNOWN_TOPIC_KEYS.add(t.key);

  const nowIso = ctx.now.toISOString();
  ctx.logger.info("discovery", "Starting discovery sweep across all priority topics");

  const deepResearch = getLatestDeepResearchRun(ctx.db);
  const deepResearchContext = deepResearch?.context_blob ?? null;
  let userPrompt = buildDiscoveryUserPrompt(ctx.editorialFocus, nowIso);
  if (deepResearchContext) {
    userPrompt += [
      "",
      "Background context from today's broader deep-research pass (unverified - use for context/leads, not as fact to report directly):",
      deepResearchContext,
    ].join("\n");
  }

  let result: RawDiscoveryResult;
  try {
    const response = await requestJsonWithWebSearch<RawDiscoveryResult>(ctx.openai, {
      model: ctx.config.news.discoveryModel,
      system: buildDiscoverySystemPrompt(),
      user: userPrompt,
      jsonSchemaName: "discovery_result",
      jsonSchema: DISCOVERY_JSON_SCHEMA,
      maxOutputTokens: 8192,
    });
    result = response.data;

    for (const query of response.searchQueries) {
      insertResearchSearch(ctx.db, { runId: ctx.hourlyRunId, stage: "discovery", query, resultCount: result.candidates.length });
    }
    ctx.logger.info("discovery", `Model performed ${response.searchCount} search(es)`, { queries: response.searchQueries });
  } catch (err) {
    ctx.logger.error("discovery", "Discovery request failed", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }

  const accepted: DiscoveryCandidate[] = [];
  for (const candidate of result.candidates) {
    if (!KNOWN_TOPIC_KEYS.has(candidate.topicKey)) {
      insertRunCandidate(ctx.db, {
        runId: ctx.hourlyRunId,
        stage: "discovery",
        candidateSummary: candidate.headline,
        decision: "rejected",
        reason: `unrecognized topicKey "${candidate.topicKey}"`,
        storyId: null,
      });
      continue;
    }
    if (isExcluded(candidate, ctx)) {
      insertRunCandidate(ctx.db, {
        runId: ctx.hourlyRunId,
        stage: "discovery",
        candidateSummary: candidate.headline,
        decision: "rejected",
        reason: "matched exclude list",
        storyId: null,
      });
      continue;
    }
    if (candidate.sources.length === 0) {
      insertRunCandidate(ctx.db, {
        runId: ctx.hourlyRunId,
        stage: "discovery",
        candidateSummary: candidate.headline,
        decision: "rejected",
        reason: "no sources reported",
        storyId: null,
      });
      continue;
    }
    insertRunCandidate(ctx.db, {
      runId: ctx.hourlyRunId,
      stage: "discovery",
      candidateSummary: candidate.headline,
      decision: "accepted",
      reason: null,
      storyId: null,
    });
    accepted.push(candidate);
  }

  ctx.logger.info("discovery", `Discovered ${accepted.length} candidate(s) (${result.candidates.length - accepted.length} rejected)`);
  return accepted;
}
