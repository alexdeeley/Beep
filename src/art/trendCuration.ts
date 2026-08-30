import type { AppConfig } from "../config/index.js";
import type { RunLogger } from "../utils/logger.js";
import { makeOpenAIClient, requestJson } from "../utils/openaiClient.js";
import type { TrendingTopic } from "../bluesky/trending.js";

/**
 * One curated trend item, giving the image-generation prompt far richer
 * "raw clay to sculpt with" than a bare topic phrase: why it matters, who
 * is involved, concrete visual ideas, and where the humor lives. Kept
 * deliberately separate from the image prompt itself (per explicit
 * direction) so trend analysis and art direction can each be reasoned
 * about, tuned, and tested independently.
 */
export interface CuratedTrendItem {
  topic: string;
  significance: string;
  peopleInvolved: string[];
  visualHooks: string[];
  humorPotential: string;
}

const TREND_CURATION_SYSTEM_PROMPT = `You are an editorial cartoonist's research assistant. You will be given a raw
list of topics currently trending on a social platform. Your job is to turn
that raw list into a curated package of "raw clay" for an illustrator to
sculpt into a single dense editorial cartoon - not to write jokes or
describe a final composition yourself.

For each topic worth including, determine:
- "topic": a short, clear restatement of what's actually happening.
- "significance": 1 sentence on why this matters or is widely discussed
  right now (cultural importance, public attention, stakes).
- "peopleInvolved": named real people or organizations central to it (can
  be empty if none).
- "visualHooks": 2-4 concrete visual ideas an illustrator could actually
  draw for this topic (objects, settings, actions, symbols). The
  illustrator can never draw any real person's actual likeness or any
  real brand/character's actual design, so favor hooks that evoke the
  situation vaguely and symbolically (the setting, the object involved,
  the action, the mood) over hooks that describe what a specific named
  person or character looks like or is doing - e.g. prefer "a packed
  boxing ring under hot stage lights" over "a caricature of the boxer
  mid-swing."
- "humorPotential": 1 sentence on the specific angle of humor, irony, or
  visual metaphor this topic offers.

Selection: prioritize cultural importance, public attention, visual
potential, humor potential, recognizability, and diversity of subject
matter (mix world news, technology, entertainment, sports, internet
culture, business, science, strange news where the source material
allows). Do not force in a topic that has no real visual or comedic
potential - fewer, stronger items beat padding to a quota. Return between
8 and 20 items depending on how much the supplied material actually
supports.

Respond with ONLY a JSON object: { "items": [ { "topic": "...",
"significance": "...", "peopleInvolved": ["..."], "visualHooks": ["..."],
"humorPotential": "..." } ] }`;

/**
 * Curates the day's raw trending topics into the richer structured
 * package above. Best-effort: on any failure (no API key, call error),
 * falls back to a minimal package built directly from the raw topics
 * (still usable by the art prompt, just without the added analysis) -
 * this must never block the run, matching every other best-effort
 * external call in this pipeline.
 */
export async function curateTrends(config: AppConfig, logger: RunLogger, trendingTopics: TrendingTopic[]): Promise<CuratedTrendItem[]> {
  if (trendingTopics.length === 0) return [];

  const fallback = (): CuratedTrendItem[] =>
    trendingTopics.map((t) => ({
      topic: t.displayName || t.topic,
      significance: t.description || "",
      peopleInvolved: [],
      visualHooks: [],
      humorPotential: "",
    }));

  const client = makeOpenAIClient(config);
  if (!client) return fallback();

  try {
    const user = `Raw trending topics:\n${JSON.stringify(
      trendingTopics.map((t) => ({ topic: t.displayName || t.topic, description: t.description })),
      null,
      2
    )}`;
    const result = await requestJson<{ items: CuratedTrendItem[] }>(client, {
      model: config.captionModel,
      system: TREND_CURATION_SYSTEM_PROMPT,
      user,
      temperature: 0.8,
      maxOutputTokens: 2500,
    });
    const items = Array.isArray(result.items) && result.items.length > 0 ? result.items : fallback();
    logger.info("art", `Curated ${items.length} trend item(s) for the art prompt`);
    return items;
  } catch (err) {
    logger.warn("art", "Trend curation failed; falling back to raw trending topics", {
      error: err instanceof Error ? err.message : String(err),
    });
    return fallback();
  }
}
