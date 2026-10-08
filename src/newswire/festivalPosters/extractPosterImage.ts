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

/** Maximum extra words the URL's filename may carry beyond the festival's own name (+ typically a year) before `festivalNameMatchesUrl` gives up - see its doc comment for why this exists. */
const MAX_EXTRA_FILENAME_WORDS = 2;

/**
 * True if the URL's filename is SUBSTANTIALLY the festival's own name (word-by-word, separator-agnostic,
 * plus a little slack for an edition year or one extra qualifier) - e.g. festivalName "Primavera Sound"
 * matches ".../uploads/2026/10/Primavera-Sound-2027.jpg". Confirmed live necessary: a real press
 * article's hero image was uploaded under exactly this convention, no "poster"/"flyer"/"artwork" word
 * anywhere, and was otherwise unfindable.
 *
 * Deliberately checks only the filename, not the whole URL, and requires it be MOSTLY just the festival
 * name rather than merely containing it: confirmed live that a naive "festival name appears anywhere in
 * the URL" version produces a real false positive - some press sites name EVERY image in an article after
 * the article's own page slug (which can legitimately contain the full festival name among a dozen other
 * words - artist names, "ticket", "details", etc.) regardless of what that specific image actually shows,
 * and matched an unrelated editorial photo collage this way.
 */
function festivalNameMatchesUrl(url: string, festivalName: string): boolean {
  const words = festivalName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return false;
  if (words.length === 1 && words[0]!.length < 6) return false;

  let filename: string;
  try {
    filename = new URL(url).pathname.split("/").pop() ?? "";
  } catch {
    return false;
  }
  filename = filename.replace(/\.\w+$/, "");
  const filenameWords = filename.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

  const pattern = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[-_]?"), "i");
  if (!pattern.test(filename)) return false;

  return filenameWords.length - words.length <= MAX_EXTRA_FILENAME_WORDS;
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

/**
 * Picks the largest-width entry from a `srcset` attribute (e.g. "small.jpg 400w, large.jpg 1200w, huge.jpg
 * 2000w") - the designed poster graphic is usually served at its largest resolution, not the
 * first/smallest variant. Splits entries on a comma only when it's immediately followed by what looks
 * like the start of the next URL (a scheme or an absolute path) - NOT on every comma. Confirmed live
 * necessary: a real press site served Cloudinary-transformed URLs with unescaped commas INSIDE each URL's
 * own path (".../w_760,c_limit,f_auto,.../name.jpg"), and candidate entries themselves were also
 * comma-separated with no surrounding whitespace ("...jpg 220w,https://...") - naive comma-splitting
 * corrupted every URL into an unrelated 404 by snapping off a path fragment after some mid-URL comma.
 */
function pickFromSrcset(srcset: string, pageUrl: string): string | null {
  let bestUrl: string | null = null;
  let bestWidth = -1;
  for (const entry of srcset.split(/,(?=\s*(?:https?:\/\/|\/))/)) {
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
 * og:image/twitter:image meta tags, scored by the EXACT SAME rules as `<img>`/`<source>` candidates -
 * never trusted by default. The blind "always use og:image as a fallback" behavior this pipeline shipped
 * with initially was removed after it posted a generic crowd/stage photo twice in production; this is NOT
 * a reintroduction of that - a meta tag only becomes a candidate here if its own surrounding HTML context
 * independently signals "poster" or its URL substantially matches the festival's own name, the same bar
 * every other candidate must clear. Confirmed live valuable: a real press site's auto-generated
 * og:description text explicitly said "...the top three headliners listed on this year's **poster**
 * are...", immediately before an og:image tag that genuinely was the real poster - exactly the kind of
 * independent corroboration this pipeline requires elsewhere (verification's 2-source rule), just applied
 * to image selection instead of fact-checking.
 */
function extractMetaImageCandidates(html: string, pageUrl: string, festivalName: string | null): ImageCandidate[] {
  const candidates: ImageCandidate[] = [];
  const metaPatterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/gi,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/gi,
  ];
  for (const pattern of metaPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html))) {
      const rawUrl = match[1];
      if (!rawUrl) continue;
      let url: string;
      try {
        url = new URL(decodeHtmlEntities(rawUrl), pageUrl).toString();
      } catch {
        continue;
      }
      const tagStart = match.index;
      const context = html.slice(Math.max(0, tagStart - CONTEXT_WINDOW), tagStart + match[0].length);
      const hasKeyword =
        POSTER_KEYWORD_PATTERN.test(`${url} ${context}`) || (festivalName !== null && festivalNameMatchesUrl(url, festivalName));
      candidates.push({ url: wixOriginalUrl(url), hasKeyword });
    }
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
 * Only ever returns a candidate whose own URL, alt text, or surrounding HTML context signals it's the
 * designed poster/flyer/artwork graphic (e.g. alt="Coachella 2027 poster", a wrapping `id="poster"`
 * container, a filename like "Primavera-Sound-2027.jpg" matching the festival's own name, or - for an
 * og:image/twitter:image meta tag specifically - independently corroborating nearby text, see
 * extractMetaImageCandidates). A page's og:image is never trusted just for existing: confirmed live -
 * twice, on this pipeline's first two real posts - that it is very often just a crowd or stage photo from
 * a past event, not the actual poster artwork; the account owner explicitly wants the real poster or
 * nothing, not a photo mislabeled as one. A page with no confidently-identifiable poster image simply
 * returns null here, same as any other extraction failure (see extractPosterImage's doc comment): that
 * festival's poster doesn't post this cycle rather than posting something that's probably wrong.
 *
 * A "pick the single largest real image on the page" fallback was tried and rejected: on a real
 * (Wix-built) festival site, a press photographer's photo (6000x4000) outranked the actual poster
 * (4000x2378) by raw pixel area, which would have posted the exact kind of wrong image this function
 * exists to avoid.
 */
/** Exported for unit testing. festivalName is optional (null skips the name-in-URL signal entirely). */
export function extractImageUrl(html: string, pageUrl: string, festivalName: string | null = null): string | null {
  const candidates = [...extractImageCandidates(html, pageUrl, festivalName), ...extractMetaImageCandidates(html, pageUrl, festivalName)];
  const keywordMatch = candidates.find((c) => c.hasKeyword);
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
