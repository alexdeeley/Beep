# Decisions

Every design choice this build made on its own, with the reasoning,
roughly in the order they came up.

## Cloudflare Workers + Durable Objects, not Node + Socket.IO

The request asked for "Node.js" and "WebSockets / Socket.IO" as an example
architecture, but also said explicitly: *"if the existing project already
has a preferred framework or infrastructure, inspect it first and
integrate with the existing architecture rather than replacing it
unnecessarily."* This repo already has two working real-time multiplayer
games (`draw-together`, `blackjack`), both built the same way: one
Cloudflare Worker + one Durable Object instance per room, the WebSocket
Hibernation API, and a plain-JS frontend with no build step. Reusing that
architecture for a third game means the same deploy story, the same local
dev experience (`node dev/local-server.mjs`, no Cloudflare account
needed), the same testing pattern, and - practically - the same Cloudflare
account and domain (`deeley.org`) already wired up for custom domains.
Introducing a whole second stack (a long-lived Node process, Socket.IO, a
database) for one more game would be exactly the kind of unnecessary
replacement the request warned against. Every "production safeguard" the
prompt asked for (server-authoritative state, validated input, rate limits,
no client-trusted randomness) is satisfied the same way the other two
games already satisfy it - just with Durable Object storage standing in
for "a database."

## No per-turn countdown clock

Blackjack has betting and turn clocks because a real table has to keep
pace for everyone else waiting to act. Yahtzee doesn't have that pressure
in the same way, and the request's own feature list never mentions a
timer - only a "reasonable reconnection window" for someone who drops.
Adding a forced-timeout system invites a harder design question a solo
dice game doesn't actually have: what do you *do* on timeout? Auto-stand
has an obvious meaning in blackjack; there's no equally obvious "safe
default" scoring choice to force on someone in Yahtzee. So this build just
waits - if it's your turn and you've stepped away, the game waits for you,
exactly like a real table would, and everyone else sees you marked away in
the meantime. The Durable Object's alarm only exists for idle-room cleanup
(12 hours), not a turn clock.

## No "Joker" bonus-Yahtzee rule

Real Yahtzee has an optional house rule: rolling a *second* Yahtzee scores
a 100-point bonus and lets that roll act as a "joker" substitute for
whatever category you choose. The request's own scoring section only
specifies "Yahtzee: 50 points" with no mention of a bonus or a joker, so
implementing the joker rule would be inventing a whole extra rule surface
(and a genuinely tricky one - the joker rule changes which categories are
even legal to pick) that wasn't asked for. `scoreCategory('yahtzee', dice)`
always returns 50 for five matching dice and 0 otherwise; a second Yahtzee
is just another 0 if that category's already used, same as burning any
other repeat.

## Every category is always available to burn for 0

A category that doesn't match still shows up as scoreable - tapping
"Yahtzee" on a random roll asks "Score 0 points in Yahtzee?" and locks it
in. This is standard Yahtzee (you always have exactly 13 turns and 13
categories; if nothing fits, you have to burn something), and it made the
validation simpler too: the server doesn't need a notion of "categories
that don't apply right now" versus "categories that are used" - just used
or not.

## "Again" and "Return to Lobby" don't require everyone to agree

The request describes Play Again as something that starts "if everyone
chooses Play Again." Tracking per-player readiness (and a lobby-style
"2/3 ready" UI while the group decides) is a reasonable feature but it's
extra state and extra UI for a fairly small payoff, and Draw Together
(this repo's other round-based game) already made the simpler call: any
player can restart for the whole table. Roll follows that same precedent -
`again` and `lobby` both work the instant one player sends them, with no
confirmation step, matching how casually people actually re-rack a
physical dice game at the table.

## Color picker only at Create - joiners get an available color automatically

The request's mockups show "Choose your color (optional)" only in the
Create Game flow, not in Join. Rather than second-guess that and build a
second color picker, a joining player's `hello` can optionally request a
color (validated against the same fixed 6-color list, honored only if it
isn't already taken), and if they don't send one - which the Join screen
never does - the server just hands them the next free color. This means
every player ends up with a distinct color either way, without inventing
UI the request didn't ask for.

## Host powers end where the game starts

The host can start the game and remove a player from the lobby; a
dedicated "cancel the room" action was left out because the host leaving
already accomplishes it (the room just continues with whoever's left, or
sits empty until the 12-hour cleanup). Once `start` fires, the host has no
special powers over dice, turns, or scores - enforced the same way
Blackjack does it, by simply never checking "am I the host" in any
in-game handler.

## One broadcast state for everyone, not a per-viewer view

Draw Together hides the secret word from everyone but the drawer;
Blackjack hides the dealer's hole card from everyone until the reveal.
Yahtzee has no equivalent secret at all - every die, every hold, and every
player's whole scorecard is information a real onlooker at the table
already has. So `view()` takes no per-player branch except which seat is
`you`, the same simplification Blackjack made for the same reason.

## `preview` scores are computed server-side, not duplicated in the client

The confirm dialog needs to show "Score 30 points in Small Straight?"
*before* the player commits. Rather than ship the scoring math to the
browser (risking it drift from the server's own copy, and technically
letting a modified client lie about what a roll is worth even though the
server would still reject an inflated claim), the server includes a
`preview` object in every state broadcast - what each of the 13 categories
would score *right now* - computed from the same `scoreCategory()` the
`score` handler itself uses to validate. The client never imports
`scoring.js` at all; it only reads numbers the server already computed.

## Routing: real paths, not a `#hash`

The request explicitly wants `/game/K7PX` to be a real, shareable,
openable URL. Draw Together and Blackjack both use `location.hash`
instead, which is simpler but doesn't satisfy "opening that URL should let
another player immediately join" in the way a plain link does (a hash
never reaches the server, and some link-preview / messaging-app link
handling treats hash fragments differently). Roll uses real paths instead:
`wrangler.jsonc` sets `not_found_handling: "single-page-application"` so
any path that isn't a real static file - `/create`, `/join`, `/game/K7PX`
- falls back to `index.html`, with `run_worker_first: ["/api/*"]` making
sure that fallback never swallows the actual API routes. `dev/local-server.mjs`
mirrors the same fallback by hand for local development (see its HTTP
handler), since it re-implements the Workers runtime itself rather than
using wrangler's asset serving.

## A real bug the tests caught: `padding: 14%` on a die

Every die's CSS set `padding: 14%` intending "14% of the die's own size" as
a comfortable inner margin for the pips. CSS percentage padding is defined
relative to the *containing block's width*, never the padded element's own
size - and a die's containing block here is the whole game screen, many
times wider than a 60-80px die. At a 420px-wide phone screen that resolved
to roughly 56px of padding *per side* on a die only ~67px wide -
`box-sizing: border-box` can't shrink the content box below zero, so the
browser was forced to grow the whole die to over 100px just to fit the
padding it had been given, blowing the layout out past the edges of the
screen. This rendered as dice with **no visible pips at all**, and was
caught by comparing a Playwright screenshot (blank white squares, no dots)
against the die's actual `getComputedStyle().width`, which read over
100px where the layout expected roughly 70px. Fixed by using a fixed,
`clamp()`-based padding instead of a percentage, so it can never depend on
anything other than the viewport width the `clamp()` itself already
accounts for.

## No image assets - dice are drawn, not photographed

Every die is a plain white rounded square with pip dots placed on a 3x3
CSS grid by rank (the same six classic dice-face patterns everyone
learns as a kid), the same "everything is code, no binary assets"
approach the rest of this repo takes for its generative pieces and its
other two multiplayer games' cards/felt.

## Testing: in-process forced-dice harness + real-wire adaptive play

Same split as Blackjack, for the same reason: dice are genuinely random
over the real wire (there's no debug backdoor to force a specific roll in
production, on purpose - that would be a real fairness risk if it ever
leaked), so `dev/unit-tests.mjs` uses two different mechanisms. An
in-process `makeHolder(RollRoom)` harness constructs a real Durable Object
with no real sockets or timers, letting a test reach directly into
`room.dice` to force whatever face values a scenario needs (every one of
the 13 categories is checked this way, cross-referenced against the pure
`scoring.js` functions, along with the upper bonus threshold, turn-order
adjustments on leaving mid-game, kicking, and reconnection). The real
spawned-server tests, and the Playwright browser test, play adaptively
instead - always scoring into the first still-open category - and assert
what has to be true regardless of what was actually rolled: both clients
see identical dice, a held die's value survives a re-roll, the game
reaches a genuine winner, and the state a returning player sees after
reconnecting matches what everyone else already has.
