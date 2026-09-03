/**
 * Phrases and constructions that read as generic AI-generated filler
 * rather than wire-service prose. This list is intentionally blunt
 * substring/regex matching, not semantic - it exists as a fast,
 * deterministic backstop the copy-edit stage checks its own output
 * against, catching anything the model's own self-editing missed.
 */
export interface BannedPhraseMatch {
  phrase: string;
  index: number;
}

const BANNED_PHRASES: string[] = [
  "in today's fast-paced world",
  "in an increasingly",
  "it is worth noting that",
  "it's important to note that",
  "it is important to note",
  "this development comes as",
  "in a significant development",
  "in a surprising turn of events",
  "marks a significant milestone",
  "underscores the importance of",
  "highlights the growing",
  "as the situation continues to unfold",
  "only time will tell",
  "remains to be seen",
  "sparked a wave of",
  "sent shockwaves through",
  "at the end of the day",
  "when all is said and done",
  "the move comes amid",
  "in a bid to",
  "in the wake of this news",
  "stay tuned for",
  "we'll continue to monitor",
  "this is a developing story",
  "let that sink in",
  "game changer",
  "a testament to",
  "paints a picture of",
  "paints a stark picture",
  "delve into",
  "navigating the complexities of",
  "in conclusion,",
  "to sum up,",
  "overall, this",
  "folks,",
  "buckle up",
  "here's the kicker",
  "the bottom line is",
];

const RHETORICAL_QUESTION_PATTERN = /\b(what does this mean for|so what does that mean|could this be the start of)\b/i;
const HASHTAG_PATTERN = /#\w+/;
const EMOJI_PATTERN = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

export function findBannedPhrases(text: string): BannedPhraseMatch[] {
  const lower = text.toLowerCase();
  const matches: BannedPhraseMatch[] = [];
  for (const phrase of BANNED_PHRASES) {
    const index = lower.indexOf(phrase);
    if (index !== -1) matches.push({ phrase, index });
  }
  if (RHETORICAL_QUESTION_PATTERN.test(text)) {
    matches.push({ phrase: "rhetorical question construction", index: text.search(RHETORICAL_QUESTION_PATTERN) });
  }
  return matches;
}

export function hasHashtag(text: string): boolean {
  return HASHTAG_PATTERN.test(text);
}

export function hasEmoji(text: string): boolean {
  return EMOJI_PATTERN.test(text);
}

export function hasRhetoricalQuestion(text: string): boolean {
  // A trailing "?" on a short standalone sentence that isn't a direct quote is treated as rhetorical/engagement-bait phrasing.
  return /(?:^|\.\s+)[A-Z][^.!?]{0,80}\?(?:\s|$)/.test(text) && !text.includes('"');
}
