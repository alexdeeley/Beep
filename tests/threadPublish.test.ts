import { describe, it, expect } from "vitest";
import { buildLinkFacet } from "../src/bluesky/threadPublish.js";

describe("buildLinkFacet", () => {
  it("computes UTF-8 byte offsets, not character offsets, for a plain-ASCII prefix", () => {
    const url = "https://open.spotify.com/track/abc123";
    const text = `NEW SINGLE: The Band - Song Title\n${url}`;
    const facet = buildLinkFacet(text, url);
    expect(facet).not.toBeNull();
    expect(facet!.index.byteStart).toBe(Buffer.byteLength(`NEW SINGLE: The Band - Song Title\n`, "utf8"));
    expect(facet!.index.byteEnd).toBe(facet!.index.byteStart + Buffer.byteLength(url, "utf8"));
    expect(facet!.features[0]).toEqual({ $type: "app.bsky.richtext.facet#link", uri: url });
  });

  it("uses byte length, not character length, when multi-byte characters precede the link", () => {
    // "é" and "—" are each multiple UTF-8 bytes but a single JS string character/grapheme -
    // a byte-offset bug here would silently corrupt the facet on any non-ASCII artist name.
    const url = "https://open.spotify.com/track/xyz789";
    const text = `NEW SINGLE: Björk — Song\n${url}`;
    const facet = buildLinkFacet(text, url);
    const prefix = `NEW SINGLE: Björk — Song\n`;
    expect(facet!.index.byteStart).toBe(Buffer.byteLength(prefix, "utf8"));
    expect(Buffer.byteLength(prefix, "utf8")).toBeGreaterThan(prefix.length); // sanity check the fixture actually exercises multi-byte chars
  });

  it("returns null when the URL isn't present in the text", () => {
    expect(buildLinkFacet("NEW SINGLE: The Band - Song Title", "https://open.spotify.com/track/abc123")).toBeNull();
  });
});
