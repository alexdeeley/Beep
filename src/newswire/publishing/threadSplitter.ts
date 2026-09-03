import { BLUESKY_MAX_POST_GRAPHEMES } from "../../bluesky/threadPublish.js";

export class ThreadSplitError extends Error {}

export function countGraphemes(text: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].length;
}

/** Splits text at sentence boundaries, keeping terminal punctuation attached to each sentence. */
function splitIntoSentences(text: string): string[] {
  const matches = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
  return (matches ?? [text]).map((s) => s.trim()).filter(Boolean);
}

/**
 * Takes the writer's draft posts (already logically separate units) and
 * guarantees every resulting post fits within Bluesky's grapheme limit,
 * splitting any oversized one at sentence boundaries into as many posts
 * as needed - NEVER mid-sentence. If a single sentence alone exceeds the
 * limit and can't be split without breaking mid-sentence, this throws
 * rather than silently truncating - that's a hard failure the caller
 * should treat as "this edition needs to go back for a tighter rewrite,"
 * not something to paper over by cutting a sentence off.
 */
export function splitIntoThread(posts: { text: string }[], maxGraphemes: number = BLUESKY_MAX_POST_GRAPHEMES): string[] {
  const result: string[] = [];

  for (const post of posts) {
    if (countGraphemes(post.text) <= maxGraphemes) {
      result.push(post.text);
      continue;
    }

    const sentences = splitIntoSentences(post.text);
    let current = "";
    for (const sentence of sentences) {
      if (countGraphemes(sentence) > maxGraphemes) {
        throw new ThreadSplitError(
          `A single sentence exceeds ${maxGraphemes} graphemes and cannot be split without breaking mid-sentence: "${sentence.slice(0, 80)}..."`
        );
      }
      const candidate = current ? `${current} ${sentence}` : sentence;
      if (countGraphemes(candidate) <= maxGraphemes) {
        current = candidate;
      } else {
        result.push(current);
        current = sentence;
      }
    }
    if (current) result.push(current);
  }

  if (result.length === 0 || result[0]!.trim().length === 0) {
    throw new ThreadSplitError("Thread split produced an empty first post - the edition cannot stand on its own.");
  }

  return result;
}
