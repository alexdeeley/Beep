import type { AppConfig } from "../config/index.js";
import type { RunLogger } from "../utils/logger.js";
import { makeOpenAIClient, requestJson } from "../utils/openaiClient.js";
import type { CaptionResult, SelectedContent } from "../utils/types.js";

const CAPTION_SYSTEM_PROMPT = `You write short social captions for a premium, editorial "On This Day"
history account. Tone: informative and interesting, never clickbait, never
corny, never political advocacy, not overly academic. Use only the facts
given to you - never add names, dates, or details that are not in the
supplied JSON.

Shape to follow:
- Opening line: "<Month Day> in history." (use the exact display date given)
- A handful of short highlight lines, each "<year> — <short factual line>",
  drawn from the supplied major events (and incidents if notable).
- If births are supplied, a "Born today:" line followed by 2-4 notable
  names.
- Optionally one short, genuine engagement question (not forced).
- A restrained block of hashtags (do not spam; 5-10 relevant tags).

Respond with ONLY a JSON object: { "caption": "...", "hashtags": ["#Tag", ...] }
The "caption" field should already include line breaks (\\n) but should NOT
include the hashtags - those go only in the "hashtags" array, the caller
will append them.`;

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

    const result = await requestJson<{ caption: string; hashtags: string[] }>(client, {
      model: config.captionModel,
      system: CAPTION_SYSTEM_PROMPT,
      user,
      temperature: 0.7,
      maxOutputTokens: 900,
    });

    const hashtags = (result.hashtags?.length ? result.hashtags : config.brand.hashtags).slice(0, 12);
    logger.info("caption", "Generated caption via model", { hashtagCount: hashtags.length });
    return { caption: result.caption.trim(), hashtags };
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

  return { caption: lines.join("\n"), hashtags: config.brand.hashtags };
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
