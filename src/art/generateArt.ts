import { writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type OpenAI from "openai";
import type { AppConfig } from "../config/index.js";
import type { RunLogger } from "../utils/logger.js";
import { makeOpenAIClient, MissingApiKeyError } from "../utils/openaiClient.js";
import { BLUESKY_MAX_IMAGE_BYTES } from "../bluesky/publish.js";
import type { SelectedContent } from "../utils/types.js";
import type { RenderResult, SizeRenderResult } from "../render/renderInfographic.js";

/**
 * Stage: generates the day's entire published image as wordless abstract
 * art evoking that day's verified historical facts. This REPLACES the
 * deterministic HTML/CSS/Playwright infographic renderer as the daily
 * pipeline's sole image source (see render/renderInfographic.ts, which
 * stays in the codebase but is no longer called by the daily run).
 *
 * Because there is no fallback image once this replaces the renderer, a
 * missing API key or a failed generation call must fail the run - unlike
 * the formerly-optional decorative asset generator, this is not
 * skippable. "No text" is the one hard safety requirement carried over
 * from the old design (never let an image model typeset facts): since
 * this image contains no factual claims at all, only mood/texture, that
 * requirement becomes "the image must contain no legible text
 * whatsoever", enforced by the art-specific vision QA check.
 */
export async function generateDailyArt(
  config: AppConfig,
  logger: RunLogger,
  runDir: string,
  selected: SelectedContent
): Promise<RenderResult> {
  const client = makeOpenAIClient(config);
  if (!client) throw new MissingApiKeyError("art");

  const style = pickArtStyle(selected.date);
  const prompt = buildArtPrompt(selected, style);
  logger.info("art", `Generating abstract art for ${selected.date}`, { style });

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
 * A curated set of distinct fine-art movements/techniques, each described
 * in fully abstract (never figurative) terms so it stays compatible with
 * the hard "no recognizable faces" rule below. Kept deliberately varied
 * in mood, palette, and technique so consecutive days genuinely look
 * different rather than reading as "the same abstract painting with
 * different colors."
 */
const ART_STYLES: string[] = [
  "Bauhaus geometric abstraction - flat planes of primary color, strong geometric structure, disciplined composition",
  "Japanese sumi-e ink wash - minimal brushwork, generous negative space, monochrome or near-monochrome ink tones",
  "Color Field painting - large luminous fields of color, soft edges, meditative scale, few forms",
  "Cubist fragmentation - faceted overlapping planes, fractured perspective, muted earth-toned palette",
  "Art Deco geometric elegance - symmetrical ornamental geometry, metallic gold and deep jewel tones",
  "Abstract Expressionist gesture - energetic brushstrokes, dynamic sweeping movement, bold high-contrast color",
  "Constructivist collage - angular industrial forms, structured diagonals, bold red/black/white palette",
  "Watercolor wash - soft bleeding pigment, translucent layered color, organic irregular edges",
  "Bold Pop Art graphic - flat saturated color blocks, high contrast, graphic silhouette shapes",
  "Minimalist geometric abstraction - a few precise shapes, generous negative space, restrained palette",
  "Textured mixed-media collage - layered paper and paint textures, tactile surface, muted tones",
  "Op Art optical pattern - rhythmic repeating geometric pattern, high contrast, sense of visual movement",
  "Biomorphic abstraction - organic flowing forms, curved lines, warm earthy or oceanic color",
  "Impressionist abstraction - dappled broken color, soft atmospheric light, loose visible brushwork",
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

export function buildArtPrompt(selected: SelectedContent, style: string): string {
  const allItems = [...selected.majorEvents, ...selected.births, ...selected.deaths, ...selected.incidents];
  const themes = allItems
    .slice(0, 8)
    .map((f) => f.headline)
    .join("; ");
  const categories = Array.from(new Set(allItems.map((f) => f.category))).slice(0, 6).join(", ");

  return `A single striking piece of fine-art abstract-adjacent art for a daily
historical almanac. Evoke the mood, era, and energy of these real
historical moments from ${selected.displayDate} without depicting any of
them literally as a scene: ${themes || "a quiet day in history"}.
Loosely inspired by themes of: ${categories || "history and memory"}.
Today's assigned style: ${style}.
Render fully in that style - gallery-quality, evocative rather than a
literal illustration. Portrait orientation, full-bleed edge-to-edge
composition with no border or frame.
Human figures are welcome as part of the composition - silhouettes,
gestural forms, stylized or generic figures - but they must always be
GENERIC and ANONYMOUS. Never attempt to depict the actual likeness,
face, or recognizable portrait of any specific real person (named or
otherwise identifiable), living or historical - any figures shown must
not be recognizable as a particular individual.
ABSOLUTELY NO TEXT, NO LETTERS, NO NUMBERS, NO WORDS, NO WRITING, NO
CAPTIONS, NO SIGNATURE, NO LOGOS anywhere in the image - pure visual art
only, nothing legible.`;
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
 * Abstract art is photographic/textured (unlike the old flat-color text
 * infographic), so a full-bleed PNG routinely lands well over that cap.
 * Try the configured format first; if it doesn't fit, fall back to JPEG
 * (which compresses photographic content far better than PNG ever will)
 * and step the quality down until the output actually fits.
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
