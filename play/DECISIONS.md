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
it has no `if (gameId === 'last-strand')` anywhere. That's what makes
adding game #2 a matter of writing one file and one registry line rather
than touching the room's state machine (see README.md) - the interface
was kept even after the pare-down to one launch game specifically so this
stays true.

`rand` is always passed in by the caller - a game module never calls
`Math.random()` itself. `MatchRoom` passes the real `Math.random` in
production; tests pass a forced sequence instead. This is what makes every
game's logic testable without a wire-level "force an outcome" backdoor
(which would itself be a way for a malicious client to manipulate a
supposedly-authoritative outcome - better to just not have the door).

## "Tiers", not a single elimination order

`getResult()` returns `{ tiers, note }` where `tiers` is best-to-worst
ranked groups of seats, e.g. `[[3], [1, 2]]` (seat 3 won outright; 1 and 2
tied for the round). This one shape covers any game's actual outcome shape
without forcing a fake total order - a turn-based repeated-elimination
game like The Last Strand produces one tier per elimination event
(`[champion], [most-recently-eliminated], ..., [first-eliminated]`), while
a simultaneous multi-elimination game could tie several seats in one tier.
Kept general on purpose even with only one game live today, since it's
what let the four now-deleted launch games (turn-based single elimination,
a passed-object fuse game, simultaneous reaction elimination, "everyone but
one") all share this same field without any game-specific result shape in
`match-room.js`.

`pointsForTier(tierIdx, totalPlayers)` in `match-room.js` reads this
uniformly: tier 0 always scores `POINTS_FIRST` (3); tier 1 scores
`POINTS_SECOND` (1) only when there were more than 2 players, matching the
spec's explicit "for two-player games the loser gets 0" rule rather than
a generic "second place" point that wouldn't make sense with only one
loser.

## Solo play: an optional per-game minimum, not a special "solo mode" flag

Requested after launch: "any game which can be done one player should have
the option." The room-level gate used to be a flat `MIN_PLAYERS = 2`
(`public/js/shared.js`); it's now `canStartWithCount(playerCount)`, which
just asks whether *any* registered game's own `minPlayers` covers the
current head count. A lone host in the lobby can ready up and start the
instant some game supports it - today that's The Last Strand
(`minPlayers: 1`); a future game that genuinely needs an opponent (a bluff,
a pass, a race) simply keeps `minPlayers: 2` and a lone player just waits,
exactly as before this feature existed. There's no platform-wide "solo
mode" toggle anywhere - it falls straight out of the existing per-game
`minPlayers`/`maxPlayers` metadata that `pickNextGame` already used to
filter compatible games.

The harder part wasn't the gate, it was **scoring**. "Eliminate everyone
else" has no meaning with nobody else at the table, and tier-0-always-3
would have given a solo player either a fixed 3 points forever (boring: no
feedback on how well they actually did) or 0 forever (the literal result of
running the existing tiers unchanged - see below - which would make solo
scoring look broken, not "not implemented yet"). Reusing the existing
`getResult()` shape unchanged would mean tier 0 (the "champion" tier) is
always empty for a lone player - by the time they collapse the rope
themselves, there's no one left in `state.seats` to call a survivor, so
`tiers = [[], [thatSeat]]` and every point scheme built on "who's in tier
0" gives them nothing, every round, forever.

So `getResult()` gained one more optional field: `score` (present only
when `state.solo`, set by `last-strand.js` to the number of strands
actually cut that attempt - free to compute, since `cutMask` already
tracks exactly that and a solo round never survives to a `freshRope()`
reset). `finishRound()` in `match-room.js` checks for it before falling
back to `pointsForTier`: one lone player with a `score` gets awarded that
number directly; anyone else still goes through the normal tiers ranking.
This keeps the six-function game-module interface exactly as general as
before - a game with nothing meaningful to say about "solo performance"
just never sets `state.solo` or returns `score`, and falls through to the
ordinary tiers path unchanged - while giving The Last Strand's solo
players a score that actually reflects how far they got, round to round,
match to match, and feeds the same shared leaderboard as everyone else.

## Dramatic delay is a client-side courtesy, not a secret

The Last Strand (like most of this platform's games, past and present) has
nothing actually hidden from clients - `view()` is the identity function,
because the danger is a genuine live roll at the moment of the cut, not a
static fact a client could infer or leak. The true outcome is already
sitting in the state the client receives the instant an action lands - but
the platform still wants suspense on every reveal, so the renderer
(`public/js/games/last-strand.js`) deliberately withholds *showing* the
collapse for a beat anyway, timed against the server's own `collapseAt`
timestamp, so every client's suspense lands on the same real moment rather
than an arbitrary local delay. This is presentation, not security - the
server was already correct the moment the action was handled; the client
just chooses when to say so. (One of this platform's four original launch
games, The Big Blast, did have a genuine secret field stripped in
`view()`; a future skill-or-bluffing-based game could bring that pattern
back.)

## The Last Strand's "fraying rope" is a deterministic score, not a simulation

Calculate authoritative physics-flavored state on the server, never let
each browser simulate its own slightly-different result. Rather than
bring in an actual physics engine, `last-strand.js` tracks a single
`instability` number that grows with every cut, and rolls a collapse
chance derived from it (`(instability/100)^1.5`, capped at 0.97) using the
server's own `rand` - with a guaranteed collapse forced regardless of the
roll if a cut ever leaves zero strands uncut, so a round can never stall
out at "instability high, nobody unlucky yet, out of strands." Every
client sees the identical number and the identical roll outcome; the
fraying, sway, and fall the player sees are purely CSS reacting to that
number and phase, not a rendering of any simulated rope physics. This is
the same technique the now-deleted Wobbly Tower used for its own
instability score - reused here because it had already proven itself
sync-safe and cheap.

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

## Paring down to one launch game

After the initial five-game build shipped, the user decided starting with
five games at once had been a mistake, and asked to pare the platform down
to a single game - to be expanded later - and for that one game to be an
up-to-four-player luck game in a "cut the rope" style, richly colored in
deep reds and oranges, with a cool rope theme, played over multiple
rounds.

Two choices worth recording:

- **Delete the other four games' files outright, don't just unregister
  them.** "Pare down" plus "expanded later" plus this repo's own practice
  elsewhere of not leaving dead code around made deletion the right call
  over disabling-in-place - git history keeps them fully recoverable if a
  future game wants to reuse or reference one, and nothing about the
  shared interface (`src/games/index.js` / `public/js/games/index.js` /
  `GAME_REGISTRY`) needed to change shape to go from five entries to one,
  which is exactly what "the room never special-cases a game id" was
  supposed to buy.
- **Not calling it "Cut the Rope."** That's a real, trademarked game
  (ZeptoLab), and this platform's standing rule from its original spec is
  no existing game's names, characters, art, or sounds - a rule that
  predates and outranks this specific request. The Last Strand keeps every
  bit of the requested theme (rope strands, cutting, a hanging weight, rich
  red/orange staging) as an original mechanic and name instead.

The mechanic itself is a deliberate hybrid of two patterns the deleted
games had already proven out, rather than something invented from
scratch: Wobbly Tower's rising-`instability`-drives-an-escalating-roll
technique (see above) supplies the "luck," and The Big Blast's
repeated-elimination-into-`eliminationOrder`-tiers structure (read in
reverse for `getResult()`) supplies the "down to one champion" shape. The
one genuine departure from both: nothing is hidden. Big Blast had one
fixed secret index for the whole round; The Last Strand's danger is a
fresh roll on every single cut, so there's no secret fact to strip in
`view()` at all - see "Dramatic delay" above.

Constants (8 strands, `instability` growing ~14-24 per cut, collapse
chance `(instability/100)^1.5` capped at 0.97) were tuned by running the
plain game logic through a few thousand simulated Node trials before
committing to them, rather than guessed: a 4-player game averages ~9-10
cuts to a champion (range 4-17), a 2-player game ~3 cuts (range 1-7) -
short enough to keep a 5-round match brisk, long enough that a round
rarely resolves on the very first or second cut.

## Two real bugs this build caught before shipping

(Both predate the pare-down to one launch game described above and mention
some of the four now-deleted games by name - kept as-is since the bugs,
fixes, and regression tests are still exactly as real and still exactly
what's under test today, just against The Last Strand instead.)

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

## The shared leaderboard never trusts the client for the one thing that matters: the score

Added after the initial build, at the user's request, as a single
high-score board shared across every game in the platform rather than one
per game (there were five at the time; there's one now, with more planned)
- the natural shared metric already sitting in every room is the match's
final score, so that's what it tracks (a per-game metric would have meant
inventing a different, not-really-comparable number for each game, most
of which don't otherwise produce one).

The temptation with a feature like this is a simple public `POST
/api/leaderboard {name, score}` - and that would reintroduce exactly the
hole the rest of this platform was built to avoid: a client could submit
any score it likes with a raw HTTP request, no gameplay required. Instead
`Leaderboard` (`src/leaderboard.js`) is a second Durable Object with *no
public write route at all* - `worker.js` only ever proxies `GET
/api/leaderboard` (read-only). The only way a score reaches it is
`MatchRoom` calling it directly, Durable-Object-to-Durable-Object, at the
exact moment it has already computed that score itself
(`refreshLeaderboard()`, called from `finishMatch()`). A client's
`submitHighScore` message carries a name and nothing else; `MatchRoom`
looks up the player's own already-authoritative `score` field and sends
that, never anything from the message. `Leaderboard.submit()` still
independently re-checks eligibility itself (not just trusting
`MatchRoom`'s earlier `check()` call), since a match can run long enough
for the board to change between the two.

The one place this shows up as extra ceremony: `finishMatch()`,
`advanceAfterResult()`, and `alarm()`'s `result`-phase branch all had to
become `async` to await that cross-Durable-Object call, where they were
synchronous before.

## Local stats on the home screen are honest about what they are

The spec's homepage sketch mentions "RECENT GAMES / PLAYERS / WINS." There
is no account system and, per the spec, no faking multiplayer state with
localStorage - so these three numbers are explicitly a *personal* history
kept in the browser doing the looking (`play.stats` in `localStorage`):
matches played, distinct opponent names seen, matches won. They reset if
you clear site data or open a different browser, and they're never
presented as a global leaderboard.
