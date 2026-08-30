import type { AppConfig } from "../config/index.js";
import type { RunLogger } from "../utils/logger.js";
import { makeOpenAIClient, requestJson } from "../utils/openaiClient.js";
import type { TrendingTopic } from "../bluesky/trending.js";
import type { SelectedContent, SelectedFact } from "../utils/types.js";

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

const HISTORICAL_CURATION_SYSTEM_PROMPT = `You are an editorial cartoonist's research assistant. You will be given a set of
verified historical facts (events, births, deaths, strange incidents) that
all happened on the same calendar day across different years. Your job is
to turn that raw list into a curated package of "raw clay" for an
illustrator to sculpt into a single dense editorial cartoon celebrating
that day in history - not to write jokes or describe a final composition
yourself.

For each fact worth including, determine:
- "topic": a short, clear restatement of what actually happened.
- "significance": 1 sentence on why this moment mattered or is worth
  remembering.
- "peopleInvolved": named real people or organizations central to it (can
  be empty if none).
- "visualHooks": 2-4 concrete visual ideas an illustrator could actually
  draw for this (objects, settings, actions, symbols, period-appropriate
  detail). The illustrator can never draw any real person's actual
  likeness or any real brand/character's actual design, so favor hooks
  that evoke the moment vaguely and symbolically (the setting, the object
  involved, the action, the era's texture) over hooks that describe what a
  specific named person looks like or is doing.
- "humorPotential": 1 sentence on the specific angle of humor, irony, or
  visual metaphor this moment offers - it is fine for this to be gentle,
  celebratory, or wondrous rather than satirical when the fact itself
  isn't inherently funny.

Selection: prioritize historical importance, visual potential, humor/
wonder potential, and diversity across the supplied facts (mix eras,
categories, and tones where the material allows). Do not force in a fact
that has no real visual potential - fewer, stronger items beat padding to
a quota. Return between 4 and 12 items depending on how much the supplied
material actually supports.

Respond with ONLY a JSON object: { "items": [ { "topic": "...",
"significance": "...", "peopleInvolved": ["..."], "visualHooks": ["..."],
"humorPotential": "..." } ] }`;

/**
 * Curates the day's own independently-researched historical facts into
 * the same CuratedTrendItem package curateTrends() builds from live
 * Bluesky trends. Used instead of curateTrends() whenever the run's date
 * is not actually today (see ResolvedDate.isToday) - a --date override
 * for a past or future day has no live "trending topics" of its own, and
 * reusing today's real trending topics as the subject of a post nominally
 * about a different day was flagged as misleading conflation after a
 * live test. Real daily production (date always equals today) is
 * unaffected and keeps using curateTrends() as before.
 */
export async function curateHistoricalContent(config: AppConfig, logger: RunLogger, selected: SelectedContent): Promise<CuratedTrendItem[]> {
  const allFacts: SelectedFact[] = [...selected.majorEvents, ...selected.births, ...selected.deaths, ...selected.incidents];
  if (allFacts.length === 0) return [];

  const fallback = (): CuratedTrendItem[] =>
    allFacts.slice(0, 12).map((f) => ({
      topic: f.headline,
      significance: f.description || "",
      peopleInvolved: f.people ?? [],
      visualHooks: [],
      humorPotential: "",
    }));

  const client = makeOpenAIClient(config);
  if (!client) return fallback();

  try {
    const user = `Verified historical facts for ${selected.displayDate}:\n${JSON.stringify(
      allFacts.map((f) => ({ headline: f.headline, description: f.description, year: f.year, kind: f.kind, people: f.people, category: f.category })),
      null,
      2
    )}`;
    const result = await requestJson<{ items: CuratedTrendItem[] }>(client, {
      model: config.captionModel,
      system: HISTORICAL_CURATION_SYSTEM_PROMPT,
      user,
      temperature: 0.8,
      maxOutputTokens: 2500,
    });
    const items = Array.isArray(result.items) && result.items.length > 0 ? result.items : fallback();
    logger.info("art", `Curated ${items.length} historical fact(s) for the art prompt (date is not today; skipping live trending topics)`);
    return items;
  } catch (err) {
    logger.warn("art", "Historical fact curation failed; falling back to raw selected facts", {
      error: err instanceof Error ? err.message : String(err),
    });
    return fallback();
  }
}
