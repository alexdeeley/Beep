// BLACKJACK — cards, shoe, and hand-value math. Pure and stateless: no
// knowledge of players, turns, or money. table-room.js owns all of that.

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUITS = ['♠', '♥', '♦', '♣'];

// A shoe of `numDecks` standard 52-card decks, shuffled together (Fisher-Yates).
// `rand` is injectable so tests can seed a deterministic shuffle.
export function createShoe(numDecks = 6, rand = Math.random) {
  const shoe = [];
  for (let d = 0; d < numDecks; d++) {
    for (const suit of SUITS) for (const rank of RANKS) shoe.push({ rank, suit });
  }
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}

export function cardValue(rank) {
  if (rank === 'A') return 11;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 10;
  return Number(rank);
}

// { total, soft, bust }. "soft" means at least one Ace is still being
// counted as 11 in this total (so the hand can still take a hit without
// necessarily busting - "soft 17" can become "hard 17" or better on a hit).
export function handValue(cards) {
  let total = 0;
  let acesHigh = 0;
  for (const c of cards) {
    total += cardValue(c.rank);
    if (c.rank === 'A') acesHigh++;
  }
  while (total > 21 && acesHigh > 0) {
    total -= 10;
    acesHigh--;
  }
  return { total, soft: acesHigh > 0, bust: total > 21 };
}

// A "natural" - 21 on the first two cards. A 21 reached with three or more
// cards is a plain 21, not a blackjack (no 3:2 bonus, and it loses to a
// dealer natural rather than pushing against it).
export function isBlackjack(cards) {
  return cards.length === 2 && handValue(cards).total === 21;
}

// Dealer stands on soft 17 (this table's house rule - see DECISIONS.md).
export function dealerShouldHit(cards) {
  return handValue(cards).total < 17;
}

// Casino shoes get reshuffled before they run out mid-hand, not exactly
// when empty - conventionally when fewer than ~25% of the shoe remains.
export function needsReshuffle(shoe, numDecks) {
  return shoe.length < numDecks * 52 * 0.25;
}
