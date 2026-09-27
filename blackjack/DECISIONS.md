# Decisions

Every design choice this build made on its own, with the reasoning, roughly in
the order they came up. Two decisions were made by the user up front, not
autonomously, and everything below builds on them:

- **Chips & betting**, not just a running win/loss record - so a future
  high-score system has something real to rank (biggest bankroll, longest
  streak), and so the game feels like actual blackjack rather than a quiz.
- **One shared table with one live dealer**, turns going around in seat
  order - the real multiplayer-casino shape, not everyone playing an
  isolated hand in parallel against their own dealer.

## No "game over" - the table just keeps dealing

Draw Together has a fixed number of rounds and a "Play Again" screen because
turn-taking in a drawing game needs an endpoint to feel fair (everyone drew
the same number of times). Blackjack has no such need - a real table doesn't
stop after N hands, people just sit down and get up whenever. So after the
host's one-time `start`, the table cycles betting → dealing → playing →
dealer → reveal → betting forever, with no equivalent of Draw Together's
`over` phase at all. New players can join mid-session; they simply wait for
the next betting phase. This also meant there was no need to port Draw
Together's round-count settings UI - there's nothing to configure.

## Dealer stands on soft 17

Real casinos split on this; hitting soft 17 is a little better for the house,
standing is a little better for the player. Since this is a casual game for
friends/family rather than a house trying to grind an edge, standing on soft
17 was the natural pick - it's also one simpler rule to implement and explain
("dealer stands on 17 or higher, full stop").

## Split rules: same rank only, one split, no resplit, no double after split

Real casinos vary a lot here. To keep the rules explainable in one sentence
and the state machine tractable, this table picked the stricter end
throughout: splitting requires the same *rank* (a King and a plain 10 can't
split, even though they're both worth 10), only one split is allowed (no
re-splitting a split hand), and a split hand can't be doubled. Splitting
aces is the one place every casino agrees: exactly one card each, hand ends
there, and a 21 from it is a plain 21, not a blackjack (no 3:2 bonus) - all
implemented and unit-tested explicitly, including the "no bonus" case, since
it's the rule most people get wrong.

## Dealer peek for a natural

If the dealer's up-card is anything and their hole card gives them a natural
21, the round settles immediately and nobody plays out a hand the dealer
already won - that's `finishBetting()` checking `isBlackjack(dealer.cards)`
before ever entering the `playing` phase. Symmetrically, if the dealer does
*not* have a natural, a player's own blackjack is a guaranteed win recorded
at deal time (`status: 'blackjack'`) rather than something resolved later by
comparing totals - it can't lose to anything the dealer draws afterward, so
there's no reason to wait.

## Auto-restock on busting out completely

If a player's chips hit exactly 0 after a hand resolves, they're restocked to
the starting stack rather than stranded at the table with nothing to bet.
This is a "house rule" chosen purely so a casual session never dead-ends -
real casinos obviously don't do this, but a real casino also isn't trying to
keep a family game night going.

## Turn clock auto-stands, doesn't skip

Not acting within the decision window auto-*stands* the current hand rather
than auto-folding or skipping it - the same philosophy as a real table
where a distracted player still has whatever they were dealt. This is driven
by the same single Durable Object alarm that handles the betting deadline,
the dealer's own card-by-card pacing, and the reveal pause - one alarm,
whichever phase interprets it (see `table-room.js`'s `alarm()`), rather than
separate timers per concern.

## One broadcast state for everyone, not a per-viewer view

Draw Together's server tailors the state it sends per player, because the
word must reach only the drawer. Blackjack has no equivalent secret to hide
per-player - every hand at a real table is visible to everyone, and the
*only* hidden thing (the dealer's hole card) is hidden identically for
every viewer. So `view()` takes no per-player branch except which seat is
"you" - genuinely simpler than the drawing game's protocol, not just
simplified for expediency.

## Testing: in-process state-machine harness + real-wire browser test

Draw Together's unit tests could force a specific word by injecting a `rand`
function into `pickWord`. Blackjack scenarios need *exact card sequences*
(this exact pair to test a split, this exact dealer hand to test a bust) -
far more specific than picking one item from a list. Rather than invent a
wire-level "test mode" that could leak into production, `dev/emulate.mjs`
provides a `FakeSocket` and a `makeHolder()` that construct a real
`TableRoom` instance in-process, with no real sockets or timers, so a test
can reach directly into `room.shoe` to force whatever sequence it needs and
call methods like `dealerStep()` or `autoAdvanceTurn()` directly instead of
waiting on real timeouts. This is what actually caught the sharpest bug in
this build (see below) and lets 93 checks run in well under a second.

The Playwright browser test, in contrast, plays against genuinely random
cards - there's no equivalent forcing hook over the real wire, on purpose,
since a debug backdoor that could set someone's hand from outside the game
logic is a real product risk if it ever shipped live. So it drives the game
adaptively (hit under 15, stand otherwise) and asserts what has to be true
regardless of what was dealt: both clients see byte-identical state, the
hole card never leaks early, doubling deducts the right amount, chips and
stats accumulate correctly, and the table loops on its own. A `window.__bj`
debug hook (mirroring Draw Together's `window.__dt`) lets the test inspect
client state without needing that backdoor.

## A real bug the tests caught: `type` meant two different things

The very first draft of the `action` handler read `msg.type` to decide
hit/stand/double/split - but the *outer* message envelope's `type` field
(`'action'`) is what routes to that handler in the first place
(`HANDLERS[msg.type]`). Both purposes were fighting over one JSON key, and
since a JS object literal silently keeps only the *last* of two duplicate
keys, the very first hand-written test calls (`{ type: 'action', type: 'hit'
}`) were quietly collapsing to `{ type: 'hit' }` - which doesn't match any
handler and does nothing at all. Every `action` test failed the same way
until this was traced down to its root: the wire protocol needed a genuinely
separate field (`action`) for the verb, not just a test-script fix. Left as
a cautionary note here because it's exactly the kind of bug that a
type-unaware protocol invites, and it's worth remembering next time a new
message type is added to any of these games.

## A real bug the tests caught: the code input was one character too short

`#in-code`'s `maxlength` was set to 5, matching the *letters* portion of a
table code - but codes are a card-themed word (3-5 letters) *plus* a digit,
so the longest ones (`QUEEN2`, `JOKER5`, `SPADE9`, `HEART3`, `TABLE8`) are 6
characters, and 5 of the 30 code words are exactly this long. `maxlength=5`
silently truncated the trailing digit off any of those, which then failed
client-side validation before the join attempt ever reached the server - a
real bug for a real person typing a real code, not just a test artifact,
that the Playwright test caught by reproducing at almost exactly the
predicted rate (5/30 ≈ one in six joins) across repeated runs. Fixed by
widening it to 6.

## Local dev server: Range support from day one

Draw Together's toy Node dev server didn't answer HTTP Range requests
correctly, which `<audio>` elements probe with - it worked by accident until
background music was added, at which point it started intermittently
aborting loads and had to be fixed after the fact (see Draw Together's own
`DECISIONS.md`/session history). This project doesn't currently serve any
audio *files* (every sound here is synthesized, same as Draw Together's
effects), but `dev/local-server.mjs` ships with correct 206/Content-Range
handling regardless, so the same class of bug can't resurface quietly if
a game asset is ever added later.

## No image assets - cards are rendered, not drawn

Every card is a plain rounded box with its rank and suit as text (red for
hearts/diamonds, black for spades/clubs), the same "everything is code, no
binary assets" approach the rest of this repo takes for its generative/art
pieces. The one deliberate exception anywhere in this repo is Draw Together's
user-supplied background music, which is real audio because there's no way
to synthesize someone's actual song.

## Toward play.deeley.org

This table's `/api/tables/:code/leaderboard` endpoint and each player's
`stats` object (hands played/won, pushes, blackjacks, best streak, biggest
bankroll) are deliberately generic - not blackjack-specific beyond the
`blackjacks` counter - so a future shared high-score service has an obvious
shape to aggregate if and when there's a second game to compare it against.
Building that shared service now, with only one game to design it around,
would be guessing at a schema with no real second data point to validate it
- better to let it emerge once play.deeley.org actually has more than one
table to unify.
