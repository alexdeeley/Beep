import { describe, it, expect } from "vitest";
import { normalizeForComparison, isConfidentMatch, type SpotifySearchTrack } from "../../src/newswire/spotify/lookupTrack.js";

function track(overrides: Partial<SpotifySearchTrack> = {}): SpotifySearchTrack {
  return {
    name: "Speyside",
    artists: [{ name: "Bon Iver" }],
    external_urls: { spotify: "https://open.spotify.com/track/abc123" },
    album: { release_date: "2026-08-30", release_date_precision: "day" },
    ...overrides,
  };
}

describe("normalizeForComparison", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeForComparison("  Speyside  ")).toBe("speyside");
  });

  it("strips a trailing '- Single' qualifier", () => {
    expect(normalizeForComparison("Speyside - Single")).toBe("speyside");
  });

  it("strips a trailing '(Radio Edit)' qualifier", () => {
    expect(normalizeForComparison("Song Title (Radio Edit)")).toBe("song title");
  });

  it("normalizes curly quotes to straight quotes", () => {
    expect(normalizeForComparison("Don’t Stop")).toBe(normalizeForComparison("Don't Stop"));
  });
});

describe("isConfidentMatch", () => {
  const now = new Date("2026-09-05T00:00:00Z");

  it("matches when artist and title both match and the release is recent", () => {
    expect(isConfidentMatch(track(), "Bon Iver", "Speyside", now)).toBe(true);
  });

  it("rejects when the artist doesn't match", () => {
    expect(isConfidentMatch(track({ artists: [{ name: "Someone Else" }] }), "Bon Iver", "Speyside", now)).toBe(false);
  });

  it("rejects when the title doesn't match", () => {
    expect(isConfidentMatch(track({ name: "A Different Song" }), "Bon Iver", "Speyside", now)).toBe(false);
  });

  it("matches when the catalog title only differs by a stripped qualifier", () => {
    expect(isConfidentMatch(track({ name: "Speyside - Single" }), "Bon Iver", "Speyside", now)).toBe(true);
  });

  it("matches when any of multiple credited artists matches", () => {
    expect(
      isConfidentMatch(track({ artists: [{ name: "Someone Else" }, { name: "Bon Iver" }] }), "Bon Iver", "Speyside", now)
    ).toBe(true);
  });

  it("rejects an old catalog track with a coincidentally matching title", () => {
    const old = track({ album: { release_date: "2011-06-21", release_date_precision: "day" } });
    expect(isConfidentMatch(old, "Bon Iver", "Speyside", now)).toBe(false);
  });

  it("rejects when the release date is unknown", () => {
    const noDate = track({ album: { release_date: "", release_date_precision: "day" } });
    expect(isConfidentMatch(noDate, "Bon Iver", "Speyside", now)).toBe(false);
  });

  it("accepts a release right at the edge of the recency window", () => {
    const edge = track({ album: { release_date: "2026-07-22", release_date_precision: "day" } }); // 44 days before `now`, under the 45-day cap
    expect(isConfidentMatch(edge, "Bon Iver", "Speyside", now)).toBe(true);
  });
});
