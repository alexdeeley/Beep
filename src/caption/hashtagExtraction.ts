import type { Category, SelectedContent, SelectedFact } from "../utils/types.js";

/**
 * Deterministically derives hashtag candidates directly from the day's
 * verified, selected content - people's names, places, event topics, and
 * categories - rather than relying solely on an LLM to guess relevant
 * tags. This exists because Bluesky hard-caps discovery tags at 8 (see
 * src/bluesky/publish.ts): with so few slots, they should go to the most
 * specific, story-derived terms first, not generic filler.
 *
 * Output is bare PascalCase words (no "#", no spaces - hashtags can't
 * contain spaces), ordered highest-priority first. Ranking, deduping, and
 * the hard 8-tag cap itself are applied downstream by
 * selectBlueskyTags(); this module only proposes candidates and their
 * priority order.
 */

const STOPWORDS = new Set([
  "the", "a", "an", "of", "in", "on", "at", "to", "and", "or", "for", "its",
  "this", "that", "was", "were", "are", "is", "be", "with", "by", "as",
  "from", "after", "before", "during", "into", "over", "under", "his",
  "her", "their", "first", "final",
]);

const CATEGORY_LABELS: Partial<Record<Category, string>> = {
  war_conflict: "War",
  politics_government: "Politics",
  science_discovery: "Science",
  invention_technology: "Innovation",
  space_exploration: "Space",
  disaster_natural: "Disaster",
  disaster_manmade: "Disaster",
  music: "Music",
  film_television: "Film",
  literature_arts: "Literature",
  sports: "Sports",
  culture_society: "Culture",
  strange_incident: "Strange",
  anniversary_other: "Anniversary",
  // "birth"/"death" deliberately omitted - redundant with the person's own name tag.
};

export function toPascalTag(text: string): string {
  return text
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

/**
 * Picks up to `maxWords` non-stopword words from a phrase and PascalCases
 * them into a single bare tag. Used both for a headline without a named
 * person, and (see src/bluesky/trending.ts) to turn a multi-word Bluesky
 * trending-topic phrase into a tag-shaped token.
 */
export function phraseToTag(phrase: string, maxWords = 3): string | null {
  const words = phrase
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean);
  const significant = words.filter((w) => !STOPWORDS.has(w.toLowerCase()));
  const chosen = (significant.length > 0 ? significant : words).slice(0, maxWords);
  if (chosen.length === 0) return null;
  return toPascalTag(chosen.join(" "));
}

/** The first, most specific segment of a "City, Region, Country" location string. */
function locationTag(location: string | null): string | null {
  if (!location) return null;
  const first = location.split(",")[0]?.trim();
  if (!first) return null;
  const tag = toPascalTag(first);
  return tag.length > 0 ? tag : null;
}

/**
 * Derives an ordered pool of content-specific hashtag candidates from the
 * day's selected content, ranked by each fact's own selectionScore
 * (highest-importance facts contribute their tags first). Priority within
 * a fact: person name > headline topic phrase > place > category.
 */
export function deriveContentHashtags(selected: SelectedContent): string[] {
  const allItems: SelectedFact[] = [
    ...selected.majorEvents,
    ...selected.births,
    ...selected.deaths,
    ...selected.incidents,
  ].slice().sort((a, b) => b.selectionScore - a.selectionScore);

  const personTags: string[] = [];
  const phraseTags: string[] = [];
  const placeTags: string[] = [];
  const categoryTags: string[] = [];
  const seenCategories = new Set<Category>();

  for (const item of allItems) {
    const person = item.people[0] ? toPascalTag(item.people[0]) : null;
    if (person) {
      personTags.push(person);
    } else {
      const phrase = phraseToTag(item.headline);
      if (phrase) phraseTags.push(phrase);
    }

    const place = locationTag(item.location);
    if (place) placeTags.push(place);

    const categoryLabel = CATEGORY_LABELS[item.category];
    if (categoryLabel && !seenCategories.has(item.category)) {
      seenCategories.add(item.category);
      categoryTags.push(categoryLabel);
    }
  }

  return [...personTags, ...phraseTags, ...placeTags, ...categoryTags];
}
