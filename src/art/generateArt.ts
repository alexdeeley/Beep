import { writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type OpenAI from "openai";
import type { AppConfig } from "../config/index.js";
import type { RunLogger } from "../utils/logger.js";
import { makeOpenAIClient, MissingApiKeyError } from "../utils/openaiClient.js";
import { BLUESKY_MAX_IMAGE_BYTES } from "../bluesky/publish.js";
import type { TrendingTopic } from "../bluesky/trending.js";
import { curateTrends, type CuratedTrendItem } from "./trendCuration.js";
import type { SelectedContent } from "../utils/types.js";
import type { RenderResult, SizeRenderResult } from "../render/renderInfographic.js";

/**
 * Stage: generates the day's entire published image as a dense editorial
 * cartoon - the day's real trending topics synthesized into one richly
 * composed, humorous scene, set against a backdrop evoking that day's
 * verified historical facts. This REPLACES the deterministic HTML/CSS/
 * Playwright infographic renderer as the daily pipeline's sole image
 * source (see render/renderInfographic.ts, which stays in the codebase
 * but is no longer called by the daily run).
 *
 * Because there is no fallback image once this replaces the renderer, a
 * missing API key or a failed generation call must fail the run - unlike
 * the formerly-optional decorative asset generator, this is not
 * skippable. Per explicit direction, very short intentional text/symbols
 * are allowed here (a deliberate, discussed departure from this
 * pipeline's original "never let an AI model typeset facts" default) -
 * but a real, specific person's actual recognizable likeness (even as
 * caricature) and a real brand's actual logo or a copyrighted
 * character's actual design are still never allowed, generic figures/
 * invented stand-ins only, and long/garbled text is still a defect. All
 * enforced by the art-specific vision QA check.
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

  const curatedTrends = await curateTrends(config, logger, trendingTopics);
  const environment = pickDailyEnvironment(selected.date);
  const prompt = buildArtPrompt(selected, environment, curatedTrends);
  logger.info("art", `Generating editorial cartoon art for ${selected.date}`, { environment, trendItemCount: curatedTrends.length });

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
 * Per explicit direction: the overall visual IDENTITY (painterly editorial
 * cartoon, caricature, ink+paint hybrid) stays consistent day to day for
 * brand recognition - daily variety instead comes from rotating the
 * SETTING the scene takes place in. List drawn directly from the supplied
 * master prompt's "Good settings include" guidance.
 */
const ART_ENVIRONMENTS: string[] = [
  "a crowded, chaotic city street",
  "a surreal public square",
  "a bustling newsroom",
  "a carnival midway",
  "a sprawling open-air marketplace",
  "a busy train station",
  "an airport terminal",
  "an ornate theater",
  "a packed stadium",
  "a dramatic courtroom",
  "a grand museum hall",
  "a chaotic open-plan office",
  "a fantastical dreamlike landscape",
  "a strange civic plaza",
];

/**
 * Deterministically rotates through ART_ENVIRONMENTS by calendar date
 * (days since the Unix epoch, UTC), the same "stateless, reproducible"
 * approach the old text infographic used for its theme rotation.
 * Guarantees two consecutive calendar days never share a setting, and
 * every setting gets used before any repeats.
 */
export function pickDailyEnvironment(isoDate: string): string {
  const days = Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / 86_400_000);
  const idx = ((days % ART_ENVIRONMENTS.length) + ART_ENVIRONMENTS.length) % ART_ENVIRONMENTS.length;
  return ART_ENVIRONMENTS[idx]!;
}

function formatCuratedTrends(items: CuratedTrendItem[]): string {
  if (items.length === 0) return "No notable trending topics today - invent a lighthearted, gently absurd everyday scene instead.";
  return items
    .map((t, i) => {
      const people = t.peopleInvolved.length > 0 ? t.peopleInvolved.join(", ") : "none named";
      const hooks = t.visualHooks.length > 0 ? t.visualHooks.join("; ") : "(none supplied)";
      return `${i + 1}. "${t.topic}" - ${t.significance}
   People involved: ${people}
   Visual hooks: ${hooks}
   Humor angle: ${t.humorPotential || "(none supplied)"}`;
    })
    .join("\n");
}

/**
 * Builds the image-generation prompt from the user-supplied master
 * template (a detailed editorial-cartoon art direction brief). Very
 * short intentional text/symbols are allowed here, an explicitly
 * discussed departure from this pipeline's original hard zero-text rule.
 * Real-person likeness is NOT loosened, though: the master template's own
 * "affectionate caricature of public figures" guidance was tried live and
 * reverted after repeated failures - a real, specific person's actual
 * recognizable likeness is still never allowed here, generic figures
 * only, same as a real brand's actual logo or a real copyrighted
 * character's actual design (a different risk, IP infringement rather
 * than personal likeness, kept regardless of the above).
 */
export function buildArtPrompt(selected: SelectedContent, environment: string, curatedTrends: CuratedTrendItem[] = []): string {
  const allItems = [...selected.majorEvents, ...selected.births, ...selected.deaths, ...selected.incidents];
  const themes = allItems
    .slice(0, 8)
    .map((f) => f.headline)
    .join("; ");
  const categories = Array.from(new Set(allItems.map((f) => f.category))).slice(0, 6).join(", ");

  return `You are creating one highly detailed daily editorial cartoon image based on
the most important, strange, funny, culturally relevant, or widely
discussed trending topics of the day.

The finished image should feel like an ambitious full-page illustrated
editorial cartoon created by an exceptionally skilled newspaper
caricaturist, painter, satirist, and visual storyteller.

CORE GOAL
Create a single richly composed scene that visually summarizes the day.
Do not simply illustrate one headline. Instead, synthesize several of the
day's strongest trending subjects into one coherent, humorous, densely
layered image - a visual snapshot of today's collective internet
consciousness. The viewer should be able to explore the image and
continually discover additional jokes, references, visual metaphors,
background details, and tiny narrative moments.

VISUAL STYLE
Use a highly expressive painterly cartoon style - hand-created, not
digitally sterile. Favor expressive brushwork, visible painted texture,
ink-like outlines mixed with painterly edges, bold color, rich shadows
and highlights, exaggerated facial expressions, caricature, theatrical
poses, energetic gesture, intricate environmental detail, humorous visual
exaggeration, slightly surreal visual metaphors. Avoid flat corporate
vector graphics, generic AI concept-art aesthetics, clean sterile 3D
rendering, or photographic realism - it must clearly read as an
illustration.

GENERIC PEOPLE AND CHARACTERS - AS A RULE, ALWAYS
Every person and every character anywhere in the scene - whether or not
the trending topic below names a specific individual, brand, or
franchise - must be generic and invented, never a real one. This is a
blanket rule for the whole image, not a case-by-case judgment call:
- People: never depict any specific real, identifiable person's actual
  likeness, face, or recognizable caricature, named or not. Use a
  generic, anonymous figure instead (an unmistakably-not-a-portrait
  besuited figure, a generic athlete silhouette, a generic uniform/role
  costume) that gestures at their role in the story (a podium, a flag, a
  famous accessory, a signature prop) without being identifiable as that
  individual.
- Characters: never depict any specific real copyrighted character's
  actual design, or any real brand's actual logo/trademark/mascot,
  named or not. Invent a generic, original visual stand-in instead.
Every figure - crowd, bystander, protagonist, background extra - stays
fully expressive, characterful, and full of personality within that
limit; "generic" means not a real identifiable person or character, not
bland or lifeless.

COMPOSITION
A single unified scene, not a grid of unrelated panels, though it may
contain many simultaneous events. Use foreground/middle-ground/background
storytelling; important subjects larger, secondary stories around the
margins; let scenes overlap; characters may react to things happening
elsewhere in the image. Aim for roughly 2-4 dominant visual ideas, 5-10
secondary references, and numerous tiny background details/Easter eggs -
the viewer should notice new things after staring for several seconds.

HUMOR
Use absurdity, visual metaphor, exaggeration, irony, juxtaposition,
parody, gentle satire, surreal background gags, callbacks between
unrelated stories, literal interpretations of phrases, tiny character
reactions, background signs or objects. Whenever possible, combine two
unrelated trending topics into a single visual joke. Prefer clever visual
ideas over text-heavy jokes.

WORLD BUILDING
Do not place characters against empty backgrounds - build a complete
environment. Today's setting: ${environment}. The environment itself
should help tell the story - objects, vehicles, screens, weather,
architecture, signs, statues, and scenery may all reference additional
trending topics.

COLOR
Rich, lively, saturated color (reds, cobalt/sky blues, glowing yellows,
greens, warm oranges, deep purples, expressive skin tones, unusual accent
colors) used to separate subjects and direct attention. Avoid a muddy,
beige/gray/brown/monochromatic overall palette - different areas may have
slightly different color moods while staying one unified painting.

DETAIL
Unusually detailed: small background characters, tiny signs, newspaper
scraps, animals, vehicles, screens, props, posters, architectural
details, visual callbacks, hidden jokes, tiny narrative scenes - while
preserving a clear visual hierarchy so important elements stay
immediately readable even at smaller display sizes.

TEXT INSIDE THE IMAGE
Use very little text; prefer imagery over captions. If text appears, keep
it extremely short (one or two words or a short symbol - e.g. "AI",
"SALE", "404", "VOTE", "$", "?"). Never a long sentence, a headline
block, or a speech balloon full of dialogue, and never depend on
generated text for the central joke - the comedy should land through
imagery even if the text weren't there.

VISUAL METAPHOR
Translate abstract news into physical visual metaphors wherever possible
(e.g. inflation -> an object swelling uncontrollably; a market story ->
a roller coaster or seesaw; an election -> a race or tug-of-war; social
media -> a giant megaphone or swarming birds; a tech story -> a bizarre
malfunctioning machine).

FAILURE MODES TO AVOID
Do not create a collage of floating heads, a grid of unrelated boxes, a
news infographic, sterile vector illustration, generic glossy AI art,
excessive written headlines, a meme template, empty backgrounds,
characters simply standing side by side, or a composition that repeats a
previous day's structure. Something should always be happening.

REMINDER on the generic-characters rule above: a chase/pursuit gag between
an animal predator and its prey (e.g. a coyote and a bird, a cat and a
mouse) is especially easy to get wrong - that specific visual pairing
reliably drifts into a specific studio's actual copyrighted character
designs even when not intended, so avoid that exact pairing/staging
entirely and invent a different visual joke for that idea instead.

No sexually explicit, gory, or otherwise inappropriate content.

Portrait orientation, full-bleed edge-to-edge composition with no border
or frame.

---

TODAY'S CURATED TRENDING MATERIAL - synthesize the strongest several of
these into one coherent scene per everything above (do not force every
item in; pick whichever combination makes the strongest single image):

${formatCuratedTrends(curatedTrends)}

---

Set against a backdrop that loosely evokes the mood/era of these real
historical moments from ${selected.displayDate}, purely as atmosphere
(costuming, setting details, color palette, period texture) - not the
main subject: ${themes || "a quiet day in history"}. Loosely inspired by
themes of: ${categories || "history and memory"}.

Return only the completed image.`;
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
