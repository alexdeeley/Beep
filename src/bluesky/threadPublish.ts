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

export interface RichTextFacet {
  index: { byteStart: number; byteEnd: number };
  features: { $type: "app.bsky.richtext.facet#link"; uri: string }[];
}

/**
 * Without a facet, a URL in post text renders as plain, non-clickable text - the AT Protocol lexicon
 * has no auto-linkification. `index` must be UTF-8 BYTE offsets into `text` (not grapheme or UTF-16
 * offsets), per app.bsky.richtext.facet - Buffer.byteLength on the prefix and on the url itself gives
 * the correct offsets even when the text contains multi-byte characters before the link. Returns null
 * if the exact url string isn't found verbatim in text (e.g. a thread split moved it to another post),
 * so the caller can fall back to posting plain text rather than attaching a facet pointing at the wrong
 * range.
 */
export function buildLinkFacet(text: string, url: string): RichTextFacet | null {
  const charIndex = text.indexOf(url);
  if (charIndex === -1) return null;
  const byteStart = Buffer.byteLength(text.slice(0, charIndex), "utf8");
  const byteEnd = byteStart + Buffer.byteLength(url, "utf8");
  return {
    index: { byteStart, byteEnd },
    features: [{ $type: "app.bsky.richtext.facet#link", uri: url }],
  };
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
  opts: { text: string; reply: { root: PostRef; parent: PostRef } | null; facets?: RichTextFacet[] }
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
