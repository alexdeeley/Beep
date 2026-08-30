import { describe, it, expect } from "vitest";
import { buildArtPrompt, pickDailyEnvironment } from "../src/art/generateArt.js";
import type { CuratedTrendItem } from "../src/art/trendCuration.js";
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

function makeTrendItem(overrides: Partial<CuratedTrendItem>): CuratedTrendItem {
  return {
    topic: "Some Trending Topic",
    significance: "It's widely discussed.",
    peopleInvolved: [],
    visualHooks: [],
    humorPotential: "",
    ...overrides,
  };
}

describe("buildArtPrompt", () => {
  it("allows short intentional text but still forbids the real logo/copyrighted-character rule", () => {
    const prompt = buildArtPrompt(
      makeSelected({ majorEvents: [makeFact({ headline: "Robinson Crusoe Published" })] }),
      "a crowded, chaotic city street"
    );
    expect(prompt).toMatch(/keep\s+it extremely short/);
    expect(prompt).toMatch(/never depict their actual logo, trademark/);
  });

  it("forbids any recognizable likeness of a real named person, requiring a generic figure instead", () => {
    const prompt = buildArtPrompt(makeSelected({}), "a bustling newsroom");
    expect(prompt).toMatch(/do NOT depict their\nactual recognizable likeness, face, or identifiable caricature - use a\ngeneric, anonymous figure instead/);
  });

  it("weaves the day's actual headlines into the prompt as background atmosphere, not the main subject", () => {
    const prompt = buildArtPrompt(
      makeSelected({ majorEvents: [makeFact({ headline: "Guillotine Used for First Time" })] }),
      "a dramatic courtroom"
    );
    expect(prompt).toContain("Guillotine Used for First Time");
    expect(prompt).toMatch(/purely as atmosphere/);
  });

  it("includes today's assigned environment verbatim", () => {
    const prompt = buildArtPrompt(makeSelected({}), "a fantastical dreamlike landscape");
    expect(prompt).toContain("Today's setting: a fantastical dreamlike landscape");
  });

  it("includes the curated trend package - topic, significance, people, visual hooks, humor angle", () => {
    const prompt = buildArtPrompt(makeSelected({}), "a carnival midway", [
      makeTrendItem({
        topic: "NFL teams cut rosters",
        significance: "Roster deadlines just passed.",
        peopleInvolved: ["Commissioner Roger Goodell"],
        visualHooks: ["a locker room", "a giant scissors"],
        humorPotential: "A comically oversized cut.",
      }),
    ]);
    expect(prompt).toContain("NFL teams cut rosters");
    expect(prompt).toContain("Roster deadlines just passed.");
    expect(prompt).toContain("Commissioner Roger Goodell");
    expect(prompt).toContain("a locker room");
    expect(prompt).toContain("A comically oversized cut.");
  });

  it("degrades gracefully with no curated trends at all", () => {
    const prompt = buildArtPrompt(makeSelected({}), "a busy train station", []);
    expect(prompt).toContain("invent a lighthearted, gently absurd everyday scene instead");
  });

  it("never crashes with no content at all", () => {
    const prompt = buildArtPrompt(makeSelected({}), "a strange civic plaza");
    expect(prompt.length).toBeGreaterThan(0);
  });
});

describe("pickDailyEnvironment", () => {
  it("is deterministic - the same date always returns the same environment", () => {
    expect(pickDailyEnvironment("2026-07-04")).toBe(pickDailyEnvironment("2026-07-04"));
  });

  it("never picks the same environment on two consecutive calendar days", () => {
    expect(pickDailyEnvironment("2026-07-04")).not.toBe(pickDailyEnvironment("2026-07-05"));
    expect(pickDailyEnvironment("2026-12-31")).not.toBe(pickDailyEnvironment("2027-01-01"));
  });

  it("cycles through every environment before repeating any", () => {
    const seenOnFirstCycle = new Set<string>();
    let date = new Date("2026-01-01T00:00:00Z");
    let firstRepeatAt = -1;
    for (let i = 0; i < 100; i++) {
      const iso = date.toISOString().slice(0, 10);
      const env = pickDailyEnvironment(iso);
      if (seenOnFirstCycle.has(env)) {
        firstRepeatAt = i;
        break;
      }
      seenOnFirstCycle.add(env);
      date = new Date(date.getTime() + 86_400_000);
    }
    // The first repeat must not happen until every distinct environment has been used at least once.
    expect(firstRepeatAt).toBe(seenOnFirstCycle.size);
  });
});
