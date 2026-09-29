# Play

A persistent multiplayer mini-game platform. 2-4 players in a room with a
short code play a fast round of the current mini-game, see who won, and get
auto-launched straight into the next one - five rounds, then a match
winner. No accounts, no lobby micromanagement, no dead time between rounds.
All original visual identity and game content - nothing here is modeled
on, or references, any existing game's characters, art, sounds, or names.

Deliberately launching with a single game rather than several at once -
see DECISIONS.md for why - with the architecture already built to add
more later at no cost to the room/scoring/reconnection machinery.

## The game

- **The Last Strand** - a weight hangs from 8 rope strands. Players take
  turns cutting one strand at a time; every cut frays the rope further, and
  the server rolls an escalating chance that *this* cut is the one that
  brings it down. Whoever cuts the fatal strand is eliminated and the rope
  resets fresh for whoever's left, until one player remains. Pure luck -
  nothing is hidden or skill-based, and nothing is secret even from a
  curious client (see `view()` in `src/games/last-strand.js`): the danger
  is a live roll at the moment of the cut, not a static fact to guess at.

Winner of a round scores 3 points; in a 3-4 player round the
second-to-last-eliminated tier scores 1 more. First to the end of 5 rounds
with the most points wins the match.

## Shared high scores

One leaderboard, shared across every room and every game (`src/leaderboard.js`,
a second Durable Object alongside `MatchRoom`). When a match ends, each
player's final score is checked against the board; anyone who qualifies
gets an "ADD ME" name-entry prompt right there on the match-over screen. A
score never travels from client to leaderboard directly - only `MatchRoom`
itself (which computed it) submits it, and only after independently
re-confirming eligibility server-side; the client only ever supplies the
name. See it any time at `/leaderboard`, reachable from the home screen's
"HIGH SCORES" button - no room or match needed to view it.

## Run it locally

```bash
npm install
npm run dev:local    # node dev/local-server.mjs → http://localhost:8787, no Cloudflare account needed
```

With Wrangler (closest to production):

```bash
npm install
npm run dev          # wrangler dev → http://localhost:8787
```

No environment variables are required to run or deploy this project - the
Durable Object binding and Workers Static Assets config live entirely in
`wrangler.jsonc`.

## Testing

```bash
npm test                      # the game module + the full room protocol + the leaderboard (75 checks)
node dev/browser-test.mjs     # two real browsers play a full match end to end, including submitting a high score (needs Playwright + Chromium)
```

`src/games/last-strand.js` is pure and takes its random source as a
parameter, so every scenario - a safe cut, an instability-forced collapse,
the guaranteed collapse on the literal last strand, a full multi-round run
to a champion - is checked with a forced, non-random `rand()` rather than
hoping a real roll lands the right way. The room protocol
(`src/match-room.js`) is checked with an in-process Durable Object harness
that can force `room`/`gameState` directly (`dev/emulate.mjs`), plus a real
spawned server and real WebSocket clients for the wire protocol itself
(auto-start, reconnection, kicking, scoring, leaving mid-round). The
browser test drives two real Chromium tabs through create → join → ready
→ a full 5-round match of The Last Strand → match over → play again → a
page reload mid-lobby, and fails on any console/page error.

## Deployment (Cloudflare Workers + Durable Objects → play.deeley.org)

```bash
npm install
npx wrangler login
npx wrangler deploy
```

Uses the same architecture as this repo's other multiplayer games
(Draw Together, Blackjack, Roll): one Durable Object instance per room,
the WebSocket Hibernation API so idle rooms don't hold memory, and
Workers Static Assets with SPA fallback so a client-side route like
`/room/PLAY5` still serves `index.html`.

## Adding a second game

1. `src/games/<id>.js` - the rules, matching the shared interface every
   game already implements: `createState(seats, rand)`, `handleAction(state, seat, action, now, rand)`,
   `tick(state, now, rand)`, `isOver(state)`, `getResult(state) -> { tiers, note }`,
   `view(state)`, `nextAlarmAt(state)`. See any existing file for the shape
   and DECISIONS.md for what each hook is for.
2. `public/js/games/<id>.js` - the client renderer: `mount(el, ctx) -> { update(gameState, serverNow), destroy() }`.
   `_util.js` in that folder has the shared shake/particle/avatar helpers.
3. Register it in both `src/games/index.js` and the matching
   `public/js/games/index.js`.
4. Add one entry to `GAME_REGISTRY` in `public/js/shared.js` (id, name,
   category, min/max players).

`MatchRoom` (the Durable Object) never references a specific game by name -
it only calls the six functions above through the registry - so this is
the entire change. No multiplayer, scoring, or round-flow code needs to
change at all.

## Architecture

See DECISIONS.md for the full reasoning. In short: `MatchRoom` is the sole
source of truth for every room - seats, scores, whose turn it is, and every
timer. There's no hidden state to withhold from clients at all right now -
The Last Strand's `view()` is the identity function, since its danger is a
live roll, not a fact to guess at (a future skill-based game could
reintroduce a secret the same way The Big Blast once did). Clients only ever send an
*intent* (`ready`, `gameAction`, ...) and receive the resulting state back;
nothing about a round's outcome is ever computed client-side. All timing
(fuses, deadlines, reveal pauses) is driven by the server's own clock and
delivered to clients as absolute timestamps (`deadlineAt`, `serverNow`),
never a client-local countdown, so a phone that's been asleep for ten
seconds still lands in the same place as everyone else's screen.

## Known limitations

- Rooms are wiped after 12 hours idle (no connected sockets). There's no
  match history beyond what's kept in each player's own browser
  (`localStorage`) for the home screen's personal stats row.
- A player who leaves mid-round is treated as an immediate forfeit via a
  generic field-patching fallback (`removeFromActiveGame`), not a
  bespoke per-game leave handler - see DECISIONS.md for why that's an
  intentional simplification, not an oversight.
- The Last Strand's "fraying rope" is a deterministic instability score
  plus a server-rolled collapse chance, not an actual physics simulation -
  see DECISIONS.md.
- Only one game exists at launch by design (see DECISIONS.md) - every
  match plays repeat rounds of The Last Strand rather than rotating
  between different games.
- Match length is fixed at 5 rounds for now; the constants for a longer
  "standard" length already exist in `public/js/shared.js` but aren't
  exposed as a lobby option yet.
