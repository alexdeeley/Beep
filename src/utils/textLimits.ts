/**
 * Deterministic text-length safety net. The research/verification
 * prompts already ask for short headlines (3-8 words) and concise
 * descriptions (15-35 words), but nothing about an LLM response is
 * guaranteed - this is a hard, testable backstop applied in code before
 * anything reaches the renderer, independent of the scale-to-fit
 * behavior in the render stage itself.
 */

export const MAX_HEADLINE_WORDS = 12;
export const MAX_DESCRIPTION_WORDS = 42;

export function truncateWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(" ") + "…";
}

export function enforceHeadlineLimit(headline: string): string {
  return truncateWords(headline, MAX_HEADLINE_WORDS);
}

export function enforceDescriptionLimit(description: string): string {
  return truncateWords(description, MAX_DESCRIPTION_WORDS);
}
