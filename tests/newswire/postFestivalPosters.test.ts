import { describe, it, expect } from "vitest";
import { buildPostText } from "../../src/newswire/festivalPosters/postFestivalPosters.js";
import { buildFestivalKey } from "../../src/newswire/db/festivalPostersRepo.js";
import type { VerifiedFestivalPoster } from "../../src/newswire/types.js";

function makeItem(overrides: Partial<VerifiedFestivalPoster> = {}): VerifiedFestivalPoster {
  return {
    festivalName: "Coachella",
    eventYear: 2027,
    headline: "Coachella 2027 lineup revealed",
    blurb: "Coachella 2027 lineup announced, headlined by Artist A, Artist B, and Artist C.",
    primarySourceUrl: "https://coachella.com/lineup",
    facts: [],
    meetsSourceBar: true,
    ...overrides,
  };
}

describe("buildPostText", () => {
  it("includes the festival name and year in the header", () => {
    expect(buildPostText(makeItem())).toBe(
      "FESTIVAL LINEUP: Coachella 2027\n\nCoachella 2027 lineup announced, headlined by Artist A, Artist B, and Artist C."
    );
  });

  it("omits the year when eventYear is null", () => {
    expect(buildPostText(makeItem({ eventYear: null }))).toBe(
      "FESTIVAL LINEUP: Coachella\n\nCoachella 2027 lineup announced, headlined by Artist A, Artist B, and Artist C."
    );
  });

  it("truncates an overlong blurb to stay within the 300-grapheme post limit, keeping the header intact", () => {
    const longBlurb = "A".repeat(400);
    const text = buildPostText(makeItem({ blurb: longBlurb }));
    expect([...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].length).toBeLessThanOrEqual(300);
    expect(text.startsWith("FESTIVAL LINEUP: Coachella 2027\n\n")).toBe(true);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("buildFestivalKey", () => {
  it("normalizes the festival name and includes the year", () => {
    expect(buildFestivalKey("Coachella", 2027)).toBe(buildFestivalKey("COACHELLA!!", 2027));
  });

  it("treats different years for the same festival as distinct keys", () => {
    expect(buildFestivalKey("Coachella", 2027)).not.toBe(buildFestivalKey("Coachella", 2028));
  });

  it("falls back to just the normalized name when eventYear is null", () => {
    expect(buildFestivalKey("Coachella", null)).toBe("coachella");
  });
});
