import { requestJsonWithWebSearch } from "../../utils/openaiClient.js";
import { insertRunCandidate } from "../db/researchRunsRepo.js";
import type { WatchedArtistRow } from "../db/watchedArtistsRepo.js";
import type { NewsRunContext } from "../runContext.js";
import type { BirthDateCandidate } from "../types.js";
import { buildBirthDateDiscoverySystemPrompt, buildBirthDateDiscoveryUserPrompt, BIRTH_DATE_DISCOVERY_JSON_SCHEMA } from "./birthDatePrompts.js";

interface RawArtist {
  artistName: string;
  birthYear: number | null;
  birthMonth: number | null;
  birthDay: number | null;
  sources: { url: string; title: string; domain: string }[];
}

interface RawDiscoveryResult {
  artists: RawArtist[];
}

/**
 * One web-search sweep resolving birth dates for a batch of watchlist
 * artists that have never been checked (see
 * watchedArtistsRepo.ts's getArtistsNeedingBirthDateCheck) - a one-time
 * lookup per artist, not a recurring check. Errors are caught and logged
 * rather than thrown: a hiccup here must never sink the rest of the
 * cycle, it just means this batch's birth dates stay unresolved and get
 * retried next cycle.
 */
export async function discoverBirthDates(ctx: NewsRunContext, batch: WatchedArtistRow[]): Promise<BirthDateCandidate[]> {
  if (batch.length === 0) return [];

  const byName = new Map(batch.map((a) => [a.name, a] as const));
  ctx.logger.info("birthdate-discovery", `Starting birth-date discovery sweep across ${batch.length} watchlist artist(s)`);

  let result: RawDiscoveryResult;
  try {
    const response = await requestJsonWithWebSearch<RawDiscoveryResult>(ctx.openai, {
      model: ctx.config.news.discoveryModel,
      system: buildBirthDateDiscoverySystemPrompt(),
      user: buildBirthDateDiscoveryUserPrompt(batch.map((a) => a.name)),
      jsonSchemaName: "birth_date_discovery_result",
      jsonSchema: BIRTH_DATE_DISCOVERY_JSON_SCHEMA,
      maxOutputTokens: 8192,
    });
    result = response.data;
    ctx.logger.info("birthdate-discovery", `Model performed ${response.searchCount} search(es)`, { queries: response.searchQueries });
  } catch (err) {
    ctx.logger.error("birthdate-discovery", "Birth-date discovery request failed - this batch's birth dates stay unresolved", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const accepted: BirthDateCandidate[] = [];
  for (const artist of result.artists) {
    const matched = byName.get(artist.artistName);
    if (!matched) {
      insertRunCandidate(ctx.db, {
        runId: ctx.hourlyRunId,
        stage: "birthdate-discovery",
        candidateSummary: artist.artistName,
        decision: "rejected",
        reason: `artistName "${artist.artistName}" is not an exact match in this cycle's batch`,
        storyId: null,
      });
      continue;
    }
    if (artist.sources.length === 0 || artist.birthMonth === null || artist.birthDay === null) {
      insertRunCandidate(ctx.db, {
        runId: ctx.hourlyRunId,
        stage: "birthdate-discovery",
        candidateSummary: artist.artistName,
        decision: "rejected",
        reason: "no sources reported, or month/day not confirmed",
        storyId: null,
      });
      continue;
    }

    insertRunCandidate(ctx.db, {
      runId: ctx.hourlyRunId,
      stage: "birthdate-discovery",
      candidateSummary: artist.artistName,
      decision: "accepted",
      reason: null,
      storyId: null,
    });
    accepted.push({
      watchedArtistId: matched.id,
      artistName: matched.name,
      birthYear: artist.birthYear,
      birthMonth: artist.birthMonth,
      birthDay: artist.birthDay,
      sources: artist.sources,
    });
  }

  ctx.logger.info(
    "birthdate-discovery",
    `Discovered ${accepted.length} birth date(s) (${result.artists.length - accepted.length} rejected/unmatched)`
  );
  return accepted;
}
