import { describe, it, expect } from "vitest";
import { buildLinkFacet } from "../../src/bluesky/threadPublish.js";

describe("buildLinkFacet", () => {
  it("returns null when the url isn't present in the text", () => {
    expect(buildLinkFacet("NEW SINGLE: Artist - Title", "https://example.com/article")).toBeNull();
  });

  it("computes byte offsets matching the url's position for plain ASCII text", () => {
    const url = "https://example.com/article";
    const text = `NEW SINGLE: Artist - Title\n\n${url}`;
    const facet = buildLinkFacet(text, url);
    expect(facet).not.toBeNull();
    expect(facet!.features[0]!.uri).toBe(url);
    const sliced = Buffer.from(text, "utf8").subarray(facet!.index.byteStart, facet!.index.byteEnd).toString("utf8");
    expect(sliced).toBe(url);
  });

  it("uses UTF-8 byte offsets, not character offsets, when multi-byte characters precede the url", () => {
    const url = "https://example.com/article";
    // "Beyoncé" - the é is 2 bytes in UTF-8 but 1 JS character, so a naive character-based offset
    // would land one byte short of the real url start.
    const text = `NEW SINGLE: Beyoncé - Title\n\n${url}`;
    const facet = buildLinkFacet(text, url);
    expect(facet).not.toBeNull();
    const sliced = Buffer.from(text, "utf8").subarray(facet!.index.byteStart, facet!.index.byteEnd).toString("utf8");
    expect(sliced).toBe(url);
  });
});
