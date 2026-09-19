import type { AppConfig } from "../config/index.js";
import type { RunLogger } from "../utils/logger.js";
import { nowIso } from "../utils/dateUtils.js";

/**
 * The AT Protocol lexicon's hard limit on app.bsky.feed.post's "text"
 * field, in grapheme clusters. Fixed protocol constant, not queryable via
 * any XRPC endpoint - same reasoning publish.ts already uses for its own
 * hardcoded tag limits (BLUESKY_MAX_TAGS/BLUESKY_MAX_TAG_GRAPHEMES).
 */
export const BLUESKY_MAX_POST_GRAPHEMES = 300;

export interface BlueskySession {
  accessJwt: string;
  did: string;
}

export interface PostRef {
  uri: string;
  cid: string;
}

/** A single `app.bsky.richtext.facet` link annotation - the AT Protocol's way of making a URL substring clickable, independent of whatever plain-text auto-linking (or lack of it) a given client does on its own. */
export interface LinkFacet {
  index: { byteStart: number; byteEnd: number };
  features: { $type: "app.bsky.richtext.facet#link"; uri: string }[];
}

/**
 * Builds a facet marking `url` as a clickable link, at whichever byte
 * offset it occurs in `text` - AT Protocol facet offsets are UTF-8 byte
 * indices, not JS string/grapheme indices, so this must measure with
 * Buffer.byteLength rather than String.indexOf's character position.
 * Returns null if `url` isn't actually present in `text` (should not
 * happen for callers that just built `text` themselves, but this is
 * cheap insurance against ever attaching a facet with the wrong offset).
 */
export function buildLinkFacet(text: string, url: string): LinkFacet | null {
  const charIndex = text.indexOf(url);
  if (charIndex === -1) return null;
  const byteStart = Buffer.byteLength(text.slice(0, charIndex), "utf8");
  const byteEnd = byteStart + Buffer.byteLength(url, "utf8");
  return { index: { byteStart, byteEnd }, features: [{ $type: "app.bsky.richtext.facet#link", uri: url }] };
}

interface CreateSessionResponse {
  accessJwt: string;
  did: string;
}

interface CreateRecordResponse {
  uri: string;
  cid: string;
}

interface AtprotoError {
  error?: string;
  message?: string;
}

class BlueskyApiException extends Error {}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function xrpcFetch<T>(service: string, method: string, opts: RequestInit): Promise<T> {
  const res = await fetch(`${service}/xrpc/${method}`, opts);
  const json = (await res.json().catch(() => ({}))) as T & AtprotoError;
  if (!res.ok) {
    throw new BlueskyApiException(`Bluesky API error (${method}): ${json.message ?? json.error ?? `HTTP ${res.status}`}`);
  }
  return json;
}

/** Authenticates once per thread - every post in the thread reuses this session rather than re-authenticating per post. */
export async function createBlueskySession(config: AppConfig): Promise<BlueskySession> {
  if (!config.bluesky.identifier || !config.bluesky.appPassword) {
    throw new Error("BLUESKY_IDENTIFIER / BLUESKY_APP_PASSWORD not configured");
  }
  const session = await xrpcFetch<CreateSessionResponse>(config.bluesky.service, "com.atproto.server.createSession", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: config.bluesky.identifier, password: config.bluesky.appPassword }),
  });
  return { accessJwt: session.accessJwt, did: session.did };
}

/**
 * Posts a single text-only message, either as the thread root (reply:
 * null) or as a reply (reply.root/reply.parent both required by the
 * lexicon on every non-root post - root stays the same throughout,
 * parent is always the immediately preceding post). Retries transient
 * failures with the same exponential backoff as publish.ts
 * (2s/4s/8s/...); once retries are exhausted, throws rather than
 * silently continuing, so the caller can stop the thread there instead
 * of risking a broken or duplicated chain.
 */
export async function postThreadMessage(
  config: AppConfig,
  logger: RunLogger,
  session: BlueskySession,
  opts: { text: string; reply: { root: PostRef; parent: PostRef } | null; facets?: LinkFacet[] }
): Promise<PostRef> {
  if (opts.text.length === 0) {
    throw new Error("postThreadMessage: refusing to post empty text");
  }

  const { maxPublishAttempts } = config.bluesky;
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= maxPublishAttempts; attempt++) {
    try {
      const record = await xrpcFetch<CreateRecordResponse>(config.bluesky.service, "com.atproto.repo.createRecord", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessJwt}`,
        },
        body: JSON.stringify({
          repo: session.did,
          collection: "app.bsky.feed.post",
          record: {
            $type: "app.bsky.feed.post",
            text: opts.text,
            createdAt: nowIso(),
            ...(opts.reply ? { reply: opts.reply } : {}),
            ...(opts.facets && opts.facets.length > 0 ? { facets: opts.facets } : {}),
          },
        }),
      });
      return { uri: record.uri, cid: record.cid };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      logger.warn("bluesky-thread", `Post attempt ${attempt}/${maxPublishAttempts} failed: ${lastError}`);
      if (attempt < maxPublishAttempts) {
        await sleep(2000 * 2 ** (attempt - 1));
      }
    }
  }

  throw new Error(`postThreadMessage: all ${maxPublishAttempts} attempts failed: ${lastError}`);
}

/**
 * Posts a standalone image post (uploadBlob then createRecord with an
 * app.bsky.embed.images embed) - the only other place this pipeline
 * uploads image bytes is bluesky/publish.ts, which is tightly coupled to
 * the daily art pipeline's own caption/tag/image-only conventions
 * (empty visible text, alt-only caption, discovery tags). This is a
 * simpler standalone variant for the newswire pipeline: real visible
 * text (a post here should say what it is, not rely on alt text alone),
 * no reply chain, no tags. Used by festivalPosters/postFestivalPosters.ts
 * to post an already-fetched, already-verified poster image.
 */
export async function postImageMessage(
  config: AppConfig,
  logger: RunLogger,
  session: BlueskySession,
  opts: { text: string; altText: string; imageBytes: Buffer; mimeType: string }
): Promise<PostRef> {
  if (opts.text.length === 0) {
    throw new Error("postImageMessage: refusing to post empty text");
  }

  const { maxPublishAttempts } = config.bluesky;
  let lastError: string | null = null;

  // Node's Buffer/Uint8Array is generically typed over ArrayBufferLike, which isn't structurally
  // assignable to DOM lib's BodyInit (typed over the narrower plain ArrayBuffer) - a known TS/Node
  // typed-array generics mismatch. Copying into a fresh plain ArrayBuffer sidesteps it cleanly.
  const bodyBuffer = new ArrayBuffer(opts.imageBytes.byteLength);
  new Uint8Array(bodyBuffer).set(opts.imageBytes);

  for (let attempt = 1; attempt <= maxPublishAttempts; attempt++) {
    try {
      const uploaded = await xrpcFetch<{ blob: { $type: "blob"; ref: { $link: string }; mimeType: string; size: number } }>(
        config.bluesky.service,
        "com.atproto.repo.uploadBlob",
        {
          method: "POST",
          headers: { "Content-Type": opts.mimeType, Authorization: `Bearer ${session.accessJwt}` },
          body: bodyBuffer,
        }
      );
      logger.info("bluesky-thread", `Uploaded image blob (${uploaded.blob.size} bytes)`);

      const record = await xrpcFetch<CreateRecordResponse>(config.bluesky.service, "com.atproto.repo.createRecord", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessJwt}`,
        },
        body: JSON.stringify({
          repo: session.did,
          collection: "app.bsky.feed.post",
          record: {
            $type: "app.bsky.feed.post",
            text: opts.text,
            createdAt: nowIso(),
            embed: {
              $type: "app.bsky.embed.images",
              images: [{ image: uploaded.blob, alt: opts.altText }],
            },
          },
        }),
      });
      return { uri: record.uri, cid: record.cid };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      logger.warn("bluesky-thread", `Image post attempt ${attempt}/${maxPublishAttempts} failed: ${lastError}`);
      if (attempt < maxPublishAttempts) {
        await sleep(2000 * 2 ** (attempt - 1));
      }
    }
  }

  throw new Error(`postImageMessage: all ${maxPublishAttempts} attempts failed: ${lastError}`);
}
