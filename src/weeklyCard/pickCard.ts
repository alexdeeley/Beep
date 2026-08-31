/**
 * Weekly card draw: a standard 52-card deck, deterministically rotated by
 * calendar week (same "stateless, reproducible" approach as the daily
 * pipeline's environment/theme rotation) so a given Sunday always draws
 * the same card - reproducible for testing via --date, and the full deck
 * cycles once per year before any card repeats.
 */
export interface PlayingCard {
  rank: string;
  suit: "Hearts" | "Diamonds" | "Clubs" | "Spades";
  /** "Ace of Spades" style display name. */
  label: string;
}

const RANKS = ["Ace", "2", "3", "4", "5", "6", "7", "8", "9", "10", "Jack", "Queen", "King"];
const SUITS: PlayingCard["suit"][] = ["Hearts", "Diamonds", "Clubs", "Spades"];

const DECK: PlayingCard[] = SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit, label: `${rank} of ${suit}` })));

/**
 * Deterministically picks a card for the given ISO date, keyed by the
 * ISO week number (Sunday-to-Sunday) since the Unix epoch so that every
 * Sunday in a run of consecutive weeks draws a different card until the
 * full 52-card deck is exhausted, then the cycle repeats.
 */
export function pickWeeklyCard(isoDate: string): PlayingCard {
  const weeks = Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / (7 * 86_400_000));
  const idx = ((weeks % DECK.length) + DECK.length) % DECK.length;
  return DECK[idx]!;
}
