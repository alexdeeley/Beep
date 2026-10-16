import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config/index.js";
import type { RunLogger } from "../utils/logger.js";
import { uploadBytes } from "../storage/storage.js";

class ThreadsApiException extends Error {}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function threadsFetch<T>(url: string, opts: RequestInit): Promise<T> {
  const res = await fetch(url, opts);
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new ThreadsApiException(`Threads API error: ${json.error?.message ?? `HTTP ${res.status}`}`);
  }
  return json;
}

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Threads' media-container API (unlike Bluesky's uploadBlob) has no byte-upload endpoint - it only
 * accepts a publicly fetchable image_url and fetches the bytes itself. Re-hosts the same
 * already-extracted, already-verified poster bytes this run also sent to Bluesky, under a
 * throwaway unique key (no relation to the daily infographic's on-this-day/<date>/ key scheme) since
 * these exist purely so Threads' servers have something to fetch, not for archival purposes - R2's
 * lifecycle/retention is left at whatever the bucket's default is. Returns null (never throws) if
 * storage isn't configured, matching uploadBytes's own no-throw-on-missing-config contract.
 */
export async function uploadImageForThreads(
  config: AppConfig,
  logger: RunLogger,
  imageBytes: Buffer,
  mimeType: string
): Promise<string | null> {
  const ext = MIME_EXTENSIONS[mimeType] ?? "jpg";
  const key = `threads/images/${randomUUID()}.${ext}`;
  const result = await uploadBytes(config, logger, key, imageBytes, mimeType);
  return result.publicUrl;
}

interface MediaContainerResponse {
  id: string;
}

/** Step 1 of Threads' two-step publish flow: creates a media container referencing the hosted image. altText is passed as Threads' own separate `alt_text` field, never folded into the visible `text` caption - this pipeline posts image-only, same convention as Bluesky. text is omitted entirely (not even an empty string) since Threads treats an empty text field differently from an absent one in some client libraries. */
async function createMediaContainer(
  config: AppConfig,
  accessToken: string,
  opts: { imageUrl: string; altText: string }
): Promise<string> {
  const url = new URL(`${config.threads.apiBase}/${config.threads.userId}/threads`);
  url.searchParams.set("media_type", "IMAGE");
  url.searchParams.set("image_url", opts.imageUrl);
  url.searchParams.set("alt_text", opts.altText);
  url.searchParams.set("access_token", accessToken);

  const created = await threadsFetch<MediaContainerResponse>(url.toString(), { method: "POST" });
  return created.id;
}

/** Step 2: publishes a previously-created media container. Threads needs a short delay after container creation before the container is ready to publish - retried with backoff rather than a fixed sleep, mirroring threadPublish.ts's retry convention for Bluesky. */
async function publishMediaContainer(config: AppConfig, accessToken: string, creationId: string): Promise<string> {
  const url = new URL(`${config.threads.apiBase}/${config.threads.userId}/threads_publish`);
  url.searchParams.set("creation_id", creationId);
  url.searchParams.set("access_token", accessToken);

  const maxAttempts = 4;
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const published = await threadsFetch<MediaContainerResponse>(url.toString(), { method: "POST" });
      return published.id;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < maxAttempts) await sleep(2000 * 2 ** (attempt - 1));
    }
  }
  throw new Error(`publishMediaContainer: all ${maxAttempts} attempts failed: ${lastError}`);
}

/** Full two-step publish of a single image-only Threads post. Returns the published post's id. */
export async function postImageToThreads(
  config: AppConfig,
  accessToken: string,
  opts: { imageUrl: string; altText: string }
): Promise<string> {
  const creationId = await createMediaContainer(config, accessToken, opts);
  return publishMediaContainer(config, accessToken, creationId);
}
