import type { AppConfig } from "../config/index.js";
import type { RunLogger } from "../utils/logger.js";
import { makeOpenAIClient, requestJson, MissingApiKeyError } from "../utils/openaiClient.js";
import type { CandidateFact, VerifiedFact } from "../utils/types.js";
import { VERIFICATION_SYSTEM_PROMPT, buildVerificationUserPrompt } from "./prompts.js";

export interface VerificationOutput {
  date: string;
  verified: VerifiedFact[];
  generatedAt: string;
  model: string;
  summary: { verifiedCount: number; rejectedCount: number; needsReviewCount: number };
}

interface RawVerificationResponse {
  verified: VerifiedFact[];
}

const BATCH_SIZE = 12;

/**
 * Stage 2: independent, strict re-verification. Treats the research
 * stage as untrusted. Runs in batches (rather than one giant call) so a
 * large candidate pool doesn't get truncated by output-token limits, and
 * so a parsing failure on one batch doesn't discard the whole day's
 * research.
 */
export async function verifyCandidates(
  config: AppConfig,
  logger: RunLogger,
  displayDate: string,
  monthDay: string,
  candidates: CandidateFact[]
): Promise<VerificationOutput> {
  const client = makeOpenAIClient(config);
  if (!client) throw new MissingApiKeyError("verification");

  const batches = chunk(candidates, BATCH_SIZE);
  logger.info("verification", `Verifying ${candidates.length} candidates in ${batches.length} batch(es)`);

  const results: VerifiedFact[] = [];
  for (const [i, batch] of batches.entries()) {
    const user = buildVerificationUserPrompt({
      displayDate,
      candidatesJson: JSON.stringify(batch, null, 2),
    });
    try {
      const raw = await requestJson<RawVerificationResponse>(client, {
        model: config.verificationModel,
        system: VERIFICATION_SYSTEM_PROMPT,
        user,
        temperature: 0.1,
        maxOutputTokens: 8192,
      });
      results.push(...applyProgrammaticGate(config, normalizeVerified(batch, raw.verified ?? [])));
    } catch (err) {
      logger.error("verification", `Batch ${i + 1}/${batches.length} failed to verify; rejecting its candidates`, {
        error: err instanceof Error ? err.message : String(err),
      });
      // Fail closed: if we cannot verify a batch, we do not trust it.
      results.push(...batch.map((c) => rejectDueToError(c)));
    }
  }

  const summary = {
    verifiedCount: results.filter((r) => r.verificationStatus === "verified").length,
    rejectedCount: results.filter((r) => r.verificationStatus === "rejected").length,
    needsReviewCount: results.filter((r) => r.verificationStatus === "needs_review").length,
  };

  logger.info("verification", "Verification complete", summary);

  return {
    date: monthDay,
    verified: results,
    generatedAt: new Date().toISOString(),
    model: config.verificationModel,
    summary,
  };
}

/**
 * The verifier LLM's own "verified" label is necessary but not
 * sufficient. We additionally enforce the operator-configured minimum
 * confidence and minimum authoritative-source count here in code, so
 * publishing thresholds are not solely at the mercy of a prompt.
 */
export function applyProgrammaticGate(config: AppConfig, facts: VerifiedFact[]): VerifiedFact[] {
  return facts.map((f) => {
    if (f.verificationStatus !== "verified") return f;

    const authoritativeCount = f.sources.filter((s) => s.authoritative).length;
    const reasons: string[] = [];

    if (f.verificationConfidence < config.selection.minVerificationConfidence) {
      reasons.push(
        `verificationConfidence ${f.verificationConfidence} below threshold ${config.selection.minVerificationConfidence}`
      );
    }
    if (
      f.historicalImportance === "high" &&
      authoritativeCount < config.selection.minAuthoritativeSources
    ) {
      reasons.push(
        `only ${authoritativeCount} authoritative source(s), below threshold ${config.selection.minAuthoritativeSources} for a high-importance item`
      );
    }
    if (!f.checks.dateConfirmed || !f.checks.yearConfirmed || !f.checks.kindConfirmed || !f.checks.notPublicationDateConfusion) {
      reasons.push("one or more required checks failed despite an overall 'verified' label");
    }

    if (reasons.length > 0) {
      return {
        ...f,
        verificationStatus: "needs_review" as const,
        rejectionReason: null,
        verifierNotes: `${f.verifierNotes} [Downgraded by programmatic gate: ${reasons.join("; ")}]`,
      };
    }
    return f;
  });
}

function normalizeVerified(originals: CandidateFact[], verified: VerifiedFact[]): VerifiedFact[] {
  const byId = new Map(originals.map((o) => [o.id, o]));
  return verified
    .filter((v) => v && v.id && byId.has(v.id))
    .map((v) => {
      const original = byId.get(v.id)!;
      return {
        ...original,
        ...v,
        sources: Array.isArray(v.sources) && v.sources.length > 0 ? v.sources : original.sources,
      };
    });
}

function rejectDueToError(c: CandidateFact): VerifiedFact {
  return {
    ...c,
    verificationStatus: "rejected",
    verificationConfidence: 0,
    verifierNotes: "Verification call failed; rejected by fail-closed policy.",
    checks: {
      dateConfirmed: false,
      yearConfirmed: false,
      personOrOrgConfirmed: false,
      kindConfirmed: false,
      notPublicationDateConfusion: false,
      notExaggerated: false,
      sufficientlyNotable: false,
      corroboratingSources: false,
    },
    rejectionReason: "Verification process error",
  };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
