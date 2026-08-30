import { writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type OpenAI from "openai";
import type { AppConfig } from "../config/index.js";
import type { RunLogger } from "../utils/logger.js";
import { BLUESKY_MAX_IMAGE_BYTES } from "../bluesky/publish.js";
import type { SizeRenderResult } from "../render/renderInfographic.js";

/**
 * Shared gpt-image-1 generation + size-cap encoding used by every image
 * pipeline in this project (the daily editorial cartoon and the weekly
 * card draw). Extracted from art/generateArt.ts so a second, fully
 * independent pipeline can reuse the exact same generation/retry/encode
 * behavior without duplicating it or coupling the two pipelines together.
 *
 * gpt-image-1 only supports a fixed set of output sizes (1024x1024,
 * 1024x1536, 1536x1024, or "auto"); none of those match our exact export
 * canvases (e.g. 1080x1350). We generate at the closest supported
 * portrait size and then center-crop/resize to the exact required pixel
 * dimensions, the same "never distort, always exact" guarantee the old
 * HTML renderer made for text.
 */
export async function generateOneImage(
  client: OpenAI,
  config: AppConfig,
  logger: RunLogger,
  runDir: string,
  prompt: string,
  opts: { fileBaseName: string; targetWidth: number; targetHeight: number; maxGenerationAttempts: number; logStage: string }
): Promise<SizeRenderResult> {
  const { fileBaseName, targetWidth, targetHeight, maxGenerationAttempts, logStage } = opts;

  let lastError: string | undefined;
  for (let attempt = 1; attempt <= maxGenerationAttempts; attempt++) {
    try {
      logger.info(logStage, `Generation attempt ${attempt}/${maxGenerationAttempts} for "${fileBaseName}"`);
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
        logStage,
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
      logger.warn(logStage, `Generation attempt ${attempt} failed: ${lastError}`);
      if (attempt < maxGenerationAttempts) {
        const backoffMs = 2000 * 2 ** (attempt - 1);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
  }

  throw new Error(`Image generation failed for "${fileBaseName}" after ${maxGenerationAttempts} attempt(s): ${lastError}`);
}

/**
 * Bluesky hard-caps an uploaded image blob at BLUESKY_MAX_IMAGE_BYTES.
 * A detailed, busy painting is photographic/textured (unlike the old
 * flat-color text infographic), so a full-bleed PNG routinely lands well
 * over that cap. Try the configured format first; if it doesn't fit,
 * fall back to JPEG (which compresses this kind of content far better
 * than PNG ever will) and step the quality down until it actually fits.
 */
export async function encodeUnderSizeCap(
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
