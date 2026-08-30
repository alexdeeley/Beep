import { describe, it, expect } from "vitest";
import { buildArtPrompt } from "../src/art/generateArt.js";
import type { SelectedContent, SelectedFact } from "../src/utils/types.js";

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

describe("buildArtPrompt", () => {
  it("always forbids text, letters, numbers, and recognizable faces", () => {
    const prompt = buildArtPrompt(makeSelected({ majorEvents: [makeFact({ headline: "Robinson Crusoe Published" })] }));
    expect(prompt).toMatch(/NO TEXT/);
    expect(prompt).toMatch(/NO LETTERS/);
    expect(prompt).toMatch(/NO NUMBERS/);
    expect(prompt).toMatch(/recognizable human faces/);
  });

  it("weaves the day's actual headlines into the prompt", () => {
    const prompt = buildArtPrompt(
      makeSelected({ majorEvents: [makeFact({ headline: "Guillotine Used for First Time" })] })
    );
    expect(prompt).toContain("Guillotine Used for First Time");
  });

  it("never crashes and stays text-forbidding when there is no content at all", () => {
    const prompt = buildArtPrompt(makeSelected({}));
    expect(prompt).toMatch(/NO TEXT/);
    expect(prompt.length).toBeGreaterThan(0);
  });
});
