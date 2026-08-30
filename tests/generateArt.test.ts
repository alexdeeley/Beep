import { describe, it, expect } from "vitest";
import { buildArtPrompt, pickArtStyle } from "../src/art/generateArt.js";
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
  it("always forbids text, letters, and numbers, including numbers on clothing/signage", () => {
    const prompt = buildArtPrompt(
      makeSelected({ majorEvents: [makeFact({ headline: "Robinson Crusoe Published" })] }),
      "Absurdist maximalist collage"
    );
    expect(prompt).toMatch(/NO TEXT/);
    expect(prompt).toMatch(/NO LETTERS/);
    expect(prompt).toMatch(/NO NUMBERS/);
    expect(prompt).toMatch(/NO NUMBERS OR MARKS ON\s+CLOTHING, SIGNAGE, PAPER, OR MAPS/);
  });

  it("forbids any figure/character standing in for a specific real named entity, requiring symbolic objects instead", () => {
    const prompt = buildArtPrompt(makeSelected({}), "Pop-surrealist mashup poster");
    expect(prompt).toMatch(/DO NOT depict ANY\s+humanoid figure, character, or creature/);
    expect(prompt).toMatch(/Never a player or any figure wearing a\s+jersey\/uniform/);
    expect(prompt).toMatch(/animal-chase or\s+predator-and-prey pairing/);
  });

  it("weaves the day's actual headlines into the prompt as background atmosphere, not the main subject", () => {
    const prompt = buildArtPrompt(
      makeSelected({ majorEvents: [makeFact({ headline: "Guillotine Used for First Time" })] }),
      "Vintage editorial-cartoon linework"
    );
    expect(prompt).toContain("Guillotine Used for First Time");
    expect(prompt).toMatch(/never\s+as the main subject/);
  });

  it("includes the assigned style verbatim", () => {
    const prompt = buildArtPrompt(makeSelected({}), "Whimsical storybook illustration");
    expect(prompt).toContain("Whimsical storybook illustration");
  });

  it("makes the day's trending topics the literal main subject of the painting", () => {
    const prompt = buildArtPrompt(makeSelected({}), "Absurdist maximalist collage", [
      { topic: "t1", displayName: "NFL teams cut rosters", description: "", link: "" },
      { topic: "t2", displayName: "Coyote vs. Acme hits theaters", description: "", link: "" },
    ]);
    expect(prompt).toContain('"NFL teams cut rosters"');
    expect(prompt).toContain('"Coyote vs. Acme hits theaters"');
    expect(prompt).toMatch(/THE MAIN SUBJECT/);
  });

  it("degrades gracefully with no trending topics at all", () => {
    const prompt = buildArtPrompt(makeSelected({}), "Absurdist maximalist collage", []);
    expect(prompt).toContain("invent a lighthearted, gently absurd everyday scene instead");
  });

  it("never crashes and stays text-forbidding when there is no content at all", () => {
    const prompt = buildArtPrompt(makeSelected({}), "Folk-art naive painting");
    expect(prompt).toMatch(/NO TEXT/);
    expect(prompt.length).toBeGreaterThan(0);
  });
});

describe("pickArtStyle", () => {
  it("is deterministic - the same date always returns the same style", () => {
    expect(pickArtStyle("2026-07-04")).toBe(pickArtStyle("2026-07-04"));
  });

  it("never picks the same style on two consecutive calendar days", () => {
    expect(pickArtStyle("2026-07-04")).not.toBe(pickArtStyle("2026-07-05"));
    expect(pickArtStyle("2026-12-31")).not.toBe(pickArtStyle("2027-01-01"));
  });

  it("cycles through every style before repeating any", () => {
    const seenOnFirstCycle = new Set<string>();
    let date = new Date("2026-01-01T00:00:00Z");
    let firstRepeatAt = -1;
    for (let i = 0; i < 100; i++) {
      const iso = date.toISOString().slice(0, 10);
      const style = pickArtStyle(iso);
      if (seenOnFirstCycle.has(style)) {
        firstRepeatAt = i;
        break;
      }
      seenOnFirstCycle.add(style);
      date = new Date(date.getTime() + 86_400_000);
    }
    // The first repeat must not happen until every distinct style has been used at least once.
    expect(firstRepeatAt).toBe(seenOnFirstCycle.size);
  });
});
