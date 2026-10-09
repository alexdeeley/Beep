import { describe, it, expect } from "vitest";
import { buildAltText } from "../../src/newswire/festivalPosters/postFestivalPosters.js";
import { buildFestivalKey, buildThrowbackKey } from "../../src/newswire/db/festivalPostersRepo.js";
import type { VerifiedFestivalPoster } from "../../src/newswire/types.js";

function makeItem(overrides: Partial<VerifiedFestivalPoster> = {}): VerifiedFestivalPoster {
  return {
    festivalName: "Coachella",
    eventYear: 2027,
    headline: "Coachella 2027 lineup revealed",
    blurb: "Coachella 2027 lineup announced, headlined by Artist A, Artist B, and Artist C.",
    lineupArtists: ["Artist A", "Artist B", "Artist C"],
    primarySourceUrl: "https://coachella.com/lineup",
    facts: [],
    meetsSourceBar: true,
    ...overrides,
  };
}

describe("buildAltText", () => {
  it("includes the festival name and year in the header", () => {
    expect(buildAltText(makeItem())).toBe(
      "FESTIVAL LINEUP: Coachella 2027\n\nCoachella 2027 lineup announced, headlined by Artist A, Artist B, and Artist C." +
        "\n\nLineup: Artist A, Artist B, Artist C\n\n#Coachella2027 #MusicFestival #FestivalLineup"
    );
  });

  it("doesn't duplicate the year when festivalName already contains it (observed live in production)", () => {
    const text = buildAltText(makeItem({ festivalName: "ArcTanGent Festival 2027" }));
    expect(text.startsWith("FESTIVAL LINEUP: ArcTanGent Festival 2027\n\n")).toBe(true);
    expect(text).not.toContain("2027 2027");
    expect(text).toContain("#ArcTanGentFestival2027 ");
    expect(text).not.toContain("20272027");
  });

  it("omits the year when eventYear is null", () => {
    expect(buildAltText(makeItem({ eventYear: null }))).toBe(
      "FESTIVAL LINEUP: Coachella\n\nCoachella 2027 lineup announced, headlined by Artist A, Artist B, and Artist C." +
        "\n\nLineup: Artist A, Artist B, Artist C\n\n#Coachella #MusicFestival #FestivalLineup"
    );
  });

  it("omits the lineup line when no artists were independently confirmed", () => {
    expect(buildAltText(makeItem({ lineupArtists: [] }))).toBe(
      "FESTIVAL LINEUP: Coachella 2027\n\nCoachella 2027 lineup announced, headlined by Artist A, Artist B, and Artist C." +
        "\n\n#Coachella2027 #MusicFestival #FestivalLineup"
    );
  });

  it("caps the shown lineup names and notes how many more there are", () => {
    const lineupArtists = Array.from({ length: 10 }, (_, i) => `Artist ${i + 1}`);
    const text = buildAltText(makeItem({ lineupArtists }));
    expect(text).toContain("Lineup: Artist 1, Artist 2, Artist 3, Artist 4, Artist 5, Artist 6, +4 more");
  });

  it("does not truncate an overlong blurb - alt text has no AT Protocol length limit, unlike the visible post text this is no longer used for", () => {
    const longBlurb = "A".repeat(400);
    const text = buildAltText(makeItem({ blurb: longBlurb }));
    expect(text).toContain(longBlurb);
    expect(text.startsWith("FESTIVAL LINEUP: Coachella 2027\n\n")).toBe(true);
    expect(text.endsWith("#Coachella2027 #MusicFestival #FestivalLineup")).toBe(true);
  });

  it("uses a custom header label when given one (postThrowbackPoster.ts passes THROWBACK THURSDAY so a historical repost is never mistaken for a new announcement)", () => {
    const text = buildAltText(makeItem(), "THROWBACK THURSDAY");
    expect(text.startsWith("THROWBACK THURSDAY: Coachella 2027\n\n")).toBe(true);
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

describe("buildThrowbackKey", () => {
  it("never collides with the live pipeline's key for the same festival/year", () => {
    expect(buildThrowbackKey("Coachella", 2027)).not.toBe(buildFestivalKey("Coachella", 2027));
  });

  it("is itself namespaced consistently so the same festival/year always maps to the same throwback key", () => {
    expect(buildThrowbackKey("Coachella", 1999)).toBe(buildThrowbackKey("COACHELLA!!", 1999));
  });

  it("starts with the literal prefix 'throwback' so a LIKE 'throwback%' query can find all throwback rows", () => {
    expect(buildThrowbackKey("Coachella", 1999).startsWith("throwback")).toBe(true);
  });
});
