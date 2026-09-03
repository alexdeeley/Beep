import type { EditorialFocus } from "../editorialFocus.js";
import type { RankedStoryEvent, StoryConnection, VerifiedFact } from "../types.js";

export interface WritingItem {
  ranked: RankedStoryEvent;
  facts: VerifiedFact[];
  isNewStory: boolean;
  connections: StoryConnection[];
}

export const WRITING_JSON_SCHEMA = {
  type: "object",
  properties: {
    shouldPost: { type: "boolean" },
    posts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          sourceItemIndexes: { type: "array", items: { type: "integer" } },
        },
        required: ["text", "sourceItemIndexes"],
        additionalProperties: false,
      },
    },
  },
  required: ["shouldPost", "posts"],
  additionalProperties: false,
} as const;

const GOOD_BAD_EXAMPLES = [
  "BAD (generic AI filler): \"In a significant development that underscores the growing tension in the region, officials announced today " +
    "that new tariffs would be imposed, marking a major shift in trade policy.\"",
  'GOOD (wire style): "The White House imposed 25% tariffs on steel imports Tuesday, effective next month. Industry groups praised the move; ' +
    'import-reliant manufacturers warned of higher costs."',
  'BAD (rhetorical/engagement bait): "Could this be the beginning of the end for the deal? Only time will tell."',
  'GOOD: "The merger requires regulatory approval in three countries. A decision is expected by December."',
  'BAD (false precision on breaking news): "Exactly 47 people were injured in the incident, officials confirmed."',
  'GOOD (appropriate hedging): "Officials said dozens were injured; the exact number was still being confirmed as of press time."',
].join("\n");

export function buildWritingSystemPrompt(focus: EditorialFocus, maxPosts: number): string {
  const voiceRules: string[] = [];
  if (!focus.voice.allowJokes) voiceRules.push("No jokes, humor, or snark.");
  if (!focus.voice.allowHashtagsInline) voiceRules.push("No hashtags.");
  if (!focus.voice.allowEmoji) voiceRules.push("No emoji.");
  if (!focus.voice.allowRhetoricalQuestions) voiceRules.push("No rhetorical questions or engagement-bait phrasing.");

  return [
    "You are the writing stage of an autonomous wire-service newsroom, posting to Bluesky. Write in stripped-down, economical wire-service",
    "prose: short declarative sentences, active voice, facts first, no editorializing, no filler, no throat-clearing. Every sentence must",
    "carry information - if a sentence could be deleted without losing a fact, delete it.",
    voiceRules.join(" "),
    "Structure is dynamic, not a fixed template - a single-sentence update is fine; a multi-post thread is fine when there's genuinely that",
    "much to say. Never pad a short update into a longer thread just to fill space.",
    `You may produce at most ${maxPosts} post(s) total across the whole edition (it may cover more than one story if there's room).`,
    "Each post's text should fit comfortably in a single Bluesky post (roughly 260-280 characters is a safe target; never write a run-on",
    "sentence that gets cut off mid-thought - each post must be a complete, standalone thought even if it's part of a thread).",
    "Only reference a connection between stories when it's given to you explicitly below as evidence-based - never invent a connection.",
    "When a claim is UNCONFIRMED or a PREDICTION, say so plainly (\"officials say\", \"expected to\") rather than stating it as settled fact.",
    "Distinguish when something happened from when it was reported, if that distinction matters to the reader.",
    "If, after reviewing the material, none of it is genuinely worth posting about this hour, set shouldPost to false and return an empty",
    "posts array - staying silent is a normal, expected, and preferred outcome over posting something thin or padded.",
    "",
    "Examples of the required style:",
    GOOD_BAD_EXAMPLES,
  ]
    .filter(Boolean)
    .join(" \n");
}

export function buildWritingUserPrompt(items: WritingItem[]): string {
  const blocks = items.map((item, i) => {
    const factLines = item.facts.map((f) => `  - [${f.factLabel}] ${f.claim}`).join("\n");
    const connectionLines = item.connections.map((c) => `  - ${c.explanation}`).join("\n");
    return [
      `ITEM ${i} (${item.isNewStory ? "new story" : "development in an ongoing story"}, importance ${item.ranked.importanceScore.toFixed(2)}):`,
      `Headline: ${item.ranked.headline}`,
      "Facts:",
      factLines,
      item.connections.length ? "Evidence-based connections to other open stories:\n" + connectionLines : "",
    ]
      .filter(Boolean)
      .join("\n");
  });

  return blocks.join("\n\n");
}
