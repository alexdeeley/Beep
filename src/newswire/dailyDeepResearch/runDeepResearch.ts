import { requestTextWithWebSearch } from "../../utils/openaiClient.js";
import { finishDeepResearchRun, startDeepResearchRun } from "../db/researchRunsRepo.js";
import type { NewsRunContext } from "../runContext.js";
import { buildDeepResearchSystemPrompt, buildDeepResearchUserPrompt } from "./prompts.js";

/**
 * Runs the once-daily broad-context research pass and persists the
 * resulting prose blob to deep_research_runs. This is a single bounded
 * web-search call producing unverified background context for later
 * stages to optionally draw on - not a standing research agent, and not
 * itself a source of publishable claims (those still need the normal
 * verification stage).
 */
export async function runDeepResearch(ctx: NewsRunContext): Promise<string | null> {
  const run = startDeepResearchRun(ctx.db);
  ctx.logger.info("deep-research", `Starting deep research run ${run.id}`);

  try {
    const response = await requestTextWithWebSearch(ctx.openai, {
      model: ctx.config.news.deepResearchModel,
      system: buildDeepResearchSystemPrompt(),
      user: buildDeepResearchUserPrompt(ctx.editorialFocus, ctx.now.toISOString()),
      maxOutputTokens: 4096,
    });

    finishDeepResearchRun(ctx.db, run.id, {
      status: "success",
      context_blob: response.text,
      token_usage_json: JSON.stringify(response.usage),
    });
    ctx.logger.info("deep-research", `Deep research run ${run.id} completed`, {
      searchCount: response.searchCount,
      length: response.text.length,
    });
    return response.text;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    finishDeepResearchRun(ctx.db, run.id, { status: "failed", error_message: message });
    ctx.logger.error("deep-research", "Deep research run failed", { error: message });
    return null;
  }
}
