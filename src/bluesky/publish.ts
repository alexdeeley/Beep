import { readFileSync } from "node:fs";
import type { AppConfig } from "../config/index.js";
import type { RunLogger } from "../utils/logger.js";
import type { PublishRecord } from "../utils/types.js";
import { nowIso } from "../utils/dateUtils.js";

/** Hard AT Protocol limits on app.bsky.feed.post's "tags" field - this is
 * NOT the same thing as an in-text "#hashtag" facet. It's separate
 * discovery metadata that most clients render as small, non-intrusive
 * chips rather than inline text, but the protocol caps it at 8 tags of
 * up to 64 graphemes each. There is no way to attach more than 8. */
const BLUESKY_MAX_TAGS = 8;
const BLUESKY_MAX_TAG_GRAPHEMES = 64;

interface CreateSessionResponse {
  accessJwt: string;
  did: string;
}

interface UploadBlobResponse {
  blob: { $type: "blob"; ref: { $link: string }; mimeType: string; size: number };
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

function mimeTypeFor(imagePath: string): string {
  return imagePath.endsWith(".jpg") || imagePath.endsWith(".jpeg") ? "image/jpeg" : "image/png";
}

/**
 * Reduces a pool of "#Hashtag"-style strings down to Bluesky's hard cap of
 * 8 bare (no "#") discovery tags, deduplicated case-insensitively and
 * length-capped per tag. Order is preserved, so callers should put their
 * most important/evergreen tags first.
 */
export function selectBlueskyTags(hashtagPool: string[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of hashtagPool) {
    if (tags.length >= BLUESKY_MAX_TAGS) break;
    const bare = raw.replace(/^#/, "").trim();
    if (!bare) continue;
    const key = bare.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(bare.length > BLUESKY_MAX_TAG_GRAPHEMES ? bare.slice(0, BLUESKY_MAX_TAG_GRAPHEMES) : bare);
  }
  return tags;
}

async function xrpcFetch<T>(service: string, method: string, opts: RequestInit): Promise<T> {
  const res = await fetch(`${service}/xrpc/${method}`, opts);
  const json = (await res.json().catch(() => ({}))) as T & AtprotoError;
  if (!res.ok) {
    throw new BlueskyApiException(`Bluesky API error (${method}): ${json.message ?? json.error ?? `HTTP ${res.status}`}`);
  }
  return json;
}

/**
 * Publishes to Bluesky via the AT Protocol's public HTTP XRPC API:
 *   1. com.atproto.server.createSession  (auth with an app password)
 *   2. com.atproto.repo.uploadBlob       (upload the image bytes directly -
 *      no public URL needed, unlike Telegram/Instagram)
 *   3. com.atproto.repo.createRecord     (create the app.bsky.feed.post
 *      record with an app.bsky.embed.images embed)
 *
 * No app review, no business verification - just an account and an app
 * password (Settings -> App Passwords in the Bluesky app, never your main
 * account password).
 *
 * By design, the visible post "text" is left empty - this account wants
 * image-only posts, not a wall of text. The full descriptive caption goes
 * into the image's "alt" field instead (an accessibility field with no
 * protocol length limit, read by screen readers), and up to 8 discovery
 * tags go into the record's separate "tags" field.
 */
export async function publishToBluesky(
  config: AppConfig,
  logger: RunLogger,
  opts: {
    date: string;
    localImagePath: string | null;
    publicImageUrl: string | null;
    /** Full descriptive text - goes into the image's alt/accessibility field, not the visible post. */
    altText: string;
    /** Up to 8 discovery tags (with or without a leading "#"); trimmed to Bluesky's cap. */
    tags: string[];
    dryRun: boolean;
    alreadyPublished: boolean;
  }
): Promise<PublishRecord> {
  const base: Omit<PublishRecord, "status" | "error" | "postUri"> = {
    date: opts.date,
    attemptedAt: nowIso(),
    publicImageUrl: opts.publicImageUrl,
    caption: opts.altText,
  };

  if (opts.alreadyPublished) {
    logger.info("bluesky", `${opts.date} already has a successful publish on record; refusing to post again`);
    return { ...base, status: "SKIPPED_ALREADY_PUBLISHED", error: null, postUri: null };
  }

  if (opts.dryRun) {
    logger.info("bluesky", "Dry run: Bluesky publish skipped by request (--dry-run)");
    return { ...base, status: "SKIPPED_DRY_RUN", error: null, postUri: null };
  }

  if (!config.bluesky.identifier || !config.bluesky.appPassword) {
    logger.warn(
      "bluesky",
      "BLUESKY_IDENTIFIER / BLUESKY_APP_PASSWORD not configured; publishing skipped. This is expected in development."
    );
    return { ...base, status: "SKIPPED_NO_CREDENTIALS", error: null, postUri: null };
  }

  if (!opts.localImagePath) {
    const error = "No rendered image available to upload; cannot publish without one.";
    logger.error("bluesky", error);
    return { ...base, status: "FAILED", error, postUri: null };
  }

  const { identifier, appPassword, service, maxPublishAttempts } = config.bluesky;
  const tags = selectBlueskyTags(opts.tags);
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= maxPublishAttempts; attempt++) {
    try {
      logger.info("bluesky", `Publish attempt ${attempt}/${maxPublishAttempts}`);

      const session = await xrpcFetch<CreateSessionResponse>(service, "com.atproto.server.createSession", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password: appPassword }),
      });

      const imageBytes = readFileSync(opts.localImagePath);
      const uploaded = await xrpcFetch<UploadBlobResponse>(service, "com.atproto.repo.uploadBlob", {
        method: "POST",
        headers: {
          "Content-Type": mimeTypeFor(opts.localImagePath),
          Authorization: `Bearer ${session.accessJwt}`,
        },
        body: imageBytes,
      });
      logger.info("bluesky", `Uploaded image blob (${uploaded.blob.size} bytes)`);

      const record = await xrpcFetch<CreateRecordResponse>(service, "com.atproto.repo.createRecord", {
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
            text: "", // intentionally empty: image-only posts, no wall of text
            createdAt: nowIso(),
            tags,
            embed: {
              $type: "app.bsky.embed.images",
              images: [{ image: uploaded.blob, alt: opts.altText }],
            },
          },
        }),
      });

      logger.info("bluesky", `Published post ${record.uri}`, { tags });
      return { ...base, status: "SUCCESS", error: null, postUri: record.uri };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      logger.warn("bluesky", `Publish attempt ${attempt} failed: ${lastError}`);
      if (attempt < maxPublishAttempts) {
        const backoffMs = 2000 * 2 ** (attempt - 1);
        await sleep(backoffMs);
      }
    }
  }

  logger.error("bluesky", `All ${maxPublishAttempts} publish attempts failed`, { lastError });
  return { ...base, status: "FAILED", error: lastError, postUri: null };
}
