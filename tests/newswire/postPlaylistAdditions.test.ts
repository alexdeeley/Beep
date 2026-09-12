import { describe, it, expect } from "vitest";
import { buildPostText } from "../../src/newswire/spotify/postPlaylistAdditions.js";
import type { PlaylistTrack } from "../../src/newswire/spotify/getPlaylistTracks.js";

function makeTrack(overrides: Partial<PlaylistTrack> = {}): PlaylistTrack {
  return {
    trackId: "abc123",
    name: "Test Song",
    artists: ["Test Artist"],
    url: "https://open.spotify.com/track/abc123",
    addedAt: "2026-09-12T00:00:00Z",
    ...overrides,
  };
}

describe("buildPostText", () => {
  it("formats a single-artist track with its link on its own line", () => {
    expect(buildPostText(makeTrack())).toBe("NEW SINGLE: Test Artist - Test Song\n\nhttps://open.spotify.com/track/abc123");
  });

  it("joins multiple artists with a comma", () => {
    expect(buildPostText(makeTrack({ artists: ["Artist A", "Artist B"] }))).toBe(
      "NEW SINGLE: Artist A, Artist B - Test Song\n\nhttps://open.spotify.com/track/abc123"
    );
  });

  it("omits the link line entirely when no URL is available, rather than a broken link", () => {
    expect(buildPostText(makeTrack({ url: null }))).toBe("NEW SINGLE: Test Artist - Test Song");
  });
});
