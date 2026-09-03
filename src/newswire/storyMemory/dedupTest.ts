import type { StoryEventRow } from "../db/storiesRepo.js";
import type { VerifiedFact } from "../types.js";

/** Lowercases, strips punctuation, and splits into a set of significant words (drops very short stopword-ish tokens). */
function tokenize(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
  return new Set(words);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Structural "is this fact already known" test: pure word-overlap
 * similarity between a candidate fact's claim text and each existing
 * story event's summary for the same story. This is deliberately a
 * blunt, fast, pre-filter - it exists to stop the pipeline from
 * re-recording literally-restated facts as new events, not to make
 * subtle editorial judgment calls (that's the writer/duplicateCheck
 * stages' job, working from genuinely-new events this test lets through).
 */
export function isFactAlreadyKnown(existingEvents: StoryEventRow[], fact: VerifiedFact, threshold = 0.6): boolean {
  const factTokens = tokenize(fact.claim);
  return existingEvents.some((event) => jaccardSimilarity(factTokens, tokenize(event.summary)) >= threshold);
}

/** Filters a fact list down to only those not already recorded for the story - the input to what gets written as new story_events. */
export function filterNewFacts(existingEvents: StoryEventRow[], facts: VerifiedFact[]): VerifiedFact[] {
  return facts.filter((fact) => !isFactAlreadyKnown(existingEvents, fact));
}
