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
  "SUPPORTED = the verified facts directly state this. PARTIALLY_SUPPORTED = the verified facts support part of it but not all",
  "(e.g. the post added unsupported specificity, like an invented adjective or number). UNSUPPORTED = nothing in the verified facts",
  "backs this claim at all - it appears to have been invented or drawn from outside the verified record. CONTRADICTED = the verified",
  "facts directly say something different from this claim. Be strict: a plausible-sounding elaboration the writer added is UNSUPPORTED",
  "if it isn't actually in the verified facts, even if it seems like a reasonable inference.",
  'Respond with ONLY {"claims":[{"postIndex":0,"claim":"...","verdict":"SUPPORTED","explanation":"..."}]}.',
].join(" ");

export function buildFactCheckUserPrompt(posts: { text: string }[], items: WritingItem[]): string {
  const postLines = posts.map((p, i) => `[${i}]: ${p.text}`).join("\n");
  const verifiedLines = items
    .flatMap((item, i) => item.facts.map((f) => `ITEM ${i}: [${f.factLabel}] ${f.claim}`))
    .join("\n");
  return ["FINAL POST TEXT:", postLines, "", "VERIFIED SOURCE FACTS (the only permitted grounding):", verifiedLines].join("\n");
}
