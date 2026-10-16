import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { AppConfig } from "../config/index.js";
import type { RunLogger } from "../utils/logger.js";

/**
 * A Threads long-lived access token, as persisted to R2. `obtainedAt`/`expiresAt` are both ISO
 * timestamps so loadOrRefreshThreadsToken can decide, on every run, whether the token is old enough
 * to be eligible for Meta's refresh endpoint (>=24h since issuance) without needing to decode the
 * opaque token string itself.
 */
export interface StoredThreadsToken {
  accessToken: string;
  obtainedAt: string;
  expiresAt: string;
}

const REFRESH_ELIGIBLE_AFTER_MS = 24 * 60 * 60 * 1000;
// Refresh a bit before the 60-day expiry, not right at it, so a run that's merely a few hours late
// (cron drift, a skipped day) doesn't land exactly on an already-expired token.
const REFRESH_WHEN_REMAINING_MS = 10 * 24 * 60 * 60 * 1000;

function buildClient(config: AppConfig): { client: S3Client; bucket: string } | null {
  const { bucket, accessKeyId, secretAccessKey } = config.storage;
  if (config.storage.provider === "local" || !bucket || !accessKeyId || !secretAccessKey) return null;
  const endpoint =
    config.storage.endpoint ??
    (config.storage.provider === "r2" && config.storage.accountId
      ? `https://${config.storage.accountId}.r2.cloudflarestorage.com`
      : undefined);
  if (!endpoint) return null;
  return {
    client: new S3Client({
      region: config.storage.region,
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    }),
    bucket,
  };
}

async function readStream(body: unknown): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function downloadStoredToken(config: AppConfig, logger: RunLogger): Promise<StoredThreadsToken | null> {
  const built = buildClient(config);
  if (!built) return null;
  try {
    const result = await built.client.send(new GetObjectCommand({ Bucket: built.bucket, Key: config.threads.tokenR2Key }));
    if (!result.Body) return null;
    return JSON.parse(await readStream(result.Body)) as StoredThreadsToken;
  } catch (err) {
    const code = (err as { name?: string }).name;
    if (code === "NoSuchKey" || code === "NotFound") return null;
    logger.warn("threads-auth", `Failed to read stored Threads token from R2: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function uploadStoredToken(config: AppConfig, logger: RunLogger, token: StoredThreadsToken): Promise<void> {
  const built = buildClient(config);
  if (!built) return;
  await built.client.send(
    new PutObjectCommand({
      Bucket: built.bucket,
      Key: config.threads.tokenR2Key,
      Body: JSON.stringify(token),
      ContentType: "application/json",
    })
  );
  logger.info("threads-auth", `Stored refreshed Threads token in R2 (expires ${token.expiresAt})`);
}

interface ThreadsTokenResponse {
  access_token: string;
  expires_in: number; // seconds
}

/** One-time exchange of a short-lived (1h) user token for a long-lived (60d) one - called only by the news:threads-setup CLI command, never by the regular pipeline. appSecret is the Meta app's own client secret (from the developer app's dashboard), required by this specific endpoint even though it's otherwise a user-token flow. */
export async function exchangeForLongLivedToken(
  config: AppConfig,
  shortLivedToken: string,
  appSecret: string
): Promise<StoredThreadsToken> {
  const url = new URL(`${config.threads.apiBase}/access_token`);
  url.searchParams.set("grant_type", "th_exchange_token");
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("access_token", shortLivedToken);

  const res = await fetch(url.toString());
  const json = (await res.json().catch(() => ({}))) as ThreadsTokenResponse & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Threads token exchange failed: ${json.error?.message ?? `HTTP ${res.status}`}`);

  const now = new Date();
  return {
    accessToken: json.access_token,
    obtainedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + json.expires_in * 1000).toISOString(),
  };
}

async function refreshLongLivedToken(config: AppConfig, current: StoredThreadsToken): Promise<StoredThreadsToken> {
  const url = new URL(`${config.threads.apiBase}/refresh_access_token`);
  url.searchParams.set("grant_type", "th_refresh_token");
  url.searchParams.set("access_token", current.accessToken);

  const res = await fetch(url.toString());
  const json = (await res.json().catch(() => ({}))) as ThreadsTokenResponse & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Threads token refresh failed: ${json.error?.message ?? `HTTP ${res.status}`}`);

  const now = new Date();
  return {
    accessToken: json.access_token,
    obtainedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + json.expires_in * 1000).toISOString(),
  };
}

/** Writes the initial long-lived token to R2 - called only by the news:threads-setup CLI command, right after exchangeForLongLivedToken. */
export async function seedThreadsToken(config: AppConfig, logger: RunLogger, token: StoredThreadsToken): Promise<void> {
  await uploadStoredToken(config, logger, token);
}

/**
 * Loads the current Threads token from R2, refreshing it first if it's old enough to be refresh
 *-eligible (>=24h since last obtained) and getting close to its 60-day expiry. Returns null - never
 * throws - if nothing is stored yet (news:threads-setup hasn't been run), storage isn't configured,
 * or the refresh call itself fails (e.g. the token already fully expired past 60 days unrefreshed,
 * which requires the account owner to redo the OAuth flow and re-run news:threads-setup; this is
 * logged clearly so that's discoverable, but it must never block the rest of the pipeline).
 */
export async function loadOrRefreshThreadsToken(config: AppConfig, logger: RunLogger): Promise<string | null> {
  const stored = await downloadStoredToken(config, logger);
  if (!stored) {
    logger.info("threads-auth", "No Threads token stored in R2 yet - run `npm run news:threads-setup` once to enable cross-posting");
    return null;
  }

  const now = Date.now();
  const age = now - new Date(stored.obtainedAt).getTime();
  const remaining = new Date(stored.expiresAt).getTime() - now;

  if (remaining <= 0) {
    logger.warn("threads-auth", "Stored Threads token has already expired and can no longer be refreshed - re-run `npm run news:threads-setup` to re-authenticate");
    return null;
  }

  if (age < REFRESH_ELIGIBLE_AFTER_MS || remaining > REFRESH_WHEN_REMAINING_MS) {
    return stored.accessToken;
  }

  try {
    const refreshed = await refreshLongLivedToken(config, stored);
    await uploadStoredToken(config, logger, refreshed);
    return refreshed.accessToken;
  } catch (err) {
    logger.warn("threads-auth", `Threads token refresh failed, falling back to current token: ${err instanceof Error ? err.message : String(err)}`);
    return stored.accessToken;
  }
}
