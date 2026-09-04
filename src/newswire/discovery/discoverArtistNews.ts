import { requestJsonWithWebSearch } from "../../utils/openaiClient.js";
import { insertRunCandidate } from "../db/researchRunsRepo.js";
import { hasSimilarItem } from "../db/musicItemsRepo.js";
import type { WatchedArtistRow } from "../db/watchedArtistsRepo.js";
import type { NewsRunContext } from "../runContext.js";
import type { MusicNewsCandidate, ReleaseFormat } from "../types.js";
import { buildDiscoverySystemPrompt, buildDiscoveryUserPrompt, DISCOVERY_JSON_SCHEMA } from "./prompts.js";

interface RawCandidate {
  artistName: string;
  itemType: "release" | "news";
  releaseFormat: ReleaseFormat | null;
  headline: string;
  summary: string;
  eventTimeIso: string | null;
  eventTimeConfidence: "exact" | "approximate" | "unknown";
  sources: { url: string; title: string; domain: string }[];
}

interface RawDiscoveryResult {
  candidates: RawCandidate[];
}

/**
 * One web-search sweep across this cycle's rotation batch of watchlist
 * artists (rather than one call per artist, to keep hourly cost bounded).
 * The per-candidate independent re-search in the verification stage is
 * where the real corroboration work happens - this stage just proposes
 * candidates, filtered against the batch and against items already on
 * record for that artist.
 */
export async function discoverArtistNews(ctx: NewsRunContext, batch: WatchedArtistRow[]): Promise<MusicNewsCandidate[]> {
  if (batch.length === 0) return [];

  const byName = new Map(batch.map((a) => [a.name, a] as const));
  const nowIso = ctx.now.toISOString();
  ctx.logger.info("discovery", `Starting discovery sweep across ${batch.length} watchlist artist(s)`);

  let result: RawDiscoveryResult;
  try {
    const response = await requestJsonWithWebSearch<RawDiscoveryResult>(ctx.openai, {
      model: ctx.config.news.discoveryModel,
      system: buildDiscoverySystemPrompt(),
      user: buildDiscoveryUserPrompt(batch.map((a) => a.name), nowIso),
      jsonSchemaName: "discovery_result",
      jsonSchema: DISCOVERY_JSON_SCHEMA,
      maxOutputTokens: 8192,
    });
    result = response.data;
    ctx.logger.info("discovery", `Model performed ${response.searchCount} search(es)`, { queries: response.searchQueries });
  } catch (err) {
    ctx.logger.error("discovery", "Discovery request failed", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }

  const accepted: MusicNewsCandidate[] = [];
  for (const candidate of result.candidates) {
    const artist = byName.get(candidate.artistName);
    if (!artist) {
      insertRunCandidate(ctx.db, {
        runId: ctx.hourlyRunId,
        stage: "discovery",
        candidateSummary: candidate.headline,
        decision: "rejected",
        reason: `artistName "${candidate.artistName}" is not an exact match in this cycle's batch`,
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
    if (hasSimilarItem(ctx.db, artist.id, candidate.headline)) {
      insertRunCandidate(ctx.db, {
        runId: ctx.hourlyRunId,
        stage: "discovery",
        candidateSummary: candidate.headline,
        decision: "rejected",
        reason: "an effectively identical item is already on record for this artist",
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
    accepted.push({ ...candidate, watchedArtistId: artist.id, artistName: artist.name });
  }

  ctx.logger.info("discovery", `Discovered ${accepted.length} candidate(s) (${result.candidates.length - accepted.length} rejected)`);
  return accepted;
}
