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
 * Uploads the rendered infographic to public object storage (Cloudflare
 * R2 or any S3-compatible bucket) and returns the public HTTPS URL the
 * Telegram Bot API needs to fetch the image from.
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
  if (config.storage.provider === "local") {
    logger.info("storage", "STORAGE_PROVIDER=local; skipping remote upload, image stays on local disk only");
    return { publicUrl: null, provider: "local", skippedReason: "local storage provider configured" };
  }

  const { bucket, accessKeyId, secretAccessKey, publicBaseUrl } = config.storage;
  if (!bucket || !accessKeyId || !secretAccessKey || !publicBaseUrl) {
    logger.warn(
      "storage",
      "Storage credentials incomplete; skipping remote upload. Telegram publish will be skipped too since it requires a public image URL."
    );
    return { publicUrl: null, provider: config.storage.provider, skippedReason: "missing storage credentials" };
  }

  const endpoint =
    config.storage.endpoint ??
    (config.storage.provider === "r2" && config.storage.accountId
      ? `https://${config.storage.accountId}.r2.cloudflarestorage.com`
      : undefined);
  if (!endpoint) {
    logger.warn("storage", "No storage endpoint could be determined (missing R2_ACCOUNT_ID or S3_ENDPOINT); skipping upload");
    return { publicUrl: null, provider: config.storage.provider, skippedReason: "missing endpoint" };
  }

  const client = new S3Client({
    region: config.storage.region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  const key = `on-this-day/${date}/${basename(filePath)}`;
  const body = readFileSync(filePath);
  const contentType = filePath.endsWith(".jpg") || filePath.endsWith(".jpeg") ? "image/jpeg" : "image/png";

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
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

  const publicUrl = `${publicBaseUrl.replace(/\/$/, "")}/${key}`;
  logger.info("storage", `Uploaded ${filePath} -> ${publicUrl}`);
  return { publicUrl, provider: config.storage.provider };
}
