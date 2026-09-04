import { describe, it, expect } from "vitest";
import { collectNewAlbums, MAX_NEW_PER_ARTIST_PER_CHECK } from "../../src/newswire/releases/checkForReleases.js";
import type { SpotifyAlbum } from "../../src/newswire/spotify/types.js";

function album(id: string, releaseDate = "2026-01-01"): SpotifyAlbum {
  return {
    id,
    name: id,
    album_type: "single",
    release_date: releaseDate,
    release_date_precision: "day",
    total_tracks: 1,
    external_urls: { spotify: `https://open.spotify.com/album/${id}` },
    images: [],
  };
}

describe("collectNewAlbums", () => {
  it("returns everything newer than lastSeenReleaseId, stopping at the previously-seen one", () => {
    const albums = [album("c"), album("b"), album("a")]; // newest-first
    expect(collectNewAlbums(albums, "b").map((a) => a.id)).toEqual(["c"]);
  });

  it("returns an empty array when the newest album is already the last seen one", () => {
    const albums = [album("a"), album("b")];
    expect(collectNewAlbums(albums, "a")).toEqual([]);
  });

  it("treats every album as new when lastSeenReleaseId is null (artist had zero releases at baseline time)", () => {
    const albums = [album("a"), album("b")];
    expect(collectNewAlbums(albums, null).map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("caps at MAX_NEW_PER_ARTIST_PER_CHECK even if the previously-seen release never appears in the page", () => {
    const albums = Array.from({ length: MAX_NEW_PER_ARTIST_PER_CHECK + 10 }, (_, i) => album(`id-${i}`));
    const result = collectNewAlbums(albums, "not-in-this-page");
    expect(result).toHaveLength(MAX_NEW_PER_ARTIST_PER_CHECK);
    expect(result.map((a) => a.id)).toEqual(albums.slice(0, MAX_NEW_PER_ARTIST_PER_CHECK).map((a) => a.id));
  });
});
