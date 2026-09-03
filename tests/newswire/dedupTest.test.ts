import { describe, it, expect } from "vitest";
import { isFactAlreadyKnown, filterNewFacts } from "../../src/newswire/storyMemory/dedupTest.js";
import type { StoryEventRow } from "../../src/newswire/db/storiesRepo.js";
import type { VerifiedFact } from "../../src/newswire/types.js";

function event(summary: string): StoryEventRow {
  return {
    id: 1,
    story_id: 1,
    summary,
    event_time: null,
    event_time_confidence: "unknown",
    article_published_at: null,
    fact_label: "FACT",
    is_correction: 0,
    corrects_event_id: null,
    discovered_in_run_id: 1,
    posted_in_run_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

function fact(claim: string): VerifiedFact {
  return {
    claim,
    factLabel: "FACT",
    eventTimeIso: null,
    eventTimeConfidence: "unknown",
    articlePublishedAtIso: null,
    sources: [],
  };
}

describe("isFactAlreadyKnown", () => {
  it("treats an exact restatement as already known", () => {
    const existing = [event("The administration announced 25% tariffs on steel imports effective next month.")];
    expect(isFactAlreadyKnown(existing, fact("The administration announced 25% tariffs on steel imports effective next month."))).toBe(
      true
    );
  });

  it("treats a near-identical restatement (reworded, same facts) as already known", () => {
    const existing = [event("Officials reported 12 people missing after the building collapse.")];
    expect(isFactAlreadyKnown(existing, fact("12 people were reported missing after the building collapse, officials said."))).toBe(
      true
    );
  });

  it("treats a genuinely new development as not already known", () => {
    const existing = [event("Officials reported 12 people missing after the building collapse.")];
    expect(
      isFactAlreadyKnown(existing, fact("Rescue crews pulled two survivors from the rubble overnight, fire officials said."))
    ).toBe(false);
  });

  it("treats a correction (contradicting figure) as not already known - it's new information, not a repeat", () => {
    const existing = [event("Officials reported 12 people missing after the building collapse.")];
    expect(isFactAlreadyKnown(existing, fact("Officials revised the missing count down to 3 after 9 were found safe."))).toBe(false);
  });

  it("returns false against an empty existing-events list", () => {
    expect(isFactAlreadyKnown([], fact("Anything at all."))).toBe(false);
  });
});

describe("filterNewFacts", () => {
  it("filters out only the facts that are already known, keeping the rest", () => {
    const existing = [event("The administration announced 25% tariffs on steel imports effective next month.")];
    const facts = [
      fact("The administration announced 25% tariffs on steel imports effective next month."),
      fact("Steel industry trade groups praised the new tariffs, saying it will protect domestic jobs."),
    ];
    const result = filterNewFacts(existing, facts);
    expect(result).toHaveLength(1);
    expect(result[0]?.claim).toContain("trade groups praised");
  });

  it("keeps everything when nothing is already known", () => {
    const facts = [fact("Something new happened."), fact("Something else new happened.")];
    expect(filterNewFacts([], facts)).toHaveLength(2);
  });
});
