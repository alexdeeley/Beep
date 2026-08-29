import { describe, it, expect } from "vitest";
import { truncateWords, enforceHeadlineLimit, enforceDescriptionLimit, MAX_HEADLINE_WORDS, MAX_DESCRIPTION_WORDS } from "../src/utils/textLimits.js";

describe("truncateWords", () => {
  it("leaves short text untouched", () => {
    expect(truncateWords("Gemini V Splashes Down", 12)).toBe("Gemini V Splashes Down");
  });

  it("truncates long text at a word boundary with an ellipsis", () => {
    const text = "one two three four five six";
    const result = truncateWords(text, 3);
    expect(result).toBe("one two three…");
  });

  it("never cuts a word in half", () => {
    const text = "supercalifragilisticexpialidocious another word here";
    const result = truncateWords(text, 1);
    expect(result.replace("…", "")).toBe("supercalifragilisticexpialidocious");
  });
});

describe("enforceHeadlineLimit / enforceDescriptionLimit", () => {
  it("caps headlines at MAX_HEADLINE_WORDS", () => {
    const words = Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ");
    const result = enforceHeadlineLimit(words);
    expect(result.replace("…", "").split(" ").length).toBe(MAX_HEADLINE_WORDS);
  });

  it("caps descriptions at MAX_DESCRIPTION_WORDS", () => {
    const words = Array.from({ length: 200 }, (_, i) => `w${i}`).join(" ");
    const result = enforceDescriptionLimit(words);
    expect(result.replace("…", "").split(" ").length).toBe(MAX_DESCRIPTION_WORDS);
  });
});
