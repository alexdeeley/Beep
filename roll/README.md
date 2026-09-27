# Roll

Real-time multiplayer Yahtzee-style dice. 2-6 players, private rooms with a
short game code, everyone sees the same five dice update live as the current
player rolls, holds, and scores. No accounts, just a code.

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

## Testing

```bash
npm test                                   # scoring engine + full room protocol (122 checks)
node dev/browser-test.mjs                  # two real browsers play a full game (needs Playwright + Chromium)
```

The scoring engine (`src/scoring.js`) is pure and dependency-free, so every
category is checked directly against hand-picked dice. The room protocol is
checked two ways: an in-process Durable Object harness (`dev/emulate.mjs`)
that can force the room's dice to an exact value the way no real client
ever could, for deterministic scoring/turn-order scenarios, and a real
spawned server + real WebSocket clients for the wire protocol itself
(lobby sync, reconnection, disconnect presence). The browser test plays
against genuinely random dice - there's no debug backdoor for that over
the wire on purpose - so it scores adaptively (whatever's first unfilled)
and asserts the things that have to be true regardless of what was
actually rolled: both clients see identical dice, a held die's value
survives a re-roll, the game reaches a real winner, and reconnecting
restores the same seat and scorecard.

## Deployment (Cloudflare Workers + Durable Objects → roll.deeley.org)

```bash
npm install
npx wrangler login
npx wrangler deploy
```

Uses the same architecture as this repo's other two multiplayer games
(`draw-together`, `blackjack`) rather than a separate Node/Socket.IO stack -
see DECISIONS.md for why.

## Project layout

```
src/worker.js        HTTP routes, room creation, WebSocket hand-off
src/roll-room.js      RollRoom Durable Object: turns, dice, scoring, reconnection
src/scoring.js        Yahtzee scoring engine + dice rolling (pure, no game state)
public/index.html     All screens and overlays
public/styles.css     Bold arcade look, CSS-drawn dice (no image assets)
public/js/shared.js   Constants shared by browser and server (categories, limits, colors)
public/js/app.js      Screens, dice animation, scorecard, routing
public/js/net.js      WebSocket client with reconnect + heartbeat
public/js/sound.js    Procedural sound effects + mute
public/js/a11y.js     Invert-colors accessibility toggle
dev/                  Local server emulator, DO-emulation harness, and tests
```

## How it works

**Rooms.** `POST /api/rooms` makes a code like `DICE9` (a dice-themed word +
a digit 2-9, no confusable letters). `GET /api/rooms/:code` says whether it
exists, is full, or has already started. `/api/rooms/:code/ws` upgrades to
a WebSocket owned by that room's Durable Object. Idle rooms clean
themselves up after 12 hours.

**The server is the dealer.** Every die face is generated server-side with
`crypto.getRandomValues` - never client-seeded, never client-supplied. The
server validates every action: whose turn it is, how many rolls are left,
whether a category is already used. A client can request a roll, a hold, or
a category; it can never state a result.

**No hidden information.** Unlike Draw Together (a secret word) or
Blackjack (a hidden hole card), Yahtzee has nothing to hide once the dice
are rolled - every player's dice, holds, and full scorecard are public. So
the server broadcasts one shared state to everyone (only `you` differs),
including a `preview` of what each category would score right now, so the
client never has to duplicate the scoring math itself.

**Routes.** Clean client-side paths - `/`, `/create`, `/join`,
`/game/CODE` - work as real URLs (not a `#hash`), backed by
`not_found_handling: "single-page-application"` in `wrangler.jsonc` (and
mirrored locally in `dev/local-server.mjs`) so opening `/game/CODE`
directly serves the app and lets a friend join straight from a shared link.

**Reconnection.** Each player holds a secret token in `sessionStorage`; the
last game is also kept in `localStorage` for a "Rejoin" button on the home
screen. Coming back restores your seat and scorecard, and never creates a
duplicate player. If the token is lost, a player can reclaim their seat by
typing the same name while disconnected.

## Rules implemented

- 2-6 players, one shared table, turn order fixed at start (join order).
- 3 rolls per turn, hold any die between rolls to keep its value.
- Score into any of the 13 categories once you've rolled at least once -
  including "scratching" a non-matching category for 0, same as a real
  scorecard.
- Standard scoring: upper section (Ones-Sixes) sums matching dice; Three/
  Four of a Kind sum all dice if at least 3/4 match; Full House 25; Small
  Straight 30; Large Straight 40; Yahtzee 50; Chance sums everything.
- Upper section bonus: +35 once Ones-Sixes total 63 or more.
- Highest total after everyone fills all 13 categories wins (ties share the
  win).

**Deliberately not implemented** (documented, not forgotten - see
DECISIONS.md): the "Joker" bonus-Yahtzee house rule, a per-turn countdown
clock, and a "wait for everyone to agree" Play Again.

## Protocol

Client → server (JSON):

| type | fields | who |
|---|---|---|
| `hello` | `playerId` (secret token), `name`, `color?` | anyone joining or reconnecting |
| `start` | | host, in the lobby, 2+ players |
| `roll` | | whoever's turn it is, up to 3 times |
| `hold` | `i` (0-4) | whoever's turn it is, after rolling at least once |
| `score` | `id` (a category id) | whoever's turn it is, after rolling at least once |
| `again` | | anyone, once the game is finished |
| `lobby` | | anyone, once the game is finished |
| `kick` | `seat` | host, in the lobby only |
| `leave` | | anyone, anytime |

Server → client: one shared `state` for everyone (only `you` differs),
`event` (`joined`, `back`, `left`, `kicked`), and `error` (`notfound`,
`full`, `started`, `kicked`, `replaced`).

## Accessibility

Large touch targets throughout, full keyboard support (dice and scorecard
rows are real focusable, Enter/Space-operable controls with visible focus
rings), a mute button and an invert-colors toggle (same pattern as the
other two games), screen-reader labels on every die stating its face and
held state (never color-only), and `prefers-reduced-motion` skips the
dice-shake animation while keeping the sound cue so the roll is still
confirmed.

## QA checklist (on real devices)

1. Create on one device, share the code (or the `/game/CODE` link); a
   friend joining sees the lobby update immediately.
2. A bad code shows a friendly message; a full room says so; a started
   game says so.
3. Only the host sees a Start button; starting needs 2+ players.
4. Rolling shows a brief shake before settling; both devices see the exact
   same final faces.
5. Holding a die gives it an obvious raised/glowing state and a "HELD"
   label, not just a color change; tapping again releases it.
6. A held die's value survives every later roll in the same turn.
7. After 3 rolls, no further roll is possible - only scoring.
8. Every unused category glows and shows the score it would earn right
   now; scoring one asks for confirmation, then locks it in and passes the
   turn.
9. The upper section bonus (+35) appears the moment Ones-Sixes reach 63.
10. Disconnecting shows "away" to everyone else; reconnecting (same
    device or a fresh tab with the rejoin button) restores the same seat
    without duplicating the player.
11. Game over shows a trophy, the winner's name and points, and the full
    score breakdown for every player - not just the winner.
12. Play Again starts a fresh round with the same players; New Game leaves
    entirely; Return to Lobby resets to the lobby screen.
13. Mute silences every sound; invert-colors flips the whole page and is
    remembered across reload.
14. Keyboard-only: Tab reaches every die and every scorecard row; Enter/
    Space activates them; focus is always visible.
