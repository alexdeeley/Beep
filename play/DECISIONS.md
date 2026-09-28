# Decisions

## Why one Durable Object per room, again

Same reasoning as Draw Together, Blackjack, and Roll before it: a room
needs one authoritative owner for its state, cheap idle cost, and
WebSocket fan-out without a separate pub/sub layer. A Durable Object gives
all three for free. This project's spec explicitly asked to reuse existing
infrastructure rather than inventing a parallel Node/Socket.IO stack, and
there was no reason not to - the pattern already handles reconnection,
hibernation, and alarms cleanly.

## The one interface every game shares

`src/games/<id>.js` exports exactly six functions:

```
createState(seats, rand)                       -> state
handleAction(state, seat, action, now, rand)    -> mutates state
tick(state, now, rand)                          -> mutates state (time-driven progress)
isOver(state)                                   -> bool
getResult(state)                                -> { tiers: [[seat,...], ...], note }
view(state)                                     -> state with any secret fields stripped
nextAlarmAt(state)                              -> timestamp | null
```

`MatchRoom` (the Durable Object) only ever calls through this interface -
it has no `if (gameId === 'big-blast')` anywhere. That's what makes adding
game #6 a matter of writing one file and one registry line rather than
touching the room's state machine (see README.md).

`rand` is always passed in by the caller - a game module never calls
`Math.random()` itself. `MatchRoom` passes the real `Math.random` in
production; tests pass a forced sequence instead. This is what makes every
game's logic testable without a wire-level "force an outcome" backdoor
(which would itself be a way for a malicious client to manipulate a
supposedly-authoritative outcome - better to just not have the door).

## "Tiers", not a single elimination order

`getResult()` returns `{ tiers, note }` where `tiers` is best-to-worst
ranked groups of seats, e.g. `[[3], [1, 2]]` (seat 3 won outright; 1 and 2
tied for the round). This one shape covers every game's actual outcome
shape without forcing a fake total order:

- Turn-based single elimination (Big Blast, Hot Potato): each tier after
  the first is a single seat, oldest-eliminated last.
- Simultaneous multi-elimination (Color Panic, Don't Touch the Rope): a
  tier can hold several seats who were wrong at the same instant.
- "Everyone but one" (Wobbly Tower): exactly two tiers, `[survivors, [who
  brought it down]]`.

`pointsForTier(tierIdx, totalPlayers)` in `match-room.js` reads this
uniformly: tier 0 always scores `POINTS_FIRST` (3); tier 1 scores
`POINTS_SECOND` (1) only when there were more than 2 players, matching the
spec's explicit "for two-player games the loser gets 0" rule rather than
a generic "second place" point that wouldn't make sense with only one
loser.

## Dramatic delay is a client-side courtesy, not a secret

The Big Blast is the only game with anything actually hidden from clients
(which button is dangerous - stripped in `view()`). But the spec also asks
for suspense on *every* reveal: a pause before "SAFE"/"BOOM", before a rope
resolves, before a tower topples. For every game except Big Blast, the
true outcome is already sitting in the state the client receives the
instant the action lands - there's nothing left to hide. The renderers
(`public/js/games/*.js`) deliberately withhold *showing* that outcome for
a beat anyway, timed against the server's own reveal/impact/collapse
timestamp (`revealAt`, `impactAt`, `collapseAt`), so every client's
suspense lines up with the same real moment rather than an arbitrary local
delay. This is presentation, not security - the server was already correct
the moment the action was handled; the client just chooses when to say so.

## Wobbly Tower's "physics" is a deterministic score, not a simulation

The spec's own fallback suggestion for a physics-flavored game that must
stay in sync: calculate authoritative physics on the server, never let
each browser simulate its own slightly-different result. Rather than
bring in an actual physics engine for one mini-game, `wobbly-tower.js`
tracks a single `instability` number that grows with how off-center each
placement was, and rolls a collapse chance derived from it using the
server's own `rand`. Every client sees the identical number and the
identical roll outcome; the "wobble" and "toppling" the player sees are
purely a CSS animation reacting to that number, not a rendering of any
simulated positions. It's honest about not being real physics, and it's
exactly as sync-safe as real server-side physics would be, for a fraction
of the code.

## Leaving mid-round: one generic patch, not five bespoke handlers

`removeFromActiveGame(seat)` in `match-room.js` pulls a departed seat out
of `gameState.seats` (every game names its live-player array this,
by convention) and, if that game happens to also track a `turnIdx` or
`holder` field pointing at a seat, patches those too - by field name, not
by game id. This is a deliberate scope-limiting simplification: it covers
every game correctly today because every game's fields happen to follow
that naming convention, but it means a future game with, say, a *list* of
current turn-takers rather than a single `holder` would need either a
naming tweak or its own handler. Five bespoke leave handlers would be more
correct in the limit and more code for a case (a player quitting mid
mini-game, in a match that's already forfeiting them) that doesn't need
five different flavors of "and now patch the game state."

## Two real bugs this build caught before shipping

**The alarm handler could resolve a round and never tell anyone.**
`MatchRoom.alarm()` had a branch for `status === 'playing'` that called
`afterGameUpdate()` - which mutates `room` and can flip `status` all the
way to `'result'` - but never called `this.save()` or
`this.broadcastState()` afterward (unlike every other branch in that
function). Any round that finishes purely because a timer expired - a Hot
Potato fuse, a Big Blast reveal pause, a Color Panic round nobody answered
in time - rather than because of a player's own `gameAction`, would
resolve correctly in memory and then sit there silently: no client ever
found out, and since the game had already moved past any phase with a
pending alarm, no future alarm would fire to retry either. This surfaced
immediately once real games were played end-to-end with two bots (it
looked exactly like a hung game), and is now a permanent regression test
in `dev/unit-tests.mjs` ("a round that resolves purely on a timer still
advances the room to result" / "...is actually broadcast to clients, not
just mutated in memory") - forcing a game one action from ending, letting
the pause elapse, and calling `alarm()` directly with no further client
input.

**A test bot that keeps re-deciding isn't testing independent choice.**
Both this project's manual smoke-testing script and the first draft of
`dev/browser-test.mjs`'s automated bots drove Don't Touch the Rope by
re-evaluating "should I jump?" on every poll tick until the bot's own
`action[seat]` was set server-side. Since only *jumping* locks a decision
in (staying still is just silently not sending anything), a bot got many
independent chances per pass to eventually land on "jump" but only one
chance to land on "don't" - which meant two such bots almost always ended
up making the *same* choice as each other, and since the game only
eliminates someone when players' choices actually differ from what the
rope demands, two synchronized bots playing "perfectly" (or synchronizedly
wrong, triggering a mutual reprieve either way) never resolves at all. The
fix in both scripts was to have each bot decide exactly once per
(round, pass) and cache that decision - matching how an actual player
plays: you decide once, you don't keep re-rolling your own intention every
120ms until you like the answer. Worth recording here because it reads
like a hung game or an infinite-loop product bug, and isn't - the actual
`rope.js` module already has correct, tested reprieve-on-mutual-failure
logic (see `dev/unit-tests.mjs`).

## Local stats on the home screen are honest about what they are

The spec's homepage sketch mentions "RECENT GAMES / PLAYERS / WINS." There
is no account system and, per the spec, no faking multiplayer state with
localStorage - so these three numbers are explicitly a *personal* history
kept in the browser doing the looking (`play.stats` in `localStorage`):
matches played, distinct opponent names seen, matches won. They reset if
you clear site data or open a different browser, and they're never
presented as a global leaderboard.
