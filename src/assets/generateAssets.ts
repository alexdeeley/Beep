import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../config/index.js";
import type { RunLogger } from "../utils/logger.js";
import { makeOpenAIClient } from "../utils/openaiClient.js";
import type { DecorativeAsset, SelectedContent } from "../utils/types.js";

/**
 * Stage: optional decorative illustration generation. This is the ONLY
 * place image generation touches the pipeline, and by design it never
 * receives factual text to typeset - only a short art-direction prompt
 * describing a wordless motif. All dates/names/headlines are rendered
 * later, deterministically, by the HTML/CSS/Playwright renderer.
 */
export async function generateSupportingAssets(
  config: AppConfig,
  logger: RunLogger,
  runDir: string,
  selected: SelectedContent
): Promise<DecorativeAsset[]> {
  if (!config.assets.enableImageGeneration) {
    logger.info("assets", "Image generation disabled (ENABLE_IMAGE_GENERATION=false); skipping decorative art");
    return [];
  }

  const client = makeOpenAIClient(config);
  if (!client) {
    logger.warn("assets", "OPENAI_API_KEY not set; skipping decorative art generation");
    return [];
  }

  const motifs = pickMotifs(selected);
  const assets: DecorativeAsset[] = [];

  for (const motif of motifs) {
    try {
      const result = await client.images.generate({
        model: config.imageGenModel,
        prompt: buildMotifPrompt(motif.description, selected.theme),
        size: "1024x1024",
        n: 1,
      });
      const b64 = result.data?.[0]?.b64_json;
      if (!b64) {
        logger.warn("assets", `No image data returned for motif "${motif.id}"`);
        continue;
      }
      const filePath = join(runDir, "assets", `${motif.id}.png`);
      writeFileSync(filePath, Buffer.from(b64, "base64"));
      assets.push({ id: motif.id, description: motif.description, filePath, usedFor: motif.usedFor });
      logger.info("assets", `Generated decorative asset "${motif.id}"`);
    } catch (err) {
      logger.warn("assets", `Failed to generate motif "${motif.id}"; continuing without it`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return assets;
}

function buildMotifPrompt(description: string, theme: string): string {
  return `A single elegant, wordless decorative illustration for a premium historical
almanac / museum exhibition infographic. Subject: ${description}. Style:
fine engraved linework, sepia-and-gold on near-black, restrained and
editorial, archival etching aesthetic matching a "${theme}" luxury palette.
ABSOLUTELY NO TEXT, NO LETTERS, NO NUMBERS, NO WORDS anywhere in the image -
purely decorative linework/illustration. Centered composition, transparent
or plain dark background, high detail, no watermark.`;
}

interface Motif {
  id: string;
  description: string;
  usedFor: DecorativeAsset["usedFor"];
}

/** Choose a small handful of motifs relevant to the day's actual content. */
function pickMotifs(selected: SelectedContent): Motif[] {
  const motifs: Motif[] = [{ id: "header-ornament", description: "an antique hourglass beside a laurel sprig", usedFor: "header" }];

  const categories = new Set(selected.majorEvents.map((e) => e.category));
  if (categories.has("space_exploration")) {
    motifs.push({ id: "motif-space", description: "a vintage space capsule and star field", usedFor: "major_events" });
  }
  if (categories.has("war_conflict")) {
    motifs.push({ id: "motif-conflict", description: "a pair of crossed antique flags", usedFor: "major_events" });
  }
  if (categories.has("music") || categories.has("film_television")) {
    motifs.push({ id: "motif-culture", description: "a vintage film reel and gramophone horn", usedFor: "major_events" });
  }
  if (selected.incidents.length > 0) {
    motifs.push({ id: "motif-incident", description: "an antique magnifying glass over a folded newspaper", usedFor: "incidents" });
  }

  return motifs.slice(0, 4);
}
