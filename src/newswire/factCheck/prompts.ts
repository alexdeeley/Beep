import type { WritingItem } from "../writing/prompts.js";

const VERDICTS = ["SUPPORTED", "PARTIALLY_SUPPORTED", "UNSUPPORTED", "CONTRADICTED"] as const;

export const FACT_CHECK_JSON_SCHEMA = {
  type: "object",
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          postIndex: { type: "integer" },
          claim: { type: "string" },
          verdict: { type: "string", enum: VERDICTS as unknown as string[] },
          explanation: { type: "string" },
        },
        required: ["postIndex", "claim", "verdict", "explanation"],
        additionalProperties: false,
      },
    },
  },
  required: ["claims"],
  additionalProperties: false,
} as const;

export const FACT_CHECK_SYSTEM_PROMPT = [
  "You are the mandatory final fact-check gate before publishing. You are given the FINAL published post text and the independently",
  "VERIFIED source facts that were supposed to ground it. Break the final post text into its individual factual claims (ignore pure",
  "style/framing, focus on assertions of fact: numbers, names, actions, causal claims, quotes). For each claim, verdict it against",
  "the verified facts ONLY - do not use outside knowledge or assume anything is true just because it sounds plausible:",
  "",
  "SUPPORTED = the verified facts back this claim, INCLUDING when the post rewords or paraphrases the source as long as the substance -",
  "the same numbers, subjects, scope, and meaning - is preserved. Judge like a copy editor comparing a published article against its",
  "sourcing, not like a plagiarism checker: 'X said healthcare access is essential' and 'X called healthcare access essential' are the",
  "SAME claim in different words, and both are SUPPORTED. Compressing a source's wording, dropping a redundant qualifier, or using a",
  "natural synonym (e.g. 'backs' for 'supports', 'universal healthcare' for 'healthcare for all') does NOT make a claim unsupported -",
  "only a change in the actual facts asserted does.",
  "",
  "PARTIALLY_SUPPORTED = the post changed what is actually being claimed, not just how it's phrased: it added a specific number, name,",
  "cause, or detail that is NOT in the verified facts (even as a plausible-sounding elaboration), or it broadened/narrowed the scope of",
  "the source's claim (e.g. the source says 'some economists' and the post says 'economists' or 'most economists').",
  "",
  "UNSUPPORTED = nothing in the verified facts backs this claim at all - it appears to have been invented or drawn from outside the",
  "verified record.",
  "",
  "CONTRADICTED = the verified facts directly say something different from this claim (a real factual conflict, not a wording difference).",
  "",
  "Be strict about facts, lenient about phrasing: a claim that accurately restates a verified fact in the writer's own words is",
  "SUPPORTED - only flag PARTIALLY_SUPPORTED/UNSUPPORTED/CONTRADICTED when the post asserts something the verified facts don't actually",
  "establish, not merely because it isn't a verbatim quote.",
  "",
  'Respond with ONLY {"claims":[{"postIndex":0,"claim":"...","verdict":"SUPPORTED","explanation":"..."}]}.',
].join(" ");

export function buildFactCheckUserPrompt(posts: { text: string }[], items: WritingItem[]): string {
  const postLines = posts.map((p, i) => `[${i}]: ${p.text}`).join("\n");
  const verifiedLines = items
    .flatMap((item, i) => item.facts.map((f) => `ITEM ${i}: [${f.factLabel}] ${f.claim}`))
    .join("\n");
  return ["FINAL POST TEXT:", postLines, "", "VERIFIED SOURCE FACTS (the only permitted grounding):", verifiedLines].join("\n");
}
