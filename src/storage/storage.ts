import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import type { AppConfig } from "../config/index.js";
import type { RunLogger } from "../utils/logger.js";

export interface UploadResult {
  publicUrl: string | null;
  provider: "r2" | "s3" | "local";
  skippedReason?: string;
}

/**
 * Shared credential/endpoint check used by every uploader below - factored out so a new uploader
 * (e.g. threads/threadsPublish.ts's image hosting, which has nothing to do with the daily
 * infographic) doesn't have to re-derive the R2-vs-S3 endpoint logic, and so all callers report
 * missing-config the same way.
 */
function resolveStorageClient(
  config: AppConfig,
  logger: RunLogger
): { client: S3Client; bucket: string } | { client: null; bucket: null; skippedReason: string } {
  if (config.storage.provider === "local") {
    logger.info("storage", "STORAGE_PROVIDER=local; skipping remote upload, file stays local only");
    return { client: null, bucket: null, skippedReason: "local storage provider configured" };
  }

  const { bucket, accessKeyId, secretAccessKey, publicBaseUrl } = config.storage;
  if (!bucket || !accessKeyId || !secretAccessKey || !publicBaseUrl) {
    logger.warn("storage", "Storage credentials incomplete; skipping remote upload.");
    return { client: null, bucket: null, skippedReason: "missing storage credentials" };
  }

  const endpoint =
    config.storage.endpoint ??
    (config.storage.provider === "r2" && config.storage.accountId
      ? `https://${config.storage.accountId}.r2.cloudflarestorage.com`
      : undefined);
  if (!endpoint) {
    logger.warn("storage", "No storage endpoint could be determined (missing R2_ACCOUNT_ID or S3_ENDPOINT); skipping upload");
    return { client: null, bucket: null, skippedReason: "missing endpoint" };
  }

  const client = new S3Client({
    region: config.storage.region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    // R2 requires path-style addressing rather than the AWS SDK v3 default of virtual-hosted-style
    // - see the identical, more detailed comment in src/newswire/db/sync.ts, where this was
    // actually observed failing (this pipeline's own upload failures are non-fatal, so the same
    // underlying DNS issue could have been silently skipping archival uploads without being noticed).
    forcePathStyle: true,
  });
  return { client, bucket };
}

/**
 * Uploads raw bytes to the configured object storage under `key` and returns the public HTTPS URL.
 * This is the primitive `uploadImage` below now builds on; it also backs threads/threadsPublish.ts's
 * image hosting, which - unlike Bluesky's direct blob upload - requires Threads' API to fetch the
 * image from a publicly reachable URL, so this is the one place both pipelines share.
 */
export async function uploadBytes(
  config: AppConfig,
  logger: RunLogger,
  key: string,
  body: Buffer,
  contentType: string
): Promise<UploadResult> {
  const resolved = resolveStorageClient(config, logger);
  if (!resolved.client) {
    return { publicUrl: null, provider: config.storage.provider, skippedReason: resolved.skippedReason };
  }

  try {
    await resolved.client.send(
      new PutObjectCommand({
        Bucket: resolved.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
      })
    );
  } catch (err) {
    logger.error("storage", "Upload to object storage failed", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }

  const publicUrl = `${config.storage.publicBaseUrl!.replace(/\/$/, "")}/${key}`;
  logger.info("storage", `Uploaded ${key} -> ${publicUrl}`);
  return { publicUrl, provider: config.storage.provider };
}

/**
 * Uploads the rendered infographic to public object storage (Cloudflare
 * R2 or any S3-compatible bucket) and returns the public HTTPS URL. This
 * gives you a durable public archival copy of what was actually
 * published each day. Bluesky itself does not need this URL - it
 * uploads the image bytes directly - so a storage failure alone does
 * not block publishing, but it does mean losing the archival copy.
 *
 * In local/dev mode (no storage credentials configured), upload is
 * skipped and the caller is told clearly - the file remains on disk at
 * runs/<date>/infographic.png for manual inspection.
 */
export async function uploadImage(
  config: AppConfig,
  logger: RunLogger,
  filePath: string,
  date: string
): Promise<UploadResult> {
  const key = `on-this-day/${date}/${basename(filePath)}`;
  const body = readFileSync(filePath);
  const contentType = filePath.endsWith(".jpg") || filePath.endsWith(".jpeg") ? "image/jpeg" : "image/png";
  return uploadBytes(config, logger, key, body, contentType);
}
