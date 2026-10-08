import sharp from "sharp";
import { BLUESKY_MAX_IMAGE_BYTES } from "../../bluesky/publish.js";
import type { RunLogger } from "../../utils/logger.js";

export interface ExtractedPosterImage {
  imageUrl: string;
  imageBytes: Buffer;
  mimeType: string;
}

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png"]);
/** Sanity cap on the declared download size, well above any real poster - guards against an absurd/corrupt response before spending bandwidth on it. Festival posters are print-resolution marketing art; a real one confirmed live at 7.5MB comfortably clears Bluesky's 2MB post limit, so some are expected to need compressToFit below. */
const ABSOLUTE_MAX_DOWNLOAD_BYTES = 25_000_000;

/**
 * Progressively downscales/recompresses an oversized-but-correctly-identified poster image (always to
 * JPEG, regardless of source format - fine for a flat poster graphic, and far more compressible than
 * PNG at these dimensions) until it fits Bluesky's blob limit, or gives up after exhausting the size/
 * quality grid below. Confirmed necessary live: a real festival's own official poster was a legitimate
 * 7.5MB JPEG - without this, a correctly-found real poster would be discarded for being "too big" even
 * though it's exactly the image the account owner wants posted.
 */
async function compressToFit(bytes: Buffer): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const maxDimensionSteps = [2400, 1800, 1400, 1000];
  const qualitySteps = [85, 75, 65, 50];
  for (const maxDimension of maxDimensionSteps) {
    for (const quality of qualitySteps) {
      try {
        const out = await sharp(bytes)
          .resize(maxDimension, maxDimension, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality })
          .toBuffer();
        if (out.length <= BLUESKY_MAX_IMAGE_BYTES) return { bytes: out, mimeType: "image/jpeg" };
      } catch {
        return null; // not a decodable image (or some other sharp failure) - no point trying further steps
      }
    }
  }
  return null;
}

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
 * Deliberately NOT "lineup"/"line-up": confirmed live that a generic artist-roster grid (every artist's
 * own headshot photo, wrapped in a container like `id="lineup"`) is extremely commonly labelled
 * "lineup" too, which made an early version of this pattern confidently pick a random band's press
 * photo instead of the actual poster. "poster"/"flyer"/"artwork" are unambiguous by comparison.
 */
const POSTER_KEYWORD_PATTERN = /poster|flyer|artwork/i;
/** How much raw HTML before a candidate tag counts as its "context" - wide enough to catch a wrapping `id="poster"`/`class="*poster*"` container, not so wide it picks up an unrelated earlier section. */
const CONTEXT_WINDOW = 600;

interface ImageCandidate {
  /** Already resolved to the Wix original (untransformed, full-resolution) URL when applicable. */
  url: string;
  hasKeyword: boolean;
}

/**
 * True if the festival's own name appears (word-by-word, separator-agnostic) in the candidate's URL -
 * e.g. festivalName "Primavera Sound" matches ".../uploads/2026/10/Primavera-Sound-2027.jpg". Confirmed
 * live: a real press article's hero image was uploaded under exactly this convention (festival name +
 * edition year, no "poster"/"flyer"/"artwork" word anywhere) and was otherwise unfindable. Bounded to
 * the one specific festival this extraction call is already about (never a generic trigger), so the
 * false-positive risk is low. Requires at least 2 words (or one word of 6+ characters) to avoid a short,
 * generic festival name matching unrelated URLs by coincidence.
 */
function festivalNameMatchesUrl(url: string, festivalName: string): boolean {
  const words = festivalName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return false;
  if (words.length === 1 && words[0]!.length < 6) return false;
  const pattern = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[-_]?"), "i");
  return pattern.test(url);
}

/**
 * Wix (and similarly-built, JS-rendered sites) serve only a tiny cropped placeholder in their SERVER
 * html (e.g. ".../v1/fill/w_46,h_24,.../name.jpg~mv2.ext") - the real, full-resolution image is
 * populated client-side only. Stripping everything after the bare "<mediaId>~mv2.ext" recovers the
 * full-resolution original directly from the same CDN, no browser rendering needed - confirmed live.
 * This only normalizes the URL of a candidate already selected some other way (by keyword); it is
 * deliberately NOT used to rank or choose between Wix candidates (see extractImageUrl's doc comment for
 * why: tried that, a real press photo at 6000x4000 outranked the actual 4000x2378 poster).
 */
function wixOriginalUrl(url: string): string {
  const idMatch = /^https:\/\/static\.wixstatic\.com\/media\/([^/]+~mv2\.\w+)\//.exec(url);
  return idMatch ? `https://static.wixstatic.com/media/${idMatch[1]}` : url;
}

/** Picks the largest-width entry from a `srcset` attribute (e.g. "small.jpg 400w, large.jpg 1200w, huge.jpg 2000w") - the designed poster graphic is usually served at its largest resolution, not the first/smallest variant. */
function pickFromSrcset(srcset: string, pageUrl: string): string | null {
  let bestUrl: string | null = null;
  let bestWidth = -1;
  for (const entry of srcset.split(",")) {
    const [rawUrl, descriptor] = entry.trim().split(/\s+/, 2);
    if (!rawUrl) continue;
    const widthMatch = descriptor ? /^(\d+)w$/.exec(descriptor) : null;
    const width = widthMatch ? Number.parseInt(widthMatch[1]!, 10) : 0;
    if (width >= bestWidth) {
      bestWidth = width;
      bestUrl = rawUrl;
    }
  }
  if (!bestUrl) return null;
  try {
    return new URL(decodeHtmlEntities(bestUrl), pageUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Every `<img>` and image-typed `<picture><source>` tag on the page, resolved to an absolute URL
 * (preferring `srcset`'s largest variant, then `src`/`data-src`, and normalized to the full-resolution
 * original for recognized Wix media URLs), scored by a poster/flyer/artwork keyword match against its
 * own alt text plus a window of surrounding HTML (catches a wrapping `id="poster"`/`class="*poster*"`
 * container even when the tag's own attributes are generic), or by the festival's own name appearing in
 * the URL (see festivalNameMatchesUrl). `<source>` tags explicitly typed "image/webp" are skipped:
 * Bluesky only accepts jpeg/png, and a webp-only candidate would otherwise block a perfectly good
 * sibling source/img in the same `<picture>`.
 */
function extractImageCandidates(html: string, pageUrl: string, festivalName: string | null): ImageCandidate[] {
  const candidates: ImageCandidate[] = [];
  const tagPattern = /<(img|source)\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(html))) {
    const tag = match[0];
    const tagStart = match.index;
    const context = html.slice(Math.max(0, tagStart - CONTEXT_WINDOW), tagStart + tag.length);

    const typeMatch = /\btype=["']([^"']+)["']/i.exec(tag);
    if (typeMatch && typeMatch[1]!.toLowerCase() === "image/webp") continue;

    const altMatch = /\balt=["']([^"']*)["']/i.exec(tag);
    const alt = altMatch ? decodeHtmlEntities(altMatch[1]!) : "";

    const srcsetMatch = /\bsrcset=["']([^"']+)["']/i.exec(tag);
    const srcMatch = /\b(?:src|data-src)=["']([^"']+)["']/i.exec(tag);
    let url: string | null = srcsetMatch ? pickFromSrcset(srcsetMatch[1]!, pageUrl) : null;
    if (!url && srcMatch) {
      try {
        url = new URL(decodeHtmlEntities(srcMatch[1]!), pageUrl).toString();
      } catch {
        url = null;
      }
    }
    if (!url) continue;

    const hasKeyword =
      POSTER_KEYWORD_PATTERN.test(`${url} ${alt} ${context}`) || (festivalName !== null && festivalNameMatchesUrl(url, festivalName));
    candidates.push({ url: wixOriginalUrl(url), hasKeyword });
  }
  return candidates;
}

/**
 * Regex-based image extraction, deliberately NOT LLM-based: verification only confirms a page is the
 * real announcement, it never reports the image URL itself, since an LLM can hallucinate a URL that
 * doesn't actually exist or doesn't actually point at the poster. This mirrors
 * spotify/getPlaylistTracks.ts's approach - a real HTTP fetch and mechanical parse is the only thing
 * trusted to produce a URL that must literally resolve to real bytes.
 *
 * Only ever returns an `<img>`/`<source>` whose alt text, URL, or surrounding HTML context signals it's
 * the designed poster/flyer/artwork graphic (e.g. alt="Coachella 2027 poster", a wrapping `id="poster"`
 * container, or a filename like "Primavera-Sound-2027.jpg" matching the festival's own name - confirmed
 * live necessary: a real press article's hero image used exactly that convention with no "poster"/
 * "flyer"/"artwork" word anywhere) - never the page's og:image/twitter:image social-share meta tag. That
 * meta tag used to be the fallback here, but confirmed live - twice, on this pipeline's first two real
 * posts - that it is very often just a crowd or stage photo from a past event, not the actual poster
 * artwork; the account owner explicitly wants the real poster or nothing, not a photo mislabeled as one.
 * A page with no confidently-identifiable poster image simply returns null here, same as any other
 * extraction failure (see extractPosterImage's doc comment): that festival's poster doesn't post this
 * cycle rather than posting something that's probably wrong.
 *
 * A "pick the single largest real image on the page" fallback was tried and rejected: on a real
 * (Wix-built) festival site, a press photographer's photo (6000x4000) outranked the actual poster
 * (4000x2378) by raw pixel area, which would have posted the exact kind of wrong image this function
 * exists to avoid.
 */
/** Exported for unit testing. festivalName is optional (null skips the name-in-URL signal entirely). */
export function extractImageUrl(html: string, pageUrl: string, festivalName: string | null = null): string | null {
  const keywordMatch = extractImageCandidates(html, pageUrl, festivalName).find((c) => c.hasKeyword);
  return keywordMatch?.url ?? null;
}

/**
 * Fetches a verified announcement page and mechanically extracts its poster image - the real,
 * downloadable bytes of the image actually linked from that page, never a model-reported URL. Never
 * throws: any failure (page fetch error, no usable image found, unsupported content-type, image too
 * large for Bluesky's blob limit, empty body) resolves to null and logs a warning, so a page that can't
 * be mechanically parsed just means that festival's poster doesn't post this cycle - it does NOT block
 * the rest of the run, and the item stays unrecorded so a later cycle can retry (see
 * postFestivalPosters.ts).
 */
export async function extractPosterImage(logger: RunLogger, pageUrl: string, festivalName: string | null = null): Promise<ExtractedPosterImage | null> {
  try {
    const pageRes = await fetch(pageUrl, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!pageRes.ok) throw new Error(`HTTP ${pageRes.status} fetching announcement page`);
    const html = await pageRes.text();

    const imageUrl = extractImageUrl(html, pageUrl, festivalName);
    if (!imageUrl) throw new Error("no usable poster image found on the announcement page");

    const imageRes = await fetch(imageUrl, { signal: AbortSignal.timeout(10000) });
    if (!imageRes.ok) throw new Error(`HTTP ${imageRes.status} fetching image`);

    let mimeType = (imageRes.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(mimeType)) throw new Error(`unsupported image content-type: "${mimeType || "unknown"}"`);

    const declaredLength = Number.parseInt(imageRes.headers.get("content-length") ?? "", 10);
    if (Number.isFinite(declaredLength) && declaredLength > ABSOLUTE_MAX_DOWNLOAD_BYTES) {
      throw new Error(`image is ${declaredLength} bytes (declared), too large to even attempt compressing`);
    }

    let imageBytes: Buffer = Buffer.from(await imageRes.arrayBuffer());
    if (imageBytes.length === 0) throw new Error("image response body was empty");

    if (imageBytes.length > BLUESKY_MAX_IMAGE_BYTES) {
      const compressed = await compressToFit(imageBytes);
      if (!compressed) {
        throw new Error(
          `image is ${imageBytes.length} bytes and could not be compressed under Bluesky's ${BLUESKY_MAX_IMAGE_BYTES}-byte limit`
        );
      }
      imageBytes = compressed.bytes;
      mimeType = compressed.mimeType;
    }

    return { imageUrl, imageBytes, mimeType };
  } catch (err) {
    logger.warn("festival-posters", `Could not extract a usable poster image from ${pageUrl}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
