import type { EditorialFocus } from "../editorialFocus.js";
import type { FactLabel } from "../types.js";
import type { ReleaseType } from "../db/releasesRepo.js";

export interface MusicFact {
  factLabel: FactLabel;
  claim: string;
}

/** One release, with its facts synthesized deterministically from the Spotify API response - never model-generated, so the fact-check gate has a ground truth to check the writer's prose against. */
export interface WritingItem {
  releaseId: number;
  artistName: string;
  releaseType: ReleaseType;
  title: string;
  releaseDate: string;
  totalTracks: number;
  genres: string[];
  spotifyUrl: string;
  facts: MusicFact[];
}

export function buildReleaseFacts(item: {
  artistName: string;
  releaseType: ReleaseType;
  title: string;
  releaseDate: string;
  totalTracks: number;
  genres: string[];
  spotifyUrl: string;
}): MusicFact[] {
  const facts: MusicFact[] = [
    {
      factLabel: "FACT",
      claim: `${item.artistName} released a new ${item.releaseType} titled "${item.title}" on ${item.releaseDate}.`,
    },
    { factLabel: "FACT", claim: `"${item.title}" has ${item.totalTracks} track${item.totalTracks === 1 ? "" : "s"}.` },
  ];
  if (item.genres.length > 0) {
    facts.push({ factLabel: "FACT", claim: `Spotify associates ${item.artistName} with these genres: ${item.genres.join(", ")}.` });
  }
  facts.push({ factLabel: "FACT", claim: `The release is available on Spotify at ${item.spotifyUrl}.` });
  return facts;
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
  'GOOD (wire style): "Alvvays released their new album \\"Blue Rev II\\" today, 9 tracks."',
  'BAD (invented editorial claim not in the facts): "This marks a bold new direction for the band."',
  'GOOD (states only what\'s given): "Fontaines D.C. released the single \\"Favourite\\" today - their first new material since 2024."',
  "BAD (padding a one-line announcement into filler): \"In an exciting development for fans everywhere, the wait is finally over as...\"",
  'GOOD: "Bon Iver released a new single, \\"Speyside,\\" today."',
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
    "You are the writing stage of an autonomous music release-announcement wire, posting to Bluesky. Each item below is one confirmed",
    "new release (album, single, or compilation) from an artist on the watchlist, already verified against the Spotify catalog - the",
    "facts given are ground truth, not something you need to hedge or verify further.",
    "Write ONE short, factual announcement post per item: artist, release title, release type, and (when it adds real information, not",
    "just filler) something like track count or genre. Present tense, active voice, no throat-clearing, no hype adjectives",
    '("essential", "must-listen", "banger", "iconic"), no editorializing about quality or significance - you were not given any claim',
    "about how good or important the release is, so do not invent one. State only what the facts given to you actually say.",
    voiceRules.join(" "),
    `Produce exactly one post per item you are given, up to ${maxPosts} items total per edition (if more than ${maxPosts} items are`,
    `given, prioritize the ones listed first). Each post's text should fit comfortably in a single Bluesky post (roughly 200-260`,
    "characters is a safe target).",
    "If an item's facts are too thin or malformed to write a genuine, accurate sentence about, omit that item from posts rather than",
    "padding it out or guessing. If NONE of the items are worth posting about, set shouldPost to false and return an empty posts array -",
    "this should be rare, since every item here already passed release verification, but is allowed when the data is degenerate.",
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
    return [`ITEM ${i} (${item.releaseType}):`, "Facts:", factLines].join("\n");
  });
  return blocks.join("\n\n");
}
