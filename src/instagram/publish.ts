import type { AppConfig } from "../config/index.js";
import type { RunLogger } from "../utils/logger.js";
import type { PublishRecord } from "../utils/types.js";
import { nowIso } from "../utils/dateUtils.js";

interface GraphErrorBody {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number };
}

class GraphApiError extends Error {
  constructor(message: string, public readonly body?: unknown) {
    super(message);
    this.name = "GraphApiError";
  }
}

function graphUrl(config: AppConfig, path: string): string {
  return `https://graph.facebook.com/${config.instagram.apiVersion}/${path}`;
}

async function graphFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = (await res.json().catch(() => ({}))) as T & GraphErrorBody;
  if (!res.ok || json.error) {
    throw new GraphApiError(json.error?.message ?? `Graph API request failed with HTTP ${res.status}`, json);
  }
  return json;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Official Meta/Instagram Graph API publishing flow:
 *   1. POST /{ig-user-id}/media          -> creation_id (container)
 *   2. GET  /{creation_id}?fields=status_code  (poll until FINISHED)
 *   3. POST /{ig-user-id}/media_publish  -> media id
 *
 * No browser automation, no unofficial login flow. Requires an Instagram
 * Professional account connected to a Meta app with the
 * instagram_content_publish permission, and the image at a public HTTPS
 * URL (see src/storage).
 */
export async function publishToInstagram(
  config: AppConfig,
  logger: RunLogger,
  opts: {
    date: string;
    publicImageUrl: string | null;
    caption: string;
    dryRun: boolean;
    alreadyPublished: boolean;
  }
): Promise<PublishRecord> {
  const base: Omit<PublishRecord, "status" | "error" | "containerId" | "mediaId"> = {
    date: opts.date,
    attemptedAt: nowIso(),
    publicImageUrl: opts.publicImageUrl,
    caption: opts.caption,
  };

  if (opts.alreadyPublished) {
    logger.info("instagram", `${opts.date} already has a successful publish on record; refusing to post again`);
    return { ...base, status: "SKIPPED_ALREADY_PUBLISHED", error: null, containerId: null, mediaId: null };
  }

  if (opts.dryRun) {
    logger.info("instagram", "Dry run: Instagram publish skipped by request (--dry-run)");
    return { ...base, status: "SKIPPED_DRY_RUN", error: null, containerId: null, mediaId: null };
  }

  if (!config.instagram.accessToken || !config.instagram.userId) {
    logger.warn(
      "instagram",
      "INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_USER_ID not configured; publishing skipped. This is expected in development."
    );
    return { ...base, status: "SKIPPED_NO_CREDENTIALS", error: null, containerId: null, mediaId: null };
  }

  if (!opts.publicImageUrl) {
    const error = "No public image URL available (storage upload was skipped or failed); cannot publish without one.";
    logger.error("instagram", error);
    return { ...base, status: "FAILED", error, containerId: null, mediaId: null };
  }

  const { accessToken, userId, maxPublishAttempts } = config.instagram;
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= maxPublishAttempts; attempt++) {
    try {
      logger.info("instagram", `Publish attempt ${attempt}/${maxPublishAttempts}`);

      const container = await graphFetch<{ id: string }>(graphUrl(config, `${userId}/media`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: opts.publicImageUrl,
          caption: opts.caption,
          access_token: accessToken,
        }),
      });
      logger.info("instagram", `Created media container ${container.id}`);

      await waitForContainerReady(config, logger, container.id, accessToken);

      const published = await graphFetch<{ id: string }>(graphUrl(config, `${userId}/media_publish`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creation_id: container.id, access_token: accessToken }),
      });

      logger.info("instagram", `Published media ${published.id}`);
      return {
        ...base,
        status: "SUCCESS",
        error: null,
        containerId: container.id,
        mediaId: published.id,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      logger.warn("instagram", `Publish attempt ${attempt} failed: ${lastError}`);
      if (attempt < maxPublishAttempts) {
        const backoffMs = 2000 * 2 ** (attempt - 1);
        await sleep(backoffMs);
      }
    }
  }

  logger.error("instagram", `All ${maxPublishAttempts} publish attempts failed`, { lastError });
  return { ...base, status: "FAILED", error: lastError, containerId: null, mediaId: null };
}

async function waitForContainerReady(
  config: AppConfig,
  logger: RunLogger,
  containerId: string,
  accessToken: string
): Promise<void> {
  const { containerPollAttempts, containerPollDelayMs } = config.instagram;
  for (let i = 0; i < containerPollAttempts; i++) {
    const status = await graphFetch<{ status_code: string }>(
      graphUrl(config, `${containerId}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`)
    );
    logger.debug("instagram", `Container ${containerId} status: ${status.status_code} (poll ${i + 1}/${containerPollAttempts})`);
    if (status.status_code === "FINISHED") return;
    if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
      throw new GraphApiError(`Media container entered terminal state ${status.status_code}`);
    }
    await sleep(containerPollDelayMs);
  }
  throw new GraphApiError(`Media container ${containerId} did not become ready within the polling window`);
}
