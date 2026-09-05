import { DateTime } from "luxon";
import { requestJsonWithWebSearch } from "../../utils/openaiClient.js";
import { insertRunCandidate } from "../db/researchRunsRepo.js";
import type { NewsRunContext } from "../runContext.js";
import type { BirthDateCandidate, VerifiedBirthDate, VerifiedFact } from "../types.js";
import { buildVerificationSystemPrompt, verificationJsonSchema } from "./prompts.js";

interface RawVerificationResult {
  facts: VerifiedFact[];
}

/** Same reasoning as the other per-candidate verification caps - one live web-search call per candidate. */
const MAX_CANDIDATES_TO_VERIFY = 10;

function buildBirthDateVerificationUserPrompt(artistName: string, birthMonth: number, birthDay: number, birthYear: number | null): string {
  const claimed = birthYear ? `${birthMonth}/${birthDay}/${birthYear}` : `${birthMonth}/${birthDay} (year unconfirmed)`;
  return [
    `Claimed date of birth (from discovery, UNVERIFIED): ${artistName} was born on ${claimed}.`,
    "",
    "Independently research this via web search and report your own findings as structured facts. Report the birth date as a single",
    "fact with eventTimeIso set to the full date in YYYY-MM-DD form (using year 1 as a placeholder is NOT acceptable - if you cannot",
    "confirm the year, still report the month and day you found via eventTimeIso using the year you found, or the claimed year if it",
    "independently checks out; if the year itself cannot be confirmed, say so in the claim text and set eventTimeConfidence to",
    '"approximate" rather than "exact").',
  ].join("\n");
}

/**
 * Independently re-verifies discoverBirthDates's candidates - same
 * 2-corroborating-source rule as the rest of the pipeline. Extracts the
 * confirmed month/day/year from the verified fact's eventTimeIso rather
 * than trusting discovery's own numbers.
 */
export async function verifyBirthDates(ctx: NewsRunContext, candidates: BirthDateCandidate[]): Promise<VerifiedBirthDate[]> {
  const toVerify = candidates.slice(0, MAX_CANDIDATES_TO_VERIFY);
  if (candidates.length > toVerify.length) {
    ctx.logger.info("birthdate-verification", `Capping verification to ${toVerify.length} of ${candidates.length} candidate(s)`);
  }

  const tierList = ctx.editorialFocus.sourceTiers;
  const results: VerifiedBirthDate[] = [];

  for (const candidate of toVerify) {
    if (candidate.birthMonth === null || candidate.birthDay === null) continue;

    let verified: VerifiedBirthDate;
    try {
      const response = await requestJsonWithWebSearch<RawVerificationResult>(ctx.openai, {
        model: ctx.config.news.verificationModel,
        system: buildVerificationSystemPrompt(tierList, ctx.editorialFocus.entertainmentTradePublishers),
        user: buildBirthDateVerificationUserPrompt(candidate.artistName, candidate.birthMonth, candidate.birthDay, candidate.birthYear),
        jsonSchemaName: "verification_result",
        jsonSchema: verificationJsonSchema(tierList),
        maxOutputTokens: 4096,
      });

      const distinctDomains = new Set<string>();
      for (const fact of response.data.facts) {
        for (const source of fact.sources) distinctDomains.add(source.domain.toLowerCase());
      }

      const primaryFact = response.data.facts.find((f) => f.sources.some((s) => s.isPrimary)) ?? response.data.facts[0];
      const parsed = primaryFact?.eventTimeIso ? DateTime.fromISO(primaryFact.eventTimeIso) : null;
      const monthDayConfirmed = parsed?.isValid && parsed.month === candidate.birthMonth && parsed.day === candidate.birthDay;

      verified = {
        watchedArtistId: candidate.watchedArtistId,
        artistName: candidate.artistName,
        birthMonth: monthDayConfirmed ? candidate.birthMonth : null,
        birthDay: monthDayConfirmed ? candidate.birthDay : null,
        birthYear: monthDayConfirmed && primaryFact?.eventTimeConfidence === "exact" ? (parsed!.year ?? null) : null,
        facts: response.data.facts,
        meetsSourceBar: Boolean(monthDayConfirmed) && response.data.facts.length > 0 && distinctDomains.size >= 2,
      };
    } catch (err) {
      ctx.logger.warn("birthdate-verification", `Verification failed for "${candidate.artistName}", dropping it`, {
        error: err instanceof Error ? err.message : String(err),
      });
      insertRunCandidate(ctx.db, {
        runId: ctx.hourlyRunId,
        stage: "birthdate-verification",
        candidateSummary: candidate.artistName,
        decision: "rejected",
        reason: `verification request failed: ${err instanceof Error ? err.message : String(err)}`,
        storyId: null,
      });
      continue;
    }

    insertRunCandidate(ctx.db, {
      runId: ctx.hourlyRunId,
      stage: "birthdate-verification",
      candidateSummary: candidate.artistName,
      decision: verified.meetsSourceBar ? "accepted" : "rejected",
      reason: verified.meetsSourceBar ? null : "date not independently confirmed, or fewer than 2 corroborating source domains",
      storyId: null,
    });

    if (verified.meetsSourceBar) results.push(verified);
  }

  ctx.logger.info(
    "birthdate-verification",
    `Verified ${results.length} of ${toVerify.length} birth date candidate(s) meeting the independent-source bar`
  );
  return results;
}
