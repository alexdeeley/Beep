import { describe, it, expect } from "vitest";
import { findBannedPhrases, hasHashtag, hasEmoji, hasRhetoricalQuestion } from "../../src/newswire/writing/bannedPhrases.js";

describe("findBannedPhrases", () => {
  it("flags a known generic-AI-filler phrase", () => {
    const matches = findBannedPhrases("In a significant development, the company announced new pricing.");
    expect(matches.some((m) => m.phrase === "in a significant development")).toBe(true);
  });

  it("is case-insensitive", () => {
    const matches = findBannedPhrases("IT IS IMPORTANT TO NOTE that the numbers changed.");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("does not flag clean wire-style prose", () => {
    const matches = findBannedPhrases(
      "The White House imposed 25% tariffs on steel imports Tuesday, effective next month. Industry groups praised the move."
    );
    expect(matches).toHaveLength(0);
  });

  it("flags a rhetorical-question construction", () => {
    const matches = findBannedPhrases("Could this be the start of a wider trend? Officials have not commented.");
    expect(matches.some((m) => m.phrase.includes("rhetorical"))).toBe(true);
  });
});

describe("hasHashtag", () => {
  it("detects an inline hashtag", () => {
    expect(hasHashtag("Big news today #breaking")).toBe(true);
  });
  it("does not false-positive on a bare number sign in prose", () => {
    expect(hasHashtag("The bill, House Resolution 1234, passed 220-210.")).toBe(false);
  });
});

describe("hasEmoji", () => {
  it("detects an emoji", () => {
    expect(hasEmoji("Big news today 🔥")).toBe(true);
  });
  it("does not false-positive on plain text", () => {
    expect(hasEmoji("Officials confirmed the report Tuesday.")).toBe(false);
  });
});

describe("hasRhetoricalQuestion", () => {
  it("detects a short standalone rhetorical question", () => {
    expect(hasRhetoricalQuestion("So what does this mean for voters? Analysts are divided.")).toBe(true);
  });
  it("does not flag a direct quoted question", () => {
    expect(hasRhetoricalQuestion('The senator asked, "Where is the accountability?" during the hearing.')).toBe(false);
  });
  it("does not flag plain declarative prose with no question mark", () => {
    expect(hasRhetoricalQuestion("The vote passed 220-210 along party lines.")).toBe(false);
  });
});
