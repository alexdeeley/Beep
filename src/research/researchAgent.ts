import type { AppConfig } from "../config/index.js";
import type { RunLogger } from "../utils/logger.js";
import { makeOpenAIClient, requestJson, MissingApiKeyError } from "../utils/openaiClient.js";
import type { CandidateFact } from "../utils/types.js";
import { RESEARCH_SYSTEM_PROMPT, buildResearchUserPrompt } from "./prompts.js";

export interface ResearchOutput {
  date: string; // MM-DD
  candidates: CandidateFact[];
  generatedAt: string;
  model: string;
}

interface RawResearchResponse {
  date: string;
  candidates: CandidateFact[];
}

/**
 * Stage 1: broad research. Deliberately over-collects (20-40 candidates)
 * so the verification and selection stages have real material to choose
 * from and reject weak/unconfirmed items without starving the final
 * layout.
 */
export async function researchDate(
  config: AppConfig,
  logger: RunLogger,
  monthDay: string,
  displayDate: string
): Promise<ResearchOutput> {
  const client = makeOpenAIClient(config);
  if (!client) throw new MissingApiKeyError("research");

  logger.info("research", `Requesting candidate facts for ${displayDate}`, {
    minCandidates: config.research.minCandidates,
    maxCandidates: config.research.maxCandidates,
  });

  const user = buildResearchUserPrompt({
    monthDay,
    displayDate,
    minCandidates: config.research.minCandidates,
    maxCandidates: config.research.maxCandidates,
  });

  const system = RESEARCH_SYSTEM_PROMPT.replace(
    "{minCandidates}",
    String(config.research.minCandidates)
  ).replace("{maxCandidates}", String(config.research.maxCandidates));

  const raw = await requestJson<RawResearchResponse>(client, {
    model: config.researchModel,
    system,
    user,
    temperature: 0.6,
    maxOutputTokens: 8192,
  });

  const candidates = normalizeCandidates(raw.candidates ?? []);

  logger.info("research", `Received ${candidates.length} candidate facts`);

  return {
    date: monthDay,
    candidates,
    generatedAt: new Date().toISOString(),
    model: config.researchModel,
  };
}

function normalizeCandidates(candidates: CandidateFact[]): CandidateFact[] {
  return candidates
    .filter((c) => c && c.headline && c.year)
    .map((c, i) => ({
      ...c,
      id: c.id || `c${String(i + 1).padStart(3, "0")}`,
      people: Array.isArray(c.people) ? c.people : [],
      sources: Array.isArray(c.sources) ? c.sources : [],
      confidence: clamp01(c.confidence),
      verificationStatus: "unverified" as const,
    }));
}

function clamp01(n: number): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}
