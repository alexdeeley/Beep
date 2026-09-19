import { describe, it, expect } from "vitest";
import { extractImageUrl } from "../../src/newswire/festivalPosters/extractPosterImage.js";

describe("extractImageUrl", () => {
  it("extracts an og:image meta tag (property then content)", () => {
    const html = `<html><head><meta property="og:image" content="https://example.com/poster.jpg"></head></html>`;
    expect(extractImageUrl(html, "https://example.com/lineup")).toBe("https://example.com/poster.jpg");
  });

  it("extracts an og:image meta tag with attributes in the reverse order (content then property)", () => {
    const html = `<meta content="https://example.com/poster2.jpg" property="og:image">`;
    expect(extractImageUrl(html, "https://example.com/lineup")).toBe("https://example.com/poster2.jpg");
  });

  it("falls back to twitter:image when og:image is absent", () => {
    const html = `<meta name="twitter:image" content="https://example.com/tw-poster.jpg">`;
    expect(extractImageUrl(html, "https://example.com/lineup")).toBe("https://example.com/tw-poster.jpg");
  });

  it("resolves a relative image URL against the page URL", () => {
    const html = `<meta property="og:image" content="/assets/poster.jpg">`;
    expect(extractImageUrl(html, "https://example.com/festival/lineup")).toBe("https://example.com/assets/poster.jpg");
  });

  it("returns null when no image meta tag is present", () => {
    const html = `<html><head><title>No poster here</title></head></html>`;
    expect(extractImageUrl(html, "https://example.com/lineup")).toBeNull();
  });

  it("decodes HTML entities in the URL (e.g. &amp; -> &) - confirmed live to matter on real og:image markup", () => {
    const html = `<meta property="og:image" content="https://example.com/poster.jpg?a=1&amp;b=2">`;
    expect(extractImageUrl(html, "https://example.com/lineup")).toBe("https://example.com/poster.jpg?a=1&b=2");
  });

  it("returns null rather than throwing on a malformed content URL", () => {
    const html = `<meta property="og:image" content="not a valid url ::">`;
    expect(extractImageUrl(html, "not-a-valid-base-either")).toBeNull();
  });
});
