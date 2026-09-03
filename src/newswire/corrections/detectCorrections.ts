import { z } from "zod";
import { requestJson } from "../../utils/openaiClient.js";
import type { NewsRunContext } from "../runContext.js";
import type { StoryEventRow } from "../db/storiesRepo.js";
import type { VerifiedFact } from "../types.js";

const correctionDetectionSchema = z.object({
  corrections: z.array(
    z.object({
      newFactIndex: z.number().int(),
      correctsEventId: z.number().int(),
      explanation: z.string(),
    })
  ),
});

export type CorrectionDetection = z.infer<typeof correctionDetectionSchema>["corrections"][number];

const SYSTEM_PROMPT = [
  "You compare freshly-verified news facts against a story's existing recorded events, looking specifically for CORRECTIONS -",
  "cases where a new fact reverses, retracts, or materially changes the substance of a previously recorded fact (e.g. a death toll",
  "revised down, a suspect's identity changed, an initial report walked back). Do NOT flag a new fact just because it adds detail,",
  "provides an update, or continues the story - only flag it when it actually contradicts or corrects something already on record.",
  'Respond with ONLY {"corrections":[{"newFactIndex":0,"correctsEventId":123,"explanation":"..."}]} - use an empty array if there are none.',
].join(" ");

/**
 * Checks a batch of new, already-verified facts against a story's
 * existing recorded events for corrections. Runs inline as part of the
 * normal hourly story-memory step (see updateStoryMemory.ts) rather than
 * as a separate standing process - corrections are just a special case
 * of "new information about an open story."
 */
export async function detectCorrections(
  ctx: NewsRunContext,
  existingEvents: StoryEventRow[],
  newFacts: VerifiedFact[]
): Promise<CorrectionDetection[]> {
  if (existingEvents.length === 0 || newFacts.length === 0) return [];

  const existingListing = existingEvents.map((e) => `id=${e.id}: ${e.summary}`).join("\n");
  const newListing = newFacts.map((f, i) => `${i}: ${f.claim}`).join("\n");
  const user = `Existing recorded events:\n${existingListing}\n\nNew facts to check:\n${newListing}`;

  const attempt = async (extra?: string) => {
    const raw = await requestJson<unknown>(ctx.openai, {
      model: ctx.config.news.verificationModel,
      system: SYSTEM_PROMPT,
      user: extra ? `${user}\n\n${extra}` : user,
      temperature: 0.1,
      maxOutputTokens: 1024,
    });
    return correctionDetectionSchema.parse(raw);
  };

  let result: z.infer<typeof correctionDetectionSchema>;
  try {
    result = await attempt();
  } catch {
    try {
      result = await attempt('IMPORTANT: Your previous response did not match the required shape. Respond with ONLY {"corrections":[...]}.');
    } catch (err) {
      ctx.logger.warn("corrections", "Correction-detection call failed twice; assuming no corrections this run", {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  const validEventIds = new Set(existingEvents.map((e) => e.id));
  const valid = result.corrections.filter(
    (c) => c.newFactIndex >= 0 && c.newFactIndex < newFacts.length && validEventIds.has(c.correctsEventId)
  );
  if (valid.length > 0) {
    ctx.logger.info("corrections", `Detected ${valid.length} correction(s)`, { corrections: valid });
  }
  return valid;
}
