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
  opts: { text: string; reply: { root: PostRef; parent: PostRef } | null }
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
