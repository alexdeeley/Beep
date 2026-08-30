import { writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type OpenAI from "openai";
import type { AppConfig } from "../config/index.js";
import type { RunLogger } from "../utils/logger.js";
import { makeOpenAIClient, MissingApiKeyError } from "../utils/openaiClient.js";
import { BLUESKY_MAX_IMAGE_BYTES } from "../bluesky/publish.js";
import type { TrendingTopic } from "../bluesky/trending.js";
import type { SelectedContent } from "../utils/types.js";
import type { RenderResult, SizeRenderResult } from "../render/renderInfographic.js";

/**
 * Stage: generates the day's entire published image as a comic mashup
 * painting - all of today's real Bluesky trending topics, humorously
 * combined into one chaotic scene, set against a backdrop evoking that
 * day's verified historical facts. This REPLACES the deterministic
 * HTML/CSS/Playwright infographic renderer as the daily pipeline's sole
 * image source (see render/renderInfographic.ts, which stays in the
 * codebase but is no longer called by the daily run).
 *
 * Because there is no fallback image once this replaces the renderer, a
 * missing API key or a failed generation call must fail the run - unlike
 * the formerly-optional decorative asset generator, this is not
 * skippable. Two hard safety rules carry through even into literal,
 * comic depiction: no legible text (never let an image model typeset
 * facts), and no actual recognizable likeness/logo/copyrighted character
 * of any real person, brand, or franchise mentioned in a trending topic -
 * only generic, original, invented stand-ins that capture the idea. Both
 * are enforced by the art-specific vision QA check.
 */
export async function generateDailyArt(
  config: AppConfig,
  logger: RunLogger,
  runDir: string,
  selected: SelectedContent,
  trendingTopics: TrendingTopic[]
): Promise<RenderResult> {
  const client = makeOpenAIClient(config);
  if (!client) throw new MissingApiKeyError("art");

  const style = pickArtStyle(selected.date);
  const prompt = buildArtPrompt(selected, style, trendingTopics);
  logger.info("art", `Generating comic mashup art for ${selected.date}`, { style, trendingTopicCount: trendingTopics.length });

  const feed = await generateOneImage(client, config, logger, runDir, prompt, {
    fileBaseName: "infographic",
    targetWidth: config.image.feedWidth,
    targetHeight: config.image.feedHeight,
  });

  let story: SizeRenderResult | null = null;
  if (config.image.enableStory) {
    story = await generateOneImage(client, config, logger, runDir, prompt, {
      fileBaseName: "story",
      targetWidth: config.image.storyWidth,
      targetHeight: config.image.storyHeight,
    });
  }

  return { feed, story };
}

/**
 * A curated set of distinct comic/illustrative painting styles, suited to
 * a busy, literal, humorous mashup scene (unlike the old purely abstract
 * fine-art movements this list replaced). Kept deliberately varied in
 * mood, palette, and technique so consecutive days genuinely look
 * different rather than reading as "the same comic painting every day."
 */
const ART_STYLES: string[] = [
  "Absurdist maximalist collage - every element crammed into one chaotic scene, bold outlines, exaggerated proportions",
  "Vintage editorial-cartoon linework - bold ink linework, cross-hatching, satirical exaggeration, muted newsprint palette",
  "Pop-surrealist mashup poster - vivid saturated colors, dreamlike impossible juxtapositions, bold graphic shapes",
  "Whimsical storybook illustration - soft rounded forms, warm inviting palette, playful exaggerated scale",
  "Retro pulp-poster illustration - bold flat color blocks, dramatic exaggerated action poses, mid-century print texture",
  "Chaotic scrapbook collage - torn-paper layered textures, mixed scale, playful clutter",
  "Rube Goldberg-style absurdist diagram painting - whimsical interconnected contraptions linking every element together",
  "Loose gestural caricature illustration - exaggerated proportions, energetic sketchy linework, humor-forward poses",
  "Giant-monster-movie-poster energy - oversized dramatic scale, bold dynamic composition, vivid saturated color",
  "Toy-diorama miniature collage - bright plastic-toy color palette, playful exaggerated scale contrasts",
  "Symbolic political-cartoon illustration - clear visual metaphors and exaggerated symbolic objects, satirical energy",
  "Psychedelic poster mashup - swirling organic shapes, vivid clashing colors, dense overlapping imagery",
  "Comic-strip panel painting - bold flat colors, dynamic diagonal composition, halftone-dot shading texture",
  "Folk-art naive painting - flattened perspective, bright unmixed color, charmingly crowded composition",
];

/**
 * Deterministically rotates through ART_STYLES by calendar date (days
 * since the Unix epoch, UTC), the same "stateless, reproducible" approach
 * the old text infographic used for its theme rotation. Guarantees two
 * consecutive calendar days never share a style, and every style gets
 * used before any repeats.
 */
export function pickArtStyle(isoDate: string): string {
  const days = Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / 86_400_000);
  const idx = ((days % ART_STYLES.length) + ART_STYLES.length) % ART_STYLES.length;
  return ART_STYLES[idx]!;
}

export function buildArtPrompt(selected: SelectedContent, style: string, trendingTopics: TrendingTopic[] = []): string {
  const allItems = [...selected.majorEvents, ...selected.births, ...selected.deaths, ...selected.incidents];
  const themes = allItems
    .slice(0, 8)
    .map((f) => f.headline)
    .join("; ");
  const categories = Array.from(new Set(allItems.map((f) => f.category))).slice(0, 6).join(", ");
  const trendingLines = trendingTopics
    .slice(0, 8)
    .map((t) => t.displayName || t.topic);
  const trendingList = trendingLines.length > 0 ? trendingLines.map((t) => `"${t}"`).join(", ") : null;

  return `A single busy, funny mashup painting for a daily historical almanac.

THE MAIN SUBJECT (this is the whole point of the painting): comically and
chaotically combine ALL of the following real concepts, currently trending
right now, into ONE single scene - as if every one of them is colliding,
interacting, or crashing into the same absurd moment together. Use
inventive visual sight-gags, playful juxtaposition, and physical comedy
between the elements, not a literal news-photo-style depiction of any one
of them:
${trendingList ?? "no notable trending topics today - invent a lighthearted, gently absurd everyday scene instead"}.

Set against a backdrop that loosely evokes the mood/era of these real
historical moments from ${selected.displayDate}, purely as background
atmosphere (costuming, setting, color palette, period texture) - never
as the main subject and never depicted as a literal historical scene:
${themes || "a quiet day in history"}. Loosely inspired by themes of:
${categories || "history and memory"}.

Today's assigned style: ${style}. Render fully in that style.
Portrait orientation, full-bleed edge-to-edge composition with no border
or frame.

CRITICAL SAFETY RULES, even in this literal/comic context - read carefully,
these are the most common reasons a painting gets rejected:
- For ANY trending topic centered on a specific named real person (a
  public figure, celebrity, politician), a specific named brand/product,
  or a specific copyrighted character/franchise - DO NOT depict ANY
  humanoid figure, character, or creature standing in for them AT ALL,
  not even a "generic" one. A generic figure meant to evoke a specific
  real person or character keeps drifting into looking like the real
  one, which is exactly what must never happen. Instead represent that
  concept ONLY through symbolic objects, props, and setting - never a
  figure/character:
  - A specific real named film/show/franchise (e.g. a movie release) ->
    an empty cinema seat, a film reel, popcorn, a ticket stub, a red
    carpet, a blank poster frame. Never any character from it, generic
    or otherwise - especially never any kind of animal-chase or
    predator-and-prey pairing, which reliably drifts into a specific
    studio's actual copyrighted characters.
  - A specific real sports story -> a ball, a goalpost, a trophy, empty
    stadium seating, a whistle. Never a player or any figure wearing a
    jersey/uniform - jersey numbers are the single most common source of
    hallucinated legible text in this pipeline.
  - A specific real politician or political story -> a podium, a flag,
    a gavel, a government-building silhouette, a ballot box. Never any
    human figure standing in for the person, generic or otherwise.
  - A specific real brand/company/app -> a plain, unbranded generic
    equivalent object (e.g. a compass-rose or globe instead of a mapping
    app's logo) - never any logo, trademark, or mascot.
- For any OTHER, non-entity-specific human presence in the scene (an
  anonymous crowd, an unnamed figure reacting to the chaos) - generic,
  unmistakably-not-a-portrait figures are fine.
- Certain OBJECT TYPES almost always want to grow legible text/numbers by
  default and must be handled with extra care:
  - Maps, atlases, globes, or signposts (common for any renaming/
    geography-related trending topic): show ONLY a plain, blank,
    unlabeled shape - a bare landmass silhouette, an unmarked signpost,
    a spinning compass. NEVER include place names, labels, or any text
    on a map-like object.
  - Papers, documents, clipboards, scoreboards, tickets, or lists
    (common for any sports/roster/score-related trending topic): keep
    them completely blank, or replace them entirely with a non-textual
    object (a ball, a trophy, a whistle, a stopwatch) - NEVER show any
    figure holding or reading a paper/document/list with numbers or
    marks on it.
- ABSOLUTELY NO TEXT, NO LETTERS, NO NUMBERS, NO WORDS, NO WRITING, NO
  CAPTIONS, NO SPEECH BUBBLES, NO SIGNATURE, NO NUMBERS OR MARKS ON
  CLOTHING, SIGNAGE, PAPER, OR MAPS anywhere in the image - the comedy
  must land through imagery alone, nothing legible, ever.
- No sexually explicit, gory, or otherwise inappropriate content.`;
}

/**
 * gpt-image-1 only supports a fixed set of output sizes (1024x1024,
 * 1024x1536, 1536x1024, or "auto"); none of those match our exact export
 * canvases (e.g. 1080x1350). We generate at the closest supported
 * portrait size and then center-crop/resize to the exact required pixel
 * dimensions, the same "never distort, always exact" guarantee the old
 * HTML renderer made for text.
 */
async function generateOneImage(
  client: OpenAI,
  config: AppConfig,
  logger: RunLogger,
  runDir: string,
  prompt: string,
  opts: { fileBaseName: string; targetWidth: number; targetHeight: number }
): Promise<SizeRenderResult> {
  const { fileBaseName, targetWidth, targetHeight } = opts;
  const { maxGenerationAttempts } = config.art;

  let lastError: string | undefined;
  for (let attempt = 1; attempt <= maxGenerationAttempts; attempt++) {
    try {
      logger.info("art", `Generation attempt ${attempt}/${maxGenerationAttempts} for "${fileBaseName}"`);
      const result = await client.images.generate({
        model: config.imageGenModel,
        prompt,
        size: "1024x1536",
        n: 1,
      });
      const b64 = result.data?.[0]?.b64_json;
      if (!b64) throw new Error("Image generation returned no data");

      const raw = Buffer.from(b64, "base64");
      const encoded = await encodeUnderSizeCap(raw, targetWidth, targetHeight, config.image.format, config.image.jpegQuality);
      const ext = encoded.format === "jpeg" ? "jpg" : "png";
      const imagePath = join(runDir, `${fileBaseName}.${ext}`);
      writeFileSync(imagePath, encoded.buffer);

      logger.info(
        "art",
        `Generated ${fileBaseName}.${ext} at ${targetWidth}x${targetHeight} (${encoded.buffer.length} bytes${
          encoded.format !== config.image.format ? `, fell back to ${encoded.format} to fit Bluesky's blob cap` : ""
        })`
      );
      return {
        imagePath,
        width: targetWidth,
        height: targetHeight,
        scale: 1,
        naturalContentHeight: targetHeight,
        overflowClamped: false,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      logger.warn("art", `Generation attempt ${attempt} failed: ${lastError}`);
      if (attempt < maxGenerationAttempts) {
        const backoffMs = 2000 * 2 ** (attempt - 1);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
  }

  throw new Error(`Art generation failed for "${fileBaseName}" after ${maxGenerationAttempts} attempt(s): ${lastError}`);
}

/**
 * Bluesky hard-caps an uploaded image blob at BLUESKY_MAX_IMAGE_BYTES.
 * A detailed, busy painting is photographic/textured (unlike the old
 * flat-color text infographic), so a full-bleed PNG routinely lands well
 * over that cap. Try the configured format first; if it doesn't fit,
 * fall back to JPEG (which compresses this kind of content far better
 * than PNG ever will) and step the quality down until it actually fits.
 */
async function encodeUnderSizeCap(
  raw: Buffer,
  targetWidth: number,
  targetHeight: number,
  preferredFormat: "png" | "jpeg",
  preferredQuality: number
): Promise<{ buffer: Buffer; format: "png" | "jpeg" }> {
  const resized = () => sharp(raw).resize(targetWidth, targetHeight, { fit: "cover", position: "attention" });

  if (preferredFormat === "png") {
    const pngBuffer = await resized().png().toBuffer();
    if (pngBuffer.length <= BLUESKY_MAX_IMAGE_BYTES) return { buffer: pngBuffer, format: "png" };
  }

  for (let quality = Math.min(preferredQuality, 90); quality >= 35; quality -= 15) {
    const jpegBuffer = await resized().jpeg({ quality }).toBuffer();
    if (jpegBuffer.length <= BLUESKY_MAX_IMAGE_BYTES) return { buffer: jpegBuffer, format: "jpeg" };
  }

  throw new Error(`Could not encode image under Bluesky's ${BLUESKY_MAX_IMAGE_BYTES}-byte blob cap even at minimum JPEG quality`);
}
