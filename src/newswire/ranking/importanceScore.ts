import type { SourceTier } from "../db/sourcesRepo.js";
import type { FactLabel } from "../types.js";

/**
 * Pure, deterministic importance scoring. Deliberately NOT "how many
 * outlets cover this" - outlet count measures syndication reach, not
 * editorial significance, and would just reward whichever story a wire
 * service happened to blast out widest. Instead this scores structural
 * signals: how authoritative the actual sources are, how factually
 * settled the claims are, how directly it matches what the reader said
 * they care about, whether it's freshly happening vs. stale, and whether
 * it continues an already-significant story.
 */

const SOURCE_TIER_WEIGHT: Record<SourceTier, number> = {
  primary_official: 1.0,
  court_filing: 1.0,
  company_statement: 0.8,
  entertainment_trade: 0.75,
  wire_service: 0.7,
  general_news: 0.55,
  aggregator: 0.3,
  blog_social: 0.2,
};

const FACT_LABEL_WEIGHT: Record<FactLabel, number> = {
  FACT: 1.0,
  ANALYSIS: 0.6,
  BACKGROUND: 0.4,
  UNCONFIRMED: 0.3,
  PREDICTION: 0.35,
};

export interface ImportanceScoreInput {
  /** From editorial-focus.json priorityTopics[].weight, 0-1. */
  topicWeight: number;
  /** Every source tier cited across this cluster's facts. */
  sourceTiers: SourceTier[];
  factLabels: FactLabel[];
  /** True if this continues an existing open story rather than starting a new one. */
  isContinuation: boolean;
  /** The continued story's current importance score, if isContinuation. */
  parentStoryImportance: number | null;
  /** True if a specific entry in editorial-focus.json's `watch` list is directly involved. */
  watchListMatch: boolean;
  /** Hours since the earliest event_time among this cluster's facts; null if all unknown. */
  eventAgeHours: number | null;
  /** Number of independent corroborating source domains (already gated at >=2 by verification, but more is stronger). */
  distinctSourceDomains: number;
}

export function computeImportanceScore(input: ImportanceScoreInput): number {
  const bestSourceTier = input.sourceTiers.length
    ? Math.max(...input.sourceTiers.map((t) => SOURCE_TIER_WEIGHT[t] ?? 0.3))
    : 0.3;
  const bestFactLabel = input.factLabels.length ? Math.max(...input.factLabels.map((f) => FACT_LABEL_WEIGHT[f] ?? 0.3)) : 0.3;

  const recencyScore =
    input.eventAgeHours === null ? 0.5 : input.eventAgeHours <= 1 ? 1.0 : input.eventAgeHours <= 6 ? 0.8 : input.eventAgeHours <= 24 ? 0.5 : 0.25;

  const corroborationScore = Math.min(1, 0.5 + (input.distinctSourceDomains - 2) * 0.15);

  let score =
    0.3 * input.topicWeight +
    0.2 * bestSourceTier +
    0.15 * bestFactLabel +
    0.15 * recencyScore +
    0.1 * corroborationScore +
    (input.watchListMatch ? 0.1 : 0);

  if (input.isContinuation && input.parentStoryImportance !== null) {
    // A development on an already-important story inherits some of that weight, rather than scoring purely as its own small update.
    score = Math.max(score, 0.4 * score + 0.6 * input.parentStoryImportance);
  }

  return Math.max(0, Math.min(1, score));
}
