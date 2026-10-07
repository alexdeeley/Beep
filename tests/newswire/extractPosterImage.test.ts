import { describe, it, expect, vi, afterEach } from "vitest";
import sharp from "sharp";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractImageUrl, extractPosterImage } from "../../src/newswire/festivalPosters/extractPosterImage.js";
import { BLUESKY_MAX_IMAGE_BYTES } from "../../src/bluesky/publish.js";
import { RunLogger } from "../../src/utils/logger.js";

describe("extractImageUrl", () => {
  it("picks an <img> with poster-signal alt text", () => {
    const html = `<img src="https://example.com/2027-lineup.jpg" alt="Coachella 2027 poster">`;
    expect(extractImageUrl(html, "https://example.com/lineup")).toBe("https://example.com/2027-lineup.jpg");
  });

  it("picks an <img> whose filename signals it's the poster, even with no alt text", () => {
    const html = `<img src="/assets/festival-2027-poster.png" alt="">`;
    expect(extractImageUrl(html, "https://example.com/lineup")).toBe("https://example.com/assets/festival-2027-poster.png");
  });

  it("resolves a relative image URL against the page URL", () => {
    const html = `<img src="/assets/poster.jpg" alt="poster">`;
    expect(extractImageUrl(html, "https://example.com/festival/lineup")).toBe("https://example.com/assets/poster.jpg");
  });

  it("decodes HTML entities in the URL (e.g. &amp; -> &) - confirmed live to matter on real markup", () => {
    const html = `<img src="https://example.com/poster.jpg?a=1&amp;b=2" alt="festival poster">`;
    expect(extractImageUrl(html, "https://example.com/lineup")).toBe("https://example.com/poster.jpg?a=1&b=2");
  });

  it("picks the largest srcset variant for a matching poster <img>", () => {
    const html = `<img srcset="/poster-small.jpg 400w, /poster-large.jpg 1600w" alt="poster">`;
    expect(extractImageUrl(html, "https://example.com/lineup")).toBe("https://example.com/poster-large.jpg");
  });

  it("returns null when no image on the page carries a poster/flyer/artwork signal - never falls back to a generic photo", () => {
    const html = `
      <meta property="og:image" content="https://example.com/crowd-photo.jpg">
      <img src="https://example.com/logo.png" alt="Site logo">
      <img src="https://example.com/crowd.jpg" alt="Fans at the festival">
    `;
    expect(extractImageUrl(html, "https://example.com/lineup")).toBeNull();
  });

  it("returns null on an empty page", () => {
    const html = `<html><head><title>No poster here</title></head></html>`;
    expect(extractImageUrl(html, "https://example.com/lineup")).toBeNull();
  });

  it("does NOT match a plain 'lineup' signal on its own - confirmed live this false-positives on an ordinary artist-roster grid of individual band photos, not the poster", () => {
    const html = `
      <div id="lineup">
        <img src="https://example.com/artists/some-band.jpg" alt="">
      </div>
    `;
    expect(extractImageUrl(html, "https://example.com/line-up")).toBeNull();
  });

  it("matches via surrounding HTML context (e.g. a wrapping id=\"poster\" container) even when the <img>'s own attributes are generic - confirmed live against a real festival's lineup page", () => {
    const html = `
      <div class="panel" id="poster">
        <picture>
          <source srcset="/media/poster.webp" type="image/webp">
          <img src="/media/actual-poster.jpg" alt="">
        </picture>
      </div>
    `;
    expect(extractImageUrl(html, "https://example.com/lineup")).toBe("https://example.com/media/actual-poster.jpg");
  });

  it("skips a <source> explicitly typed image/webp in favor of a sibling non-webp source", () => {
    const html = `
      <div id="poster">
        <picture>
          <source srcset="/media/poster.webp" type="image/webp">
          <source srcset="/media/poster.jpg" type="image/jpeg">
        </picture>
      </div>
    `;
    expect(extractImageUrl(html, "https://example.com/lineup")).toBe("https://example.com/media/poster.jpg");
  });

  it("returns null rather than throwing on a malformed src URL", () => {
    const html = `<img src="not a valid url ::" alt="poster">`;
    expect(extractImageUrl(html, "not-a-valid-base-either")).toBeNull();
  });

  it("normalizes a Wix media URL to its untransformed, full-resolution original - confirmed live that the server-rendered <img> only carries a tiny cropped placeholder", () => {
    const html = `<img src="https://static.wixstatic.com/media/abc123~mv2.png/v1/fill/w_46,h_24,al_c,q_85/name.png" alt="festival poster">`;
    expect(extractImageUrl(html, "https://example.com/lineup")).toBe("https://static.wixstatic.com/media/abc123~mv2.png");
  });
});

describe("extractPosterImage", () => {
  const runDir = mkdtempSync(join(tmpdir(), "extract-poster-image-test-"));
  const logger = new RunLogger(join(runDir, "logs"));

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("compresses a correctly-identified but oversized real poster down under Bluesky's limit, rather than discarding it - confirmed live necessary: a real festival's official poster was a legitimate 7.5MB JPEG", async () => {
    // Random noise compresses poorly, reliably landing well above BLUESKY_MAX_IMAGE_BYTES as a raw PNG -
    // a stand-in for a real, large, print-resolution poster image.
    const width = 1600;
    const height = 1600;
    const raw = Buffer.alloc(width * height * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256);
    const oversizedPng = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
    expect(oversizedPng.length).toBeGreaterThan(BLUESKY_MAX_IMAGE_BYTES);

    const pageUrl = "https://example.com/lineup";
    const html = `<img src="https://example.com/huge-poster.png" alt="festival poster">`;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === pageUrl) {
        return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      }
      return new Response(new Uint8Array(oversizedPng), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(oversizedPng.length) },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await extractPosterImage(logger, pageUrl);

    expect(result).not.toBeNull();
    expect(result!.imageBytes.length).toBeLessThanOrEqual(BLUESKY_MAX_IMAGE_BYTES);
    expect(result!.mimeType).toBe("image/jpeg");
  });

  it("returns null without throwing when the page has no poster image, rather than ever falling back to a generic photo", async () => {
    const pageUrl = "https://example.com/lineup";
    const html = `<img src="https://example.com/crowd.jpg" alt="Fans at the show">`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } }))
    );

    const result = await extractPosterImage(logger, pageUrl);
    expect(result).toBeNull();
  });
});
