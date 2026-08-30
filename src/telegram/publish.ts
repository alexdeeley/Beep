import type { AppConfig } from "../config/index.js";
import type { RunLogger } from "../utils/logger.js";
import type { PublishRecord } from "../utils/types.js";
import { nowIso } from "../utils/dateUtils.js";

interface TelegramApiError {
  ok: false;
  error_code: number;
  description: string;
}

interface TelegramSendPhotoResult {
  ok: true;
  result: { message_id: number };
}

class TelegramApiException extends Error {}

/** Telegram photo captions are capped at 1024 characters. */
const TELEGRAM_CAPTION_LIMIT = 1024;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateForTelegram(caption: string): string {
  if (caption.length <= TELEGRAM_CAPTION_LIMIT) return caption;
  return caption.slice(0, TELEGRAM_CAPTION_LIMIT - 1) + "…";
}

/**
 * Publishes to a Telegram channel via the official Bot API - a single
 * `sendPhoto` call with the public image URL (from src/storage) and the
 * caption. No app review, no business verification, no browser
 * automation: just a bot token and the target channel/chat ID.
 *
 * Docs: https://core.telegram.org/bots/api#sendphoto
 */
export async function publishToTelegram(
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
  const base: Omit<PublishRecord, "status" | "error" | "messageId"> = {
    date: opts.date,
    attemptedAt: nowIso(),
    publicImageUrl: opts.publicImageUrl,
    caption: opts.caption,
  };

  if (opts.alreadyPublished) {
    logger.info("telegram", `${opts.date} already has a successful publish on record; refusing to post again`);
    return { ...base, status: "SKIPPED_ALREADY_PUBLISHED", error: null, messageId: null };
  }

  if (opts.dryRun) {
    logger.info("telegram", "Dry run: Telegram publish skipped by request (--dry-run)");
    return { ...base, status: "SKIPPED_DRY_RUN", error: null, messageId: null };
  }

  if (!config.telegram.botToken || !config.telegram.chatId) {
    logger.warn(
      "telegram",
      "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not configured; publishing skipped. This is expected in development."
    );
    return { ...base, status: "SKIPPED_NO_CREDENTIALS", error: null, messageId: null };
  }

  if (!opts.publicImageUrl) {
    const error = "No public image URL available (storage upload was skipped or failed); cannot publish without one.";
    logger.error("telegram", error);
    return { ...base, status: "FAILED", error, messageId: null };
  }

  const { botToken, chatId, maxPublishAttempts } = config.telegram;
  const url = `https://api.telegram.org/bot${botToken}/sendPhoto`;
  const caption = truncateForTelegram(opts.caption);
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= maxPublishAttempts; attempt++) {
    try {
      logger.info("telegram", `Publish attempt ${attempt}/${maxPublishAttempts}`);

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          photo: opts.publicImageUrl,
          caption,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as TelegramSendPhotoResult | TelegramApiError;

      if (!res.ok || json.ok !== true) {
        const description = "description" in json ? json.description : `HTTP ${res.status}`;
        throw new TelegramApiException(`Telegram API error: ${description}`);
      }

      logger.info("telegram", `Published message ${json.result.message_id} to chat ${chatId}`);
      return {
        ...base,
        status: "SUCCESS",
        error: null,
        messageId: String(json.result.message_id),
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      logger.warn("telegram", `Publish attempt ${attempt} failed: ${lastError}`);
      if (attempt < maxPublishAttempts) {
        const backoffMs = 2000 * 2 ** (attempt - 1);
        await sleep(backoffMs);
      }
    }
  }

  logger.error("telegram", `All ${maxPublishAttempts} publish attempts failed`, { lastError });
  return { ...base, status: "FAILED", error: lastError, messageId: null };
}
