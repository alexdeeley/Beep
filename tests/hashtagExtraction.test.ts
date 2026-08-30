import { describe, it, expect } from "vitest";
import { deriveContentHashtags, phraseToTag } from "../src/caption/hashtagExtraction.js";
import { selectBlueskyTags } from "../src/bluesky/publish.js";
import type { SelectedContent, SelectedFact } from "../src/utils/types.js";

describe("phraseToTag", () => {
  it("PascalCases a multi-word news-style phrase into a bare tag, stripping stopwords", () => {
    expect(phraseToTag("Military officials warn on Trump readiness", 4)).toBe("MilitaryOfficialsWarnTrump");
  });

  it("respects a custom maxWords cap", () => {
    expect(phraseToTag("NFL teams cut rosters to fifty three", 3)).toBe("NFLTeamsCut");
  });

  it("falls back to the raw words when every word is a stopword", () => {
    expect(phraseToTag("of the and", 3)).toBe("OfTheAnd");
  });

  it("returns null for an empty or whitespace-only phrase", () => {
    expect(phraseToTag("", 3)).toBeNull();
    expect(phraseToTag("   ", 3)).toBeNull();
  });
});

function makeFact(overrides: Partial<SelectedFact>): SelectedFact {
  return {
    id: overrides.id ?? "c" + Math.random().toString(36).slice(2),
    kind: "event",
    monthDay: "08-29",
    year: 1965,
    category: "space_exploration",
    headline: "Some Event Happens",
    description: "A description.",
    people: [],
    location: null,
    historicalImportance: "medium",
    sources: [],
    confidence: 0.9,
    notes: "",
    primarySource: true,
    verificationStatus: "verified",
    verificationConfidence: 0.9,
    verifierNotes: "",
    checks: {
      dateConfirmed: true,
      yearConfirmed: true,
      personOrOrgConfirmed: true,
      kindConfirmed: true,
      notPublicationDateConfusion: true,
      notExaggerated: true,
      sufficientlyNotable: true,
      corroboratingSources: true,
      headlineMatchesDescription: true,
      categoryMatchesContent: true,
    },
    rejectionReason: null,
    selectionScore: 5,
    anniversaryYears: null,
    ...overrides,
  };
}

function makeSelected(overrides: Partial<SelectedContent>): SelectedContent {
  return {
    date: "2026-08-29",
    monthDay: "08-29",
    displayDate: "AUGUST 29",
    subtitle: "",
    majorEvents: [],
    births: [],
    deaths: [],
    incidents: [],
    sourceCreditLine: "",
    theme: "classic_gold",
    ...overrides,
  };
}

describe("deriveContentHashtags", () => {
  it("turns a person's name into a PascalCase tag with no spaces", () => {
    const selected = makeSelected({
      births: [makeFact({ kind: "birth", category: "birth", people: ["Charlie Parker"], selectionScore: 9 })],
    });
    expect(deriveContentHashtags(selected)).toContain("CharlieParker");
  });

  it("orders tags by each fact's own selectionScore, highest first", () => {
    const selected = makeSelected({
      majorEvents: [
        makeFact({ id: "low", people: ["Low Importance Person"], selectionScore: 1 }),
        makeFact({ id: "high", people: ["High Importance Person"], selectionScore: 9 }),
      ],
    });
    const tags = deriveContentHashtags(selected);
    expect(tags.indexOf("HighImportancePerson")).toBeLessThan(tags.indexOf("LowImportancePerson"));
  });

  it("falls back to a headline-derived phrase when there is no named person", () => {
    const selected = makeSelected({
      majorEvents: [makeFact({ people: [], headline: "Netflix Is Founded", location: null })],
    });
    expect(deriveContentHashtags(selected)).toContain("NetflixFounded");
  });

  it("extracts the most specific (first) segment of a location", () => {
    const selected = makeSelected({
      majorEvents: [makeFact({ people: [], location: "Manassas, Virginia, USA" })],
    });
    expect(deriveContentHashtags(selected)).toContain("Manassas");
  });

  it("adds one category tag per distinct category, not per item", () => {
    const selected = makeSelected({
      majorEvents: [
        makeFact({ id: "a", category: "war_conflict", people: ["Person A"] }),
        makeFact({ id: "b", category: "war_conflict", people: ["Person B"] }),
      ],
    });
    const tags = deriveContentHashtags(selected);
    expect(tags.filter((t) => t === "War").length).toBe(1);
  });

  it("skips stopwords when building a headline phrase tag", () => {
    const selected = makeSelected({
      majorEvents: [makeFact({ people: [], headline: "The Treaty of Nanking Signed", location: null })],
    });
    const tags = deriveContentHashtags(selected);
    // Should not literally include "The" or "of" as their own tokens inside the phrase.
    expect(tags.some((t) => /^(The|Of)$/.test(t))).toBe(false);
  });
});

describe("deriveContentHashtags -> selectBlueskyTags integration", () => {
  it("a content-rich day fills all 8 slots with story-specific tags before any generic filler", () => {
    const selected = makeSelected({
      majorEvents: [
        makeFact({ id: "e1", people: ["Person One"], location: "CityOne, CountryOne", category: "war_conflict", selectionScore: 9 }),
        makeFact({ id: "e2", people: ["Person Two"], location: "CityTwo, CountryTwo", category: "music", selectionScore: 8 }),
      ],
      births: [makeFact({ id: "b1", kind: "birth", category: "birth", people: ["Person Three"], selectionScore: 7 })],
      deaths: [makeFact({ id: "d1", kind: "death", category: "death", people: ["Person Four"], selectionScore: 6 })],
    });
    const contentTags = deriveContentHashtags(selected);
    const finalTags = selectBlueskyTags([...contentTags, "OnThisDay", "History", "Past", "TodayInHistory"]);
    expect(finalTags.length).toBe(8);
    // The 4 person names (the most specific, highest-value tags) must all have made it in.
    expect(finalTags).toEqual(expect.arrayContaining(["PersonOne", "PersonTwo", "PersonThree", "PersonFour"]));
  });
});
