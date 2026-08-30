import type { AppConfig } from "../config/index.js";
import type { RunLogger } from "../utils/logger.js";
import { makeOpenAIClient, requestJson } from "../utils/openaiClient.js";
import type { CaptionResult, SelectedContent } from "../utils/types.js";

const CAPTION_SYSTEM_PROMPT = `You write two things for a premium "On This Day" history account that
publishes a daily comic mashup painting - today's real trending topics
combined chaotically into one funny scene, set against a backdrop that
loosely evokes that day's real historical facts:

1. A "title" for the day's painting - short (2-6 words), witty and
   gallery-placard-style. This is a genuinely silly/absurd mashup
   painting, so the title should read like a wry, funny caption for that
   chaos (wordplay, deadpan understatement, or a wink at "everything at
   once" energy) rather than a solemn, atmospheric art-gallery title.
   Never restate a headline, a date, or a person's name verbatim, and
   never invent facts.
2. A "caption": a short, informative, non-clickbait written summary of the
   day's facts for the archival record (this is saved alongside the image,
   not shown as the post's title). Use only the facts given to you - never
   add names, dates, or details that are not in the supplied JSON.

Shape for "caption":
- Opening line: "<Month Day> in history." (use the exact display date given)
- A handful of short highlight lines, each "<year> — <short factual line>",
  drawn from the supplied major events (and incidents if notable).
- If births are supplied, a "Born today:" line followed by 2-4 notable
  names.

Also return "hashtags": a restrained list of 5-10 relevant hashtags drawn
from the supplied facts.

Respond with ONLY a JSON object:
{ "title": "...", "caption": "...", "hashtags": ["#Tag", ...] }
The "caption" field should already include line breaks (\\n) but should NOT
include the hashtags - those go only in the "hashtags" array.`;

/**
 * Stage: caption generation. Runs after QA passes, using only the final
 * selected/verified content - never re-derives facts on its own.
 */
export async function generateCaption(
  config: AppConfig,
  logger: RunLogger,
  selected: SelectedContent
): Promise<CaptionResult> {
  const client = makeOpenAIClient(config);
  if (!client) {
    logger.warn("caption", "OPENAI_API_KEY not set; generating a deterministic fallback caption");
    return fallbackCaption(config, selected);
  }

  try {
    const user = `Write the caption for this date using only these verified facts:\n\n${JSON.stringify(
      {
        displayDate: selected.displayDate,
        majorEvents: selected.majorEvents.map((e) => ({ year: e.year, headline: e.headline })),
        incidents: selected.incidents.map((e) => ({ year: e.year, headline: e.headline })),
        births: selected.births.map((b) => ({ year: b.year, name: b.people[0] ?? b.headline })),
      },
      null,
      2
    )}`;

    const result = await requestJson<{ title: string; caption: string; hashtags: string[] }>(client, {
      model: config.captionModel,
      system: CAPTION_SYSTEM_PROMPT,
      user,
      temperature: 0.7,
      maxOutputTokens: 900,
    });

    const hashtags = (result.hashtags?.length ? result.hashtags : config.brand.hashtags).slice(0, 12);
    const title = result.title?.trim() || fallbackTitle(selected);
    logger.info("caption", "Generated caption via model", { hashtagCount: hashtags.length, title });
    return { title, caption: result.caption.trim(), hashtags };
  } catch (err) {
    logger.warn("caption", "Caption generation failed; using deterministic fallback", {
      error: err instanceof Error ? err.message : String(err),
    });
    return fallbackCaption(config, selected);
  }
}

/** A fully deterministic caption builder used when the model is unavailable. */
function fallbackCaption(config: AppConfig, selected: SelectedContent): CaptionResult {
  const lines: string[] = [`${titleCase(selected.displayDate)} in history.`, ""];

  const highlights = [...selected.majorEvents, ...selected.incidents].slice(0, 6);
  for (const h of highlights) {
    lines.push(`${h.year} — ${h.headline}`);
  }

  if (selected.births.length > 0) {
    lines.push("", "Born today:");
    for (const b of selected.births.slice(0, 4)) {
      lines.push(b.people[0] ?? b.headline);
    }
  }

  return { title: fallbackTitle(selected), caption: lines.join("\n"), hashtags: config.brand.hashtags };
}

/** A fully deterministic title fallback used when the model is unavailable or returns nothing usable. */
function fallbackTitle(selected: SelectedContent): string {
  return `On This Day — ${titleCase(selected.displayDate)}`;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function composeFinalCaptionText(result: CaptionResult): string {
  const hashtagLine = result.hashtags.join(" ");
  return `${result.caption}\n\n${hashtagLine}`.trim();
}

function formatHumanDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(d);
}

/**
 * Builds the image's accessibility/alt text for the daily abstract art
 * post: the generated artwork title, the date, then the same final
 * discovery tags used in Bluesky's separate tags field, written inline
 * as literal "#Tag" text. Posts stay image-only (empty visible text) -
 * this alt text is the only place a viewer sees the piece identified.
 */
export function buildArtAltText(title: string, selected: SelectedContent, finalTags: string[]): string {
  const lines = [title, formatHumanDate(selected.date)];
  if (finalTags.length > 0) lines.push(finalTags.map((t) => `#${t}`).join(" "));
  return lines.join("\n");
}
