import { describe, it, expect } from "vitest";
import { buildPostText } from "../../src/newswire/spotify/postPlaylistAdditions.js";
import type { PlaylistTrack } from "../../src/newswire/spotify/getPlaylistTracks.js";

function makeTrack(overrides: Partial<PlaylistTrack> = {}): PlaylistTrack {
  return {
    trackId: "abc123",
    name: "Test Song",
    artistCredit: "Test Artist",
    url: "https://open.spotify.com/track/abc123",
    ...overrides,
  };
}

describe("buildPostText", () => {
  it("formats a track with its link on its own line", () => {
    expect(buildPostText(makeTrack())).toBe("NEW SINGLE: Test Artist - Test Song\n\nhttps://open.spotify.com/track/abc123");
  });

  it("uses Spotify's own already-formatted multi-artist credit as-is", () => {
    expect(buildPostText(makeTrack({ artistCredit: "Artist A, Artist B" }))).toBe(
      "NEW SINGLE: Artist A, Artist B - Test Song\n\nhttps://open.spotify.com/track/abc123"
    );
  });
});
