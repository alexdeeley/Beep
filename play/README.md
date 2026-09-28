# Play

A persistent multiplayer mini-game platform. 2-4 players in a room with a
short code play a fast round of a randomly-picked mini-game, see who won,
and get auto-launched straight into the next one - five rounds, then a
match winner. No accounts, no lobby micromanagement, no dead time between
rounds. All original visual identity and game content - nothing here is
modeled on, or references, any existing game's characters, art, sounds, or
names.

## The five games

- **The Big Blast** - six buttons, one is secretly dangerous. Players take
  turns picking until one remains.
- **Hot Potato** - a bomb passed by tapping another player, against a
  randomized (never-memorizable) fuse.
- **Color Panic** - a target color flashes; tap it before the shrinking
  deadline. Wrong or too slow, you're out.
- **Don't Touch the Rope** - a rope sweeps in, low or high, on a shrinking,
  jittered schedule. Jump it or stay still - guess wrong, you're out.
- **Wobbly Tower** - turn-based block placement on an ever more unstable
  tower. Whoever's placement brings it down loses the round.

Winner of a round scores 3 points; in a 3-4 player round the
second-to-last-eliminated tier scores 1 more. First to the end of 5 rounds
with the most points wins the match.

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
npm test                      # every game module + the full room protocol (68 checks)
node dev/browser-test.mjs     # two real browsers play a full match end to end (needs Playwright + Chromium)
```

Each of the 5 game rule modules (`src/games/*.js`) is pure and takes its
random source as a parameter, so every scenario - who gets the dangerous
button, whether the rope is low or high, an unlucky tower collapse - is
checked with a forced, non-random `rand()` rather than hoping a real roll
lands the right way. The room protocol (`src/match-room.js`) is checked
with an in-process Durable Object harness that can force `room`/`gameState`
directly (`dev/emulate.mjs`), plus a real spawned server and real
WebSocket clients for the wire protocol itself (auto-start, reconnection,
kicking, scoring, leaving mid-round). The browser test drives two real
Chromium tabs through create → join → ready → a full 5-round match with
whatever games get randomly picked → match over → play again → a page
reload mid-lobby, and fails on any console/page error.

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

## Adding a sixth game

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
source of truth for every room - seats, scores, whose turn it is, every
timer, and any hidden state (the one secret in this whole platform is
which button is dangerous in The Big Blast). Clients only ever send an
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
- Wobbly Tower's "physics" is a deterministic instability score plus a
  server-rolled collapse chance, not an actual physics simulation - see
  DECISIONS.md.
- Match length is fixed at 5 rounds for now; the constants for a longer
  "standard" length already exist in `public/js/shared.js` but aren't
  exposed as a lobby option yet.
