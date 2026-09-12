import { describe, it, expect } from "vitest";
import { extractTrackId } from "../../src/newswire/spotify/getPlaylistTracks.js";

describe("extractTrackId", () => {
  it("extracts the id from a standard track URI", () => {
    expect(extractTrackId("spotify:track:7D92yxAcYNd1Sis8uXdkQo")).toBe("7D92yxAcYNd1Sis8uXdkQo");
  });

  it("returns null for a non-track URI (e.g. an episode or local file)", () => {
    expect(extractTrackId("spotify:episode:abc123")).toBeNull();
    expect(extractTrackId("spotify:local:Some+Artist:Some+Album:Some+Track:180")).toBeNull();
  });

  it("returns null for a malformed or empty string", () => {
    expect(extractTrackId("")).toBeNull();
    expect(extractTrackId("not-a-uri")).toBeNull();
  });
});
