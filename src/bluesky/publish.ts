import { readFileSync } from "node:fs";
import type { AppConfig } from "../config/index.js";
import type { RunLogger } from "../utils/logger.js";
import type { PublishRecord } from "../utils/types.js";
import { nowIso } from "../utils/dateUtils.js";

/** app.bsky.feed.post caps text at 300 graphemes. We approximate graphemes
 * with JS string length, which is safe for the plain-ASCII captions this
 * pipeline generates (no multi-code-unit emoji in practice). */
const BLUESKY_TEXT_LIMIT = 300;

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

function truncateForBluesky(caption: string): string {
  if (caption.length <= BLUESKY_TEXT_LIMIT) return caption;
  return caption.slice(0, BLUESKY_TEXT_LIMIT - 1) + "…";
}

function mimeTypeFor(imagePath: string): string {
  return imagePath.endsWith(".jpg") || imagePath.endsWith(".jpeg") ? "image/jpeg" : "image/png";
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
 */
export async function publishToBluesky(
  config: AppConfig,
  logger: RunLogger,
  opts: {
    date: string;
    localImagePath: string | null;
    publicImageUrl: string | null;
    caption: string;
    dryRun: boolean;
    alreadyPublished: boolean;
  }
): Promise<PublishRecord> {
  const base: Omit<PublishRecord, "status" | "error" | "postUri"> = {
    date: opts.date,
    attemptedAt: nowIso(),
    publicImageUrl: opts.publicImageUrl,
    caption: opts.caption,
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
  const text = truncateForBluesky(opts.caption);
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
            text,
            createdAt: nowIso(),
            embed: {
              $type: "app.bsky.embed.images",
              images: [{ image: uploaded.blob, alt: "On This Day historical infographic" }],
            },
          },
        }),
      });

      logger.info("bluesky", `Published post ${record.uri}`);
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
