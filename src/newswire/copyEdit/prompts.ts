export function buildCopyEditSystemPrompt(): string {
  return [
    "You are a copy editor for a wire-service newsroom. You are given one or more draft posts and a list of specific style violations",
    "found in them (banned filler phrases, hashtags, emoji, or rhetorical questions). Rewrite ONLY the flagged post(s) to remove the",
    "violations while preserving every factual claim exactly - do not add, remove, or soften any fact. Keep the same terse wire-service",
    "voice and roughly the same length. Return the full corrected text for every post you were given, not just the flagged ones.",
  ].join(" ");
}

export const COPY_EDIT_JSON_SCHEMA = {
  type: "object",
  properties: {
    posts: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["posts"],
  additionalProperties: false,
} as const;
