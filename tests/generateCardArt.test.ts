import { describe, it, expect } from "vitest";
import { buildCardPrompt, buildDecadePrompt, pickWeeklyMood } from "../src/weeklyCard/generateCardArt.js";
import { pickWeeklyCard } from "../src/weeklyCard/pickCard.js";

describe("buildCardPrompt", () => {
  it("includes the drawn card's label and the notebook/scribbling premise", () => {
    const card = pickWeeklyCard("2026-09-06");
    const prompt = buildCardPrompt(card, "cold moonlight falling through a nearby window, silvery and stark");
    expect(prompt).toContain(card.label);
    expect(prompt).toMatch(/cryptic\nhandwritten scribbling/);
    expect(prompt).toMatch(/not\s+as legible real sentences/);
  });

  it("forbids real brand card-back designs and real-person likenesses, generic only", () => {
    const card = pickWeeklyCard("2026-09-06");
    const prompt = buildCardPrompt(card, "a single bare bulb overhead, harsh and slightly unflattering");
    expect(prompt).toMatch(/never a real, identifiable brand's\nactual logo, trademark, or card-back design/);
    expect(prompt).toContain("never a specific real, identifiable person");
  });

  it("includes the supplied lighting/mood text verbatim", () => {
    const card = pickWeeklyCard("2026-09-06");
    const mood = "firelight from an unseen fireplace, flickering orange across the page";
    const prompt = buildCardPrompt(card, mood);
    expect(prompt).toContain(mood);
  });
});

describe("buildDecadePrompt", () => {
  it("requires the exact phrase LIFE IS BEAUTIFUL. GOODBYE. to be legible", () => {
    const prompt = buildDecadePrompt("dawn light just beginning to touch the edge of the table");
    expect(prompt).toContain("LIFE IS BEAUTIFUL. GOODBYE.");
    expect(prompt).toMatch(/must be fully visible, clearly readable,\ncorrectly spelled/);
    expect(prompt).toMatch(/critically NOT covered, overlapped,\ncropped, or obscured/);
    expect(prompt).toMatch(/there must be only\none card in the frame/);
  });

  it("keeps the same generic-only real-brand/real-person restriction as the normal post", () => {
    const prompt = buildDecadePrompt("dawn light just beginning to touch the edge of the table");
    expect(prompt).toMatch(/never a real, identifiable brand's\nactual logo, trademark, or card-back design/);
  });

  it("asks for a calm, contemplative mood rather than alarming or graphic imagery", () => {
    const prompt = buildDecadePrompt("dawn light just beginning to touch the edge of the table");
    expect(prompt).toMatch(/not alarming or graphic, simply calm and atmospheric/);
  });
});

describe("pickWeeklyMood", () => {
  it("is deterministic - the same date always returns the same mood", () => {
    expect(pickWeeklyMood("2026-09-06")).toBe(pickWeeklyMood("2026-09-06"));
  });

  it("returns a non-empty string for any valid date", () => {
    expect(pickWeeklyMood("2026-09-06").length).toBeGreaterThan(0);
  });
});
