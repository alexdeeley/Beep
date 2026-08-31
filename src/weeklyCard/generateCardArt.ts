import type { AppConfig } from "../config/index.js";
import type { RunLogger } from "../utils/logger.js";
import { makeOpenAIClient, MissingApiKeyError } from "../utils/openaiClient.js";
import { generateOneImage } from "../art/imageGeneration.js";
import type { PlayingCard } from "./pickCard.js";
import type { SizeRenderResult } from "../render/renderInfographic.js";

/**
 * Independent art generator for the weekly "card draw" pipeline. Shares
 * only the low-level gpt-image-1 call + size-cap encoder
 * (art/imageGeneration.ts) with the daily editorial-cartoon pipeline -
 * everything else (visual identity, prompt, rotation) is its own, so a
 * change here can never affect the daily app's output.
 */
export async function generateCardArt(
  config: AppConfig,
  logger: RunLogger,
  runDir: string,
  isoDate: string,
  card: PlayingCard,
  isDecade: boolean
): Promise<SizeRenderResult> {
  const client = makeOpenAIClient(config);
  if (!client) throw new MissingApiKeyError("weekly-card");

  const mood = pickWeeklyMood(isoDate);
  const prompt = isDecade ? buildDecadePrompt(mood) : buildCardPrompt(card, mood);
  logger.info("weekly-card", `Generating ${isDecade ? "decade special" : "card draw"} art`, { card: card.label, mood, isDecade });

  return generateOneImage(client, config, logger, runDir, prompt, {
    fileBaseName: "card",
    targetWidth: config.image.feedWidth,
    targetHeight: config.image.feedHeight,
    maxGenerationAttempts: config.weeklyCard.maxGenerationAttempts,
    logStage: "weekly-card",
  });
}

/**
 * Small rotation of lighting/setting moods for visual variety week to
 * week, deterministic by ISO date (same reproducible-for-testing pattern
 * as the daily pipeline's environment rotation), deliberately on a
 * different modulus than the 52-card deck cycle (see pickCard.ts) so
 * mood and card drift in and out of phase with each other rather than
 * always pairing the same way.
 */
const MOODS = [
  "lit by a single flickering candle, warm pool of light, deep shadow beyond it",
  "cold moonlight falling through a nearby window, silvery and stark",
  "the warm circle of an old brass desk lamp, everything outside it fading to black",
  "grey, rain-streaked window light, muted and overcast",
  "a single bare bulb overhead, harsh and slightly unflattering",
  "dawn light just beginning to touch the edge of the table",
  "firelight from an unseen fireplace, flickering orange across the page",
];

export function pickWeeklyMood(isoDate: string): string {
  const weeks = Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / (7 * 86_400_000));
  const idx = ((weeks % MOODS.length) + MOODS.length) % MOODS.length;
  return MOODS[idx]!;
}

function sharedStyleAndSafety(): string {
  return `VISUAL STYLE
A moody, painterly still-life illustration - realistic but clearly a
painting, not a photograph. Rich texture: worn paper, soft graphite and
ink linework, visible brushwork. A single weathered, slightly worn table
or desk surface fills the frame.

GENERIC ONLY - NO REAL BRANDS OR TRADEMARKS
The card's back design, the notebook, the pen, and every object in the
scene must be original and generic - never a real, identifiable brand's
actual logo, trademark, or card-back design (e.g. never the real Bicycle
playing-card back design or any other real manufacturer's actual
artwork). Invent your own generic design instead. If any human figure,
hand, or face appears anywhere in the frame, it must be generic and
anonymous, never a specific real, identifiable person.

No sexually explicit, gory, or otherwise inappropriate content.

Portrait orientation, full-bleed edge-to-edge composition, no border or frame.`;
}

/**
 * The normal weekly post: one card face-up on top of an open notebook
 * covered in cryptic handwritten scribbling. The scribbling is
 * deliberately illegible/abstract - gestural marks, private symbols,
 * diagrams, doodles - not meant to be read as real words. That is
 * intentional atmosphere, not a defect (see qa/prompts.ts's card mode).
 */
export function buildCardPrompt(card: PlayingCard, mood: string): string {
  return `Create a single detailed still-life illustration for a weekly "card draw"
art post.

CORE IMAGE
A single ${card.label} playing card, face up, resting on top of an open
notebook. The notebook's visible pages are densely covered in cryptic
handwritten scribbling - private symbols, small diagrams, circled words,
crossed-out lines, doodles in the margins, sketched shapes - like
someone's obsessive private notes. This scribbling should read as
atmospheric texture, not as legible real sentences; a few short isolated
words or fragments are fine, but do not compose full readable paragraphs.

LIGHTING AND MOOD
${mood}

${sharedStyleAndSafety()}

Return only the completed image.`;
}

/**
 * The once-a-decade special edition. Keeps the same visual identity (the
 * card, the notebook, the mood) but the notebook's open page now shows,
 * in place of the usual scribbles, exactly the phrase "LIFE IS BEAUTIFUL.
 * GOODBYE." written large and clearly legible - the one time this
 * pipeline's normal "keep text illegible/atmospheric" rule is inverted,
 * per explicit direction. Vision QA (see qa/prompts.ts's decade mode)
 * hard-fails if that exact phrase is not clearly legible and correctly
 * spelled, since unlike the daily pipeline's short-symbol allowance, this
 * one phrase is the entire point of the special post.
 */
export function buildDecadePrompt(mood: string): string {
  return `Create a single detailed still-life illustration for a rare, once-a-decade
special edition of a weekly "card draw" art post.

CORE IMAGE
Exactly ONE playing card, face up, positioned in a corner or edge of the
frame, resting near (not on top of) an open notebook. The notebook's
visible open page shows one short handwritten/painted message, large,
bold, and perfectly legible, taking up most of the page - exactly this
text, spelled exactly this way, nothing added or removed:

"LIFE IS BEAUTIFUL. GOODBYE."

This is the single most important requirement of this image: every
letter of that exact phrase must be fully visible, clearly readable,
correctly spelled, real legible lettering - not scribbled, not abstract,
not stylized into illegibility, and critically NOT covered, overlapped,
cropped, or obscured by the card, a pen, a hand, a shadow, or any other
object. Leave the entire phrase in open, unobstructed space on the page.
The single card must not overlap the text at all, and there must be only
one card in the frame - never two cards, never a second card peeking out
from underneath.

Every other element of the scene (the card, the desk, the lighting)
should otherwise match the series' usual quiet, contemplative, painterly
still-life mood - not alarming or graphic, simply calm and atmospheric.

LIGHTING AND MOOD
${mood}

${sharedStyleAndSafety()}

Return only the completed image.`;
}
