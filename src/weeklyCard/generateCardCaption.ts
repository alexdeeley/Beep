import type { PlayingCard } from "./pickCard.js";
import { toPascalTag } from "../caption/hashtagExtraction.js";

/**
 * Fixed marker every weekly-card post's alt text starts with. Used both
 * as the human-facing title prefix and as the unique substring this
 * pipeline's own idempotency check (see publishCard.ts) matches on - the
 * daily pipeline's posts never contain this string, and this pipeline's
 * posts never contain the daily pipeline's "<Month Day, Year>" date
 * format, so the two idempotency checks can never cross-match each
 * other's posts on the shared account.
 */
export const CARD_POST_MARKER = "Card Draw";

/**
 * Builds the weekly card post's alt/accessibility text. Deliberately
 * deterministic (no LLM call) - this is a simple decorative weekly post,
 * not worth a second point of model flakiness for what would only ever
 * be a short flavor line. Uses the ISO date (not formatHumanDate) so it
 * can never collide with the daily pipeline's own idempotency check,
 * which matches on that human-formatted date string.
 */
export function buildCardAltText(isoDate: string, card: PlayingCard, isDecade: boolean, tags: string[]): string {
  const title = isDecade ? `${CARD_POST_MARKER}: Special Edition` : `${CARD_POST_MARKER}: ${card.label}`;
  const lines = [title, isoDate];
  if (tags.length > 0) lines.push(tags.map((t) => `#${t}`).join(" "));
  return lines.join("\n");
}

/** Deterministic discovery tags for the weekly card post. */
export function buildCardTags(card: PlayingCard, isDecade: boolean): string[] {
  if (isDecade) return ["CardDraw", "SpecialEdition"];
  return ["CardDraw", toPascalTag(card.label), card.suit];
}
