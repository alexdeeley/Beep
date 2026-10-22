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

  it("trusts a page's og:image, with no poster keyword anywhere, when og:site_name identifies the page as the artist's own official site - confirmed live necessary against a real official tour-announcement page", () => {
    const html = `
      <meta property="og:site_name" content="Oasis">
      <meta property="og:image" content="https://oasisinet.com/wp-content/uploads/2026/09/Oasis-2027_Global-Dates.jpg">
    `;
    expect(extractImageUrl(html, "https://oasisinet.com/news/oasis-live-27/", "Oasis")).toBe(
      "https://oasisinet.com/wp-content/uploads/2026/09/Oasis-2027_Global-Dates.jpg"
    );
  });

  it("does NOT trust og:image on a page whose og:site_name is a third party (e.g. a press/news outlet), even when covering the same artist - the official-site signal must be the page's OWN declared identity", () => {
    const html = `
      <meta property="og:site_name" content="Radio X">
      <meta property="og:image" content="https://images.radiox.co.uk/press-photo.jpg">
    `;
    expect(extractImageUrl(html, "https://www.radiox.co.uk/artists/oasis/", "Oasis")).toBeNull();
  });

  it("does NOT extend official-site trust to a regular <img> body tag, only to og:image/twitter:image meta tags - an arbitrary photo further down an official page is not itself a declared representative image", () => {
    const html = `
      <meta property="og:site_name" content="Fontaines D.C.">
      <img src="https://fontainesdc.com/photos/press-shot.jpg" alt="">
    `;
    expect(extractImageUrl(html, "https://fontainesdc.com/pages/live", "Fontaines D.C.")).toBeNull();
  });

  it("official-site match is tolerant of the festival name carrying extra words beyond the bare site name (e.g. an edition year)", () => {
    const html = `
      <meta property="og:site_name" content="Fontaines D.C.">
      <meta property="og:image" content="https://fontainesdc.com/wp-content/uploads/tour-2026.jpg">
    `;
    expect(extractImageUrl(html, "https://fontainesdc.com/news/tour-2026", "Fontaines D.C. 2026")).toBe(
      "https://fontainesdc.com/wp-content/uploads/tour-2026.jpg"
    );
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

  it("matches a filename containing the festival's own name + year, with no poster/flyer/artwork keyword anywhere - confirmed live against a real press article (Clash Music's Primavera Sound 2027 coverage)", () => {
    const html = `
      <img src="https://www.clashmusic.com/wp-content/uploads/2026/10/Photo-Oct-07-2026.jpg" alt="">
      <img src="https://www.clashmusic.com/wp-content/uploads/2026/10/Primavera-Sound-2027.jpg" alt="">
      <img src="https://www.clashmusic.com/wp-content/uploads/2026/10/Greenpeace.jpg" alt="">
    `;
    expect(extractImageUrl(html, "https://example.com/lineup", "Primavera Sound")).toBe(
      "https://www.clashmusic.com/wp-content/uploads/2026/10/Primavera-Sound-2027.jpg"
    );
  });

  it("ignores the festival-name-in-URL signal when no festivalName is passed", () => {
    const html = `<img src="https://example.com/uploads/Primavera-Sound-2027.jpg" alt="">`;
    expect(extractImageUrl(html, "https://example.com/lineup")).toBeNull();
  });

  it("does not match on a festival name that isn't actually in the URL", () => {
    const html = `<img src="https://example.com/uploads/Primavera-Sound-2027.jpg" alt="">`;
    expect(extractImageUrl(html, "https://example.com/lineup", "Glastonbury")).toBeNull();
  });

  it("requires at least 6 characters for a single-word festival name, to avoid short generic words matching unrelated URLs", () => {
    const html = `<img src="https://example.com/hive-of-activity.jpg" alt="">`;
    expect(extractImageUrl(html, "https://example.com/lineup", "Hive")).toBeNull();
  });

  it("does NOT match a filename that merely contains the festival name among many other words (e.g. an article's own URL slug) - confirmed live: a press site named an unrelated editorial photo collage after its article's full slug, which happened to include the festival name", () => {
    const html = `<img src="https://example.com/2026/10/05/primavera-sound-barcelona-2027-lineup-ticket-details-doechii-caroline-polachek-phoebe-bridgers.jpg" alt="">`;
    expect(extractImageUrl(html, "https://example.com/lineup", "Primavera Sound")).toBeNull();
  });

  it("allows a small amount of slack in the filename (e.g. an edition year) without requiring an exact match", () => {
    const html = `<img src="https://example.com/primavera-sound-2027-poster-art.jpg" alt="">`;
    expect(extractImageUrl(html, "https://example.com/lineup", "Primavera Sound")).toBe(
      "https://example.com/primavera-sound-2027-poster-art.jpg"
    );
  });

  it("strips a Wikimedia thumbnail's '<width>px-' filename prefix before counting extra words - confirmed live: a real, otherwise-exact filename match was pushed over MAX_EXTRA_FILENAME_WORDS purely by Wikipedia's '250px-' thumbnail-rewriting prefix, producing a false negative", () => {
    const html = `<img src="https://thumb.wikimedia.org/wikipedia/commons/thumb/a/b/Monterey-Pop-Festival-1967.jpg/250px-Monterey-Pop-Festival-1967.jpg" alt="">`;
    expect(extractImageUrl(html, "https://example.com/lineup", "Monterey Pop Festival")).toBe(
      "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/b/Monterey-Pop-Festival-1967.jpg/250px-Monterey-Pop-Festival-1967.jpg"
    );
  });

  it("resolves a real-world srcset where candidate URLs contain unescaped commas in their own path (Cloudinary-style transform params) without corrupting them - confirmed live: naive comma-splitting on srcset turned a real image URL into an unrelated 404", () => {
    const html = `<img srcset="https://cdn.example.com/img/w_220,c_limit,f_auto/primavera-sound-poster.jpg 220w,https://cdn.example.com/img/w_1800,c_limit,f_auto/primavera-sound-poster.jpg 1800w" alt="festival poster">`;
    expect(extractImageUrl(html, "https://example.com/lineup")).toBe(
      "https://cdn.example.com/img/w_1800,c_limit,f_auto/primavera-sound-poster.jpg"
    );
  });

  it("uses an og:image meta tag when nearby text independently corroborates it's the poster - confirmed live against a real press article whose auto-generated description said '...listed on this year's poster are...' right before the real og:image", () => {
    const html = `
      <meta property="og:description" content="Barcelona's festival has unveiled its lineup, and the top three headliners listed on this year's poster are Artist A, Artist B, and Artist C.">
      <meta property="og:image" content="https://example.com/uploads/2026/10/Festival.jpeg">
    `;
    expect(extractImageUrl(html, "https://example.com/lineup", "Some Festival")).toBe("https://example.com/uploads/2026/10/Festival.jpeg");
  });

  it("does NOT use an og:image meta tag with no corroborating signal nearby - never reintroduces the blind og:image fallback that was removed after it posted a wrong photo twice in production", () => {
    const html = `
      <meta property="og:description" content="Fans enjoyed a great show this weekend.">
      <meta property="og:image" content="https://example.com/crowd-photo.jpg">
    `;
    expect(extractImageUrl(html, "https://example.com/lineup", "Some Festival")).toBeNull();
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
