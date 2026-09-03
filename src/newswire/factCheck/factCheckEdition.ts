import { z } from "zod";
import { requestJson } from "../../utils/openaiClient.js";
import type { NewsRunContext } from "../runContext.js";
import type { DraftEdition, FactCheckResult } from "../types.js";
import type { WritingItem } from "../writing/prompts.js";
import { buildFactCheckUserPrompt, FACT_CHECK_SYSTEM_PROMPT } from "./prompts.js";

const factCheckResultSchema = z.object({
  claims: z.array(
    z.object({
      postIndex: z.number().int(),
      claim: z.string(),
      verdict: z.enum(["SUPPORTED", "PARTIALLY_SUPPORTED", "UNSUPPORTED", "CONTRADICTED"]),
      explanation: z.string(),
    })
  ),
});

/**
 * MANDATORY final gate: extracts every factual claim from the copy-edited
 * text and checks it against the independently-verified source facts -
 * never against outside knowledge or plausibility. Publishing may only
 * proceed if every extracted claim comes back SUPPORTED; this function
 * itself decides that boolean deterministically from the claim list
 * rather than trusting a model-reported summary judgment.
 *
 * Note on scope: this checks the final copy against the record already
 * produced by independent web-search verification (verifyClusters.ts) -
 * it does not re-run web search itself. That upstream stage is where the
 * "check against the live web, not model memory" work happens; this
 * stage's job is narrower and just as necessary: catching claims the
 * writer/copy-editor introduced, embellished, or distorted while
 * composing prose from that already-verified record.
 */
export async function factCheckEdition(
  ctx: NewsRunContext,
  edition: DraftEdition,
  items: WritingItem[]
): Promise<FactCheckResult> {
  if (edition === null || edition.posts.length === 0) {
    return { claims: [], allMaterialClaimsSupported: true };
  }

  let result: z.infer<typeof factCheckResultSchema>;
  try {
    const raw = await requestJson<unknown>(ctx.openai, {
      model: ctx.config.news.factCheckModel,
      system: FACT_CHECK_SYSTEM_PROMPT,
      user: buildFactCheckUserPrompt(edition.posts, items),
      temperature: 0,
      maxOutputTokens: 2048,
    });
    result = factCheckResultSchema.parse(raw);
  } catch (err) {
    ctx.logger.error("fact-check", "Fact-check request failed - refusing to publish unverified copy", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      claims: [{ postIndex: -1, claim: "(fact-check stage itself failed)", verdict: "UNSUPPORTED", explanation: String(err) }],
      allMaterialClaimsSupported: false,
    };
  }

  const allSupported = result.claims.every((c) => c.verdict === "SUPPORTED");
  if (!allSupported) {
    ctx.logger.warn("fact-check", "One or more claims did not come back SUPPORTED - publishing will be blocked", {
      unsupported: result.claims.filter((c) => c.verdict !== "SUPPORTED"),
    });
  } else {
    ctx.logger.info("fact-check", `All ${result.claims.length} claim(s) SUPPORTED`);
  }

  return { claims: result.claims, allMaterialClaimsSupported: allSupported };
}
