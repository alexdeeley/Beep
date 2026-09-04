import { describe, it, expect } from "vitest";
import { buildReleaseFacts } from "../../src/newswire/writing/prompts.js";

describe("buildReleaseFacts", () => {
  const base = {
    artistName: "Alvvays",
    releaseType: "album" as const,
    title: "Blue Rev",
    releaseDate: "2026-09-01",
    totalTracks: 12,
    genres: ["indie pop"],
    spotifyUrl: "https://open.spotify.com/album/x",
  };

  it("includes the core release fact with artist, type, title, and date", () => {
    const facts = buildReleaseFacts(base);
    expect(facts.some((f) => f.claim.includes("Alvvays") && f.claim.includes("Blue Rev") && f.claim.includes("2026-09-01"))).toBe(true);
  });

  it("includes track count, singularized for a 1-track release", () => {
    const [, trackFact] = buildReleaseFacts({ ...base, totalTracks: 1 });
    expect(trackFact!.claim).toContain("1 track");
    expect(trackFact!.claim).not.toContain("1 tracks");
  });

  it("omits the genre fact when no genres are known", () => {
    const facts = buildReleaseFacts({ ...base, genres: [] });
    expect(facts.some((f) => f.claim.toLowerCase().includes("genres"))).toBe(false);
  });

  it("includes the genre fact when genres are present", () => {
    const facts = buildReleaseFacts(base);
    expect(facts.some((f) => f.claim.includes("indie pop"))).toBe(true);
  });

  it("always includes the Spotify URL fact", () => {
    const facts = buildReleaseFacts(base);
    expect(facts.some((f) => f.claim.includes(base.spotifyUrl))).toBe(true);
  });

  it("every fact is labeled FACT (Spotify data is treated as ground truth, never a lesser label)", () => {
    for (const f of buildReleaseFacts(base)) expect(f.factLabel).toBe("FACT");
  });
});
