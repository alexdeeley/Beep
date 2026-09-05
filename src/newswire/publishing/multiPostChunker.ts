import { BLUESKY_MAX_POST_GRAPHEMES } from "../../bluesky/threadPublish.js";
import { countGraphemes } from "./threadSplitter.js";

/**
 * Chunks a header plus a flowing, comma-separated list of items (e.g. artist
 * names for NEW MUSIC FRIDAY) into grapheme-safe physical posts. The header
 * gets its own paragraph on the first post; overflow posts pick up straight
 * from the next item, comma-separated, with no header repeat. Throws if the
 * header or any single item alone exceeds the limit - fail loudly rather
 * than truncate a name.
 */
export function buildCommaSeparatedPost(header: string, items: string[], maxGraphemes: number = BLUESKY_MAX_POST_GRAPHEMES): string[] {
  if (countGraphemes(header) > maxGraphemes) {
    throw new Error(`The post header alone exceeds ${maxGraphemes} graphemes: "${header}"`);
  }
  if (items.length === 0) return [header];

  const posts: string[] = [];
  let current = header;
  let currentHasItems = false;

  for (const item of items) {
    if (countGraphemes(item) > maxGraphemes) {
      throw new Error(`A single item exceeds ${maxGraphemes} graphemes: "${item.slice(0, 80)}..."`);
    }
    const separator = currentHasItems ? ", " : "\n\n";
    const candidate = `${current}${separator}${item}`;
    if (countGraphemes(candidate) <= maxGraphemes) {
      current = candidate;
      currentHasItems = true;
    } else {
      posts.push(current);
      current = item;
      currentHasItems = true;
    }
  }
  posts.push(current);
  return posts;
}

/**
 * Chunks a header plus one-line-per-entry content (e.g. "1977: Fleetwood
 * Mac releases Dreams" for TODAY IN HISTORY) into grapheme-safe physical
 * posts, never splitting a line across posts. Throws if the header or any
 * single line alone exceeds the limit.
 */
export function buildMultiLinePost(header: string, lines: string[], maxGraphemes: number = BLUESKY_MAX_POST_GRAPHEMES): string[] {
  if (countGraphemes(header) > maxGraphemes) {
    throw new Error(`The post header alone exceeds ${maxGraphemes} graphemes: "${header}"`);
  }
  if (lines.length === 0) return [header];

  const posts: string[] = [];
  let current = header;

  for (const line of lines) {
    if (countGraphemes(line) > maxGraphemes) {
      throw new Error(`A single line exceeds ${maxGraphemes} graphemes: "${line.slice(0, 80)}..."`);
    }
    const candidate = `${current}\n\n${line}`;
    if (countGraphemes(candidate) <= maxGraphemes) {
      current = candidate;
    } else {
      posts.push(current);
      current = line;
    }
  }
  posts.push(current);
  return posts;
}
