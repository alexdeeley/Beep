import { createWriteStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { AppConfig } from "../../config/index.js";
import type { RunLogger } from "../../utils/logger.js";

export interface StoryDbHandle {
  client: S3Client | null;
  bucket: string | null;
  key: string;
  /** ETag of the object as downloaded, used as an optimistic-concurrency guard on upload. Null on first-ever run. */
  downloadedEtag: string | null;
}

function buildClient(config: AppConfig): { client: S3Client; bucket: string } | null {
  const { bucket, accessKeyId, secretAccessKey } = config.storage;
  if (config.storage.provider === "local" || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }
  const endpoint =
    config.storage.endpoint ??
    (config.storage.provider === "r2" && config.storage.accountId
      ? `https://${config.storage.accountId}.r2.cloudflarestorage.com`
      : undefined);
  if (!endpoint) return null;

  const client = new S3Client({
    region: config.storage.region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  return { client, bucket };
}

/**
 * Downloads the story database from R2 to `localPath`. A missing object
 * (NoSuchKey / 404, or no storage credentials at all) is not an error -
 * it means this is the first run ever, or a local/dev environment - the
 * caller proceeds with a fresh empty file and migrations create the
 * schema from nothing.
 */
export async function downloadStoryDb(
  config: AppConfig,
  logger: RunLogger,
  localPath: string
): Promise<StoryDbHandle> {
  const built = buildClient(config);
  if (!built) {
    logger.warn("db-sync", "No storage credentials configured; using a local-only story database (state will not persist between runs)");
    return { client: null, bucket: null, key: config.news.dbR2Key, downloadedEtag: null };
  }
  const { client, bucket } = built;
  const key = config.news.dbR2Key;

  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!result.Body) throw new Error("empty response body");
    await pipeline(result.Body as Readable, createWriteStream(localPath));
    logger.info("db-sync", `Downloaded story database from r2://${bucket}/${key}`);
    return { client, bucket, key, downloadedEtag: result.ETag ?? null };
  } catch (err) {
    const code = (err as { name?: string; Code?: string }).name ?? (err as { Code?: string }).Code;
    if (code === "NoSuchKey" || code === "NotFound") {
      logger.info("db-sync", `No existing story database at r2://${bucket}/${key} - starting fresh (first run)`);
      return { client, bucket, key, downloadedEtag: null };
    }
    logger.error("db-sync", "Failed to download story database from R2", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

/**
 * Uploads the local story database back to R2. If the object changed
 * since we downloaded it (ETag mismatch), this throws rather than
 * silently clobbering a concurrent run's writes - the GitHub Actions
 * concurrency lock is the primary defense against that ever happening,
 * this is a second line of defense in case that lock is ever removed.
 */
export async function uploadStoryDb(handle: StoryDbHandle, logger: RunLogger, localPath: string): Promise<void> {
  if (!handle.client || !handle.bucket) {
    logger.warn("db-sync", "No storage credentials configured; story database changes will NOT persist");
    return;
  }
  if (!existsSync(localPath)) {
    logger.warn("db-sync", "Local story database file missing at upload time; skipping upload");
    return;
  }

  const body = await readFile(localPath);
  const put = new PutObjectCommand({
    Bucket: handle.bucket,
    Key: handle.key,
    Body: body,
    ContentType: "application/x-sqlite3",
    ...(handle.downloadedEtag ? { IfMatch: handle.downloadedEtag } : {}),
  });

  try {
    await handle.client.send(put);
    logger.info("db-sync", `Uploaded story database to r2://${handle.bucket}/${handle.key}`);
  } catch (err) {
    const code = (err as { name?: string }).name;
    if (code === "PreconditionFailed") {
      logger.error(
        "db-sync",
        "Story database changed in R2 since it was downloaded (another run wrote to it concurrently) - refusing to overwrite. This should be prevented by the GitHub Actions concurrency lock; if it happened, investigate the workflow config."
      );
    }
    throw err;
  }
}
