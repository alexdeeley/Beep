import { BLUESKY_MAX_IMAGE_BYTES } from "../../bluesky/publish.js";
import type { RunLogger } from "../../utils/logger.js";

export interface ExtractedPosterImage {
  imageUrl: string;
  imageBytes: Buffer;
  mimeType: string;
}

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png"]);

/**
 * Decodes the small set of HTML entities that routinely appear inside an attribute value - real-world
 * markup very commonly HTML-escapes "&" as "&amp;" even inside a URL (confirmed live: Wikipedia's own
 * og:image does this for its tracking query params). Left undecoded, "&amp;" would be fetched as a
 * literal query-string token instead of "&", which happens to be harmless when the query params are
 * cosmetic but would silently break or mis-fetch on a site where they aren't (a signed URL, a CDN
 * variant selector).
 */
function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/**
 * Regex-based og:image/twitter:image meta-tag extraction, attribute order agnostic (property/content
 * can appear in either order in real-world HTML). Deliberately NOT LLM-based: verification only
 * confirms a page is the real announcement, it never reports the image URL itself, since an LLM can
 * hallucinate a URL that doesn't actually exist or doesn't actually point at the poster. This mirrors
 * spotify/getPlaylistTracks.ts's approach - a real HTTP fetch and mechanical parse is the only thing
 * trusted to produce a URL that must literally resolve to real bytes.
 */
/** Exported for unit testing. */
export function extractImageUrl(html: string, pageUrl: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (!match?.[1]) continue;
    try {
      return new URL(decodeHtmlEntities(match[1]), pageUrl).toString();
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Fetches a verified announcement page and mechanically extracts its poster image - the real,
 * downloadable bytes of the image actually linked from that page's own og:image/twitter:image meta tag,
 * never a model-reported URL. Never throws: any failure (page fetch error, no image meta tag found,
 * unsupported content-type, image too large for Bluesky's blob limit, empty body) resolves to null and
 * logs a warning, so a page that can't be mechanically parsed just means that festival's poster doesn't
 * post this cycle - it does NOT block the rest of the run, and the item stays unrecorded so a later
 * cycle can retry (see postFestivalPosters.ts).
 */
export async function extractPosterImage(logger: RunLogger, pageUrl: string): Promise<ExtractedPosterImage | null> {
  try {
    const pageRes = await fetch(pageUrl, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!pageRes.ok) throw new Error(`HTTP ${pageRes.status} fetching announcement page`);
    const html = await pageRes.text();

    const imageUrl = extractImageUrl(html, pageUrl);
    if (!imageUrl) throw new Error("no og:image/twitter:image meta tag found on the announcement page");

    const imageRes = await fetch(imageUrl, { signal: AbortSignal.timeout(10000) });
    if (!imageRes.ok) throw new Error(`HTTP ${imageRes.status} fetching image`);

    const mimeType = (imageRes.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(mimeType)) throw new Error(`unsupported image content-type: "${mimeType || "unknown"}"`);

    const declaredLength = Number.parseInt(imageRes.headers.get("content-length") ?? "", 10);
    if (Number.isFinite(declaredLength) && declaredLength > BLUESKY_MAX_IMAGE_BYTES) {
      throw new Error(`image is ${declaredLength} bytes (declared), exceeds Bluesky's ${BLUESKY_MAX_IMAGE_BYTES}-byte limit`);
    }

    const imageBytes = Buffer.from(await imageRes.arrayBuffer());
    if (imageBytes.length === 0) throw new Error("image response body was empty");
    if (imageBytes.length > BLUESKY_MAX_IMAGE_BYTES) {
      throw new Error(`image is ${imageBytes.length} bytes, exceeds Bluesky's ${BLUESKY_MAX_IMAGE_BYTES}-byte limit`);
    }

    return { imageUrl, imageBytes, mimeType };
  } catch (err) {
    logger.warn("festival-posters", `Could not extract a usable poster image from ${pageUrl}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
