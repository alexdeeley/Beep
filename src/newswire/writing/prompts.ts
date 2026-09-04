import type { EditorialFocus } from "../editorialFocus.js";
import type { MusicItemType, ReleaseFormat, VerifiedFact } from "../types.js";

/**
 * One music item, grounded in the facts the verification stage
 * independently confirmed - never invented by the writer. Only singles,
 * news, and priority-artist albums ever reach the writer: ordinary
 * album/EP/compilation releases are held back for the weekly WEEKLY NEW
 * RELEASES roundup instead (see runNewswireCycle.ts and
 * weeklyRoundup/postWeeklyRoundup.ts).
 */
export interface WritingItem {
  musicItemId: number;
  artistName: string;
  itemType: MusicItemType;
  releaseFormat: ReleaseFormat | null;
  /** True for an artist in editorial-focus.json's priorityArtists - gets the "HUGE NEWS:" label instead of the normal flat tone. */
  isPriorityArtist: boolean;
  headline: string;
  facts: VerifiedFact[];
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
  'BAD (breathless hype): "Get ready to have your mind blown - the legendary indie icons have finally dropped their most anticipated ' +
    'album yet, and it\'s absolutely essential listening!"',
  'GOOD (single, with the required label): "NEW SINGLE ALERT: Fontaines D.C. released \\"Favourite\\" today - their first new material ' +
    'since 2024."',
  'BAD (invented editorial claim not in the facts): "This marks a bold new direction for the band."',
  'GOOD (news item, no label, states only what\'s given): "Bon Iver will headline three West Coast dates in October, according to a ' +
    "Tuesday announcement on the band's official site.\"",
  "BAD (padding a one-line announcement into filler): \"In an exciting development for fans everywhere, the wait is finally over as...\"",
  'GOOD (single): "NEW SINGLE ALERT: Bon Iver released a new single, \\"Speyside,\\" today."',
  'BAD (stating an UNCONFIRMED claim as settled fact): "The band is breaking up."',
  'GOOD (hedges appropriately): "Sources close to the band say a breakup is imminent, though nothing has been officially confirmed."',
  'GOOD (priority artist, required label, one exclamation point is fine): "HUGE NEWS: Dave Matthews Band announced a new album, ' +
    '\\"Walk Around the Moon II,\\" out November 14! It\'s their first new studio record since 2023."',
  'BAD (priority artist but adds an unsupported superlative beyond the allowed enthusiasm): "HUGE NEWS: the greatest band of all time ' +
    'is BACK with their most essential album ever!!!"',
].join("\n");

export function buildWritingSystemPrompt(focus: EditorialFocus, maxPosts: number): string {
  const voiceRules: string[] = [];
  if (!focus.voice.allowJokes) voiceRules.push("No jokes, humor, or snark.");
  if (focus.voice.allowHashtagsInline) {
    voiceRules.push(
      "You may append 1-2 specific, relevant hashtags at the very end of a post when they would genuinely help discovery " +
        "(e.g. #NewMusic, or the artist/genre name - #Alvvays, #IndieRock). Never use generic engagement hashtags (#music, #trending), " +
        "never hashtag-stuff, and never let a hashtag replace a word that should appear in the sentence itself."
    );
  } else {
    voiceRules.push("No hashtags.");
  }
  if (!focus.voice.allowEmoji) voiceRules.push("No emoji.");
  if (!focus.voice.allowRhetoricalQuestions) voiceRules.push("No rhetorical questions or engagement-bait phrasing.");

  return [
    "You are the writing stage of an autonomous music-news wire, posting to Bluesky. Write in stripped-down, economical wire-service",
    "prose: short declarative sentences, active voice, facts first, no editorializing, no filler, no throat-clearing. Every sentence",
    "must carry information - if a sentence could be deleted without losing a fact, delete it.",
    voiceRules.join(" "),
    `Produce exactly one post per item you are given, up to ${maxPosts} items total per edition (if more than ${maxPosts} items are`,
    `given, prioritize the ones listed first). Each post's text should fit comfortably in a single Bluesky post (roughly 220-270`,
    "characters is a safe target).",
    "Write ONLY from the facts given for each item - never add a detail, number, date, or editorial judgment ('essential', 'huge',",
    "'their best work') that isn't directly supported by the facts. When a fact is labeled UNCONFIRMED or PREDICTION, say so plainly",
    "(\"reportedly\", \"expected to\") rather than stating it as settled. When labeled ANALYSIS, attribute it (\"according to X\") rather",
    "than stating it as fact.",
    'When an item is marked (single), the post text MUST begin with the literal label "NEW SINGLE ALERT: " (that exact capitalization',
    "and punctuation, followed immediately by the rest of the announcement in the same sentence) - this is a fixed editorial label, not",
    "something to reword or omit. Items marked (news) never get this or any other label - just the plain wire-style sentence.",
    'When an item is marked (priority), it is from an artist the reader specifically wants amplified treatment for. The post text MUST',
    'begin with the literal label "HUGE NEWS: " instead of any other label (this replaces NEW SINGLE ALERT if the item is also a single)',
    "- exact capitalization, followed immediately by the rest of the announcement. For a (priority) item only, you may write with more",
    "enthusiasm than usual (one exclamation point is fine, e.g. after a release date), but this is a tone exception, not a facts",
    "exception: still state ONLY what the given facts actually say - never invent a superlative ('legendary', 'greatest', 'essential') or",
    "any claim about quality or significance that isn't directly supported.",
    "If an item's facts are too thin or contradictory to write a genuine, accurate sentence about, omit that item from posts rather",
    "than padding it out or guessing. If NONE of the items are worth posting about, set shouldPost to false and return an empty posts",
    "array - staying silent is a normal, expected, and preferred outcome over posting something thin or padded.",
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
    const kind = [item.releaseFormat ?? item.itemType, item.isPriorityArtist ? "priority" : null].filter(Boolean).join(", ");
    return [`ITEM ${i} (${item.artistName}, ${kind}):`, `Headline: ${item.headline}`, "Facts:", factLines].join("\n");
  });
  return blocks.join("\n\n");
}
