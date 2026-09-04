import { describe, it, expect } from "vitest";
import { rankReleases } from "../../src/newswire/releases/rankReleases.js";
import type { UnpostedReleaseRow } from "../../src/newswire/db/releasesRepo.js";

function release(overrides: Partial<UnpostedReleaseRow> = {}): UnpostedReleaseRow {
  return {
    id: 1,
    watched_artist_id: 1,
    spotify_release_id: "r1",
    release_type: "single",
    title: "T",
    release_date: "2026-01-01",
    release_date_precision: "day",
    total_tracks: 1,
    spotify_url: "https://open.spotify.com/album/r1",
    image_url: null,
    discovered_in_run_id: 1,
    posted_in_run_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    artist_name: "Artist",
    artist_popularity: null,
    artist_genres_json: null,
    ...overrides,
  };
}

describe("rankReleases", () => {
  it("preserves input (FIFO) order rather than sorting by popularity", () => {
    const releases = [
      release({ id: 1, artist_popularity: 10 }),
      release({ id: 2, artist_popularity: 90 }),
      release({ id: 3, artist_popularity: 50 }),
    ];
    const ranked = rankReleases(releases, 10);
    expect(ranked.map((r) => r.release.id)).toEqual([1, 2, 3]);
  });

  it("caps at maxPerEdition", () => {
    const releases = [release({ id: 1 }), release({ id: 2 }), release({ id: 3 })];
    expect(rankReleases(releases, 2)).toHaveLength(2);
  });

  it("normalizes popularity (0-100) to a 0-1 importance score", () => {
    const [ranked] = rankReleases([release({ artist_popularity: 80 })], 1);
    expect(ranked!.importanceScore).toBeCloseTo(0.8);
  });

  it("treats a null popularity (never-checked artist metadata) as zero importance", () => {
    const [ranked] = rankReleases([release({ artist_popularity: null })], 1);
    expect(ranked!.importanceScore).toBe(0);
  });
});
