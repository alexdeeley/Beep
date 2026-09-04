import { z } from "zod";
import { requestJson } from "../../utils/openaiClient.js";
import type { NewsRunContext } from "../runContext.js";
import type { DraftEdition } from "../types.js";
import { buildWritingSystemPrompt, buildWritingUserPrompt, WRITING_JSON_SCHEMA, type WritingItem } from "./prompts.js";

const writingResultSchema = z.object({
  shouldPost: z.boolean(),
  posts: z.array(z.object({ text: z.string(), sourceItemIndexes: z.array(z.number().int()) })),
});

/**
 * Composes this hour's edition from the release candidates that survived
 * ranking and quiet-hours filtering. May legitimately return null -
 * silence is a valid, preferred outcome when nothing clears the bar for
 * genuinely worthwhile copy, not just when there's no material at all.
 */
export async function writeEdition(ctx: NewsRunContext, items: WritingItem[]): Promise<DraftEdition> {
  if (items.length === 0) return null;

  const system = buildWritingSystemPrompt(ctx.editorialFocus, ctx.config.news.maxPostsPerEdition);
  const user = buildWritingUserPrompt(items);

  const attempt = async (extra?: string) => {
    const raw = await requestJson<unknown>(ctx.openai, {
      model: ctx.config.news.writerModel,
      system,
      user: extra ? `${user}\n\n${extra}` : user,
      temperature: 0.5,
      maxOutputTokens: 2048,
    });
    return writingResultSchema.parse(raw);
  };

  let result: z.infer<typeof writingResultSchema>;
  try {
    result = await attempt();
  } catch (err) {
    ctx.logger.warn("writing", "First writing attempt failed shape validation, retrying once", {
      error: err instanceof Error ? err.message : String(err),
    });
    try {
      result = await attempt(
        'IMPORTANT: Your previous response did not match the required shape. Respond with ONLY {"shouldPost":true|false,"posts":[{"text":"...","sourceItemIndexes":[0]}]}.'
      );
    } catch (err2) {
      ctx.logger.error("writing", "Writing stage failed twice; treating as a silent hour", {
        error: err2 instanceof Error ? err2.message : String(err2),
      });
      return null;
    }
  }

  if (!result.shouldPost || result.posts.length === 0) {
    ctx.logger.info("writing", "Writer determined nothing this hour is worth posting - staying silent");
    return null;
  }

  const posts = result.posts.slice(0, ctx.config.news.maxPostsPerEdition).map((p) => {
    const itemIds = p.sourceItemIndexes.filter((i) => i >= 0 && i < items.length).map((i) => items[i]!.musicItemId);
    return { text: p.text, sourceItemIds: itemIds };
  });

  ctx.logger.info("writing", `Drafted ${posts.length} post(s) for this edition`);
  return { posts };
}
