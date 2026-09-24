# DRAW TOGETHER

A drawing-and-guessing game for a grown-up and a small person, one phone or tablet each - and a room can now hold up to 16 players. One player draws a secret word, everyone else watches it appear live and guesses; the round ends for everyone the moment someone gets it right. Built on Cloudflare Workers + one Durable Object per room, with a plain-JavaScript frontend (no framework, no build step).

## Deploy to Cloudflare

You need Node 18+ and a Cloudflare account (the free plan works; Durable Objects on the free plan must use SQLite storage, which this project already does).

```sh
npm install
npx wrangler login
npx wrangler deploy
```

Wrangler prints a `*.workers.dev` URL. That's the game.

**Custom domain (draw.deeley.org).** Either uncomment the `routes` block in `wrangler.jsonc` and deploy again:

```jsonc
"routes": [{ "pattern": "draw.deeley.org", "custom_domain": true }]
```

or in the Cloudflare dashboard go to Workers & Pages → draw-together → Settings → Domains & Routes → Add → Custom domain, and enter `draw.deeley.org`. The deeley.org zone must be on the same Cloudflare account.

## Run locally

With Wrangler (closest to production):

```sh
npm install
npm run dev          # wrangler dev → http://localhost:8787
```

Without installing anything (a small Node emulator of the Worker, Durable Object, storage, alarms and WebSockets):

```sh
npm run dev:local    # node dev/local-server.mjs → http://localhost:8787 (PORT=… to change)
```

To try it on a real phone, run either one and open `http://<your-computer's-LAN-IP>:8787` on the phone (for wrangler add `--ip 0.0.0.0`).

## Tests

```sh
npm test                                   # word bank, guess matching, full server protocol (≈1,600 checks)
node dev/browser-test.mjs                  # two real browsers play a full game (needs Playwright + Chromium)
```

The browser test pairs a 1180×820 tablet with a 390×844 touch phone, checks mid-stroke live sync, that both devices render the same picture at different sizes and pixel densities, eraser/undo/clear sync, reload reconstruction, that the secret word never appears in any frame the guesser receives, guessing and scoring, the reveal replay, disconnect/timer pause, landscape layouts, a full 10-round game and Play Again. Screenshots land in `/tmp/shots` (override with `SHOTS=`).

## Project layout

```
src/worker.js        HTTP routes, room creation, WebSocket hand-off
src/game-room.js     GameRoom Durable Object: all game rules, scoring, timer, secrecy
src/words.js         Word bank (~248 words) + guess matching
public/index.html    All screens and overlays
public/styles.css    Sticker-book look, portrait/landscape layouts, safe areas
public/js/shared.js  Constants shared by browser and server (tools, sizes, palette, options)
public/js/board.js   Canvas renderer (high-DPI, letterboxing, deterministic brushes, replay)
public/js/net.js     WebSocket client with reconnect + heartbeat
public/js/sound.js   Procedural sound effects + mute
public/js/app.js     Screens, input, game UI
dev/                 Local server emulator and test harnesses
```

## How it works

**Rooms.** `POST /api/rooms` makes a code like `CAT7` (short word + a digit 2–9, no confusable letters). `GET /api/rooms/:code` says whether it exists and is full. `/api/rooms/:code/ws` upgrades to a WebSocket owned by that room's Durable Object. Rooms clean themselves up after 12 hours idle.

**The server is the referee.** The word is picked on the server and sent only to the drawer's socket. Guesses are judged on the server; the guesser's browser never receives the word until the reveal. Every incoming message is validated (whose turn it is, tool, colour, size, point counts).

**Coordinates.** Everything is sent as integers 0–10000 on both axes. The drawer's screen shape is fixed when they press Ready (clamped between 0.55 and 1.8), and the guesser's board is letterboxed to match, so the picture looks the same on both devices. Brush sizes are in "board units" so a thick marker is equally thick on a phone and a tablet.

**Reconnection.** Each player holds a secret token in `sessionStorage`; the last room is also kept in `localStorage` for a "Rejoin" button. Coming back restores score, round, the whole drawing and the timer, and never creates a duplicate player. The timer pauses while either player is away. If the token is lost, a player can reclaim their empty seat by typing the same name.

**Storage.** Room state lives under the `room` key; each finished drawing operation is stored separately (`op:N`) so a round with lots of strokes never rewrites one huge value. The in-progress stroke is held in memory and streamed live.

**Hibernation.** Uses the WebSocket Hibernation API with a `ping`→`pong` auto-response, so idle rooms cost nothing while players are connected.

## Protocol

Client → server (JSON):

| type | fields | who |
|---|---|---|
| `hello` | `playerId` (secret token), `name` | anyone joining or reconnecting |
| `settings` | `settings: {timer, rounds, difficulty, categories}` | host, in lobby |
| `start` | | host, in lobby, 2+ players |
| `swap` | | drawer, while choosing (2 per round) |
| `ready` | `aspect` | drawer, while choosing |
| `strokeStart` | `id, tool, size, color, pts` | drawer |
| `strokePoints` | `id, pts` (flat `[x,y,x,y…]`, max 400 values) | drawer |
| `strokeEnd` | `id` | drawer |
| `undo` / `clear` | | drawer |
| `guess` | `text` (rate limited 1 per 350 ms) | guesser |
| `giveup` | | guesser, while drawing ("Show answer") |
| `next` / `again` / `lobby` / `leave` | | reveal / game over / anytime |

The spec's separate "erase" events are simply strokes with `tool: 'eraser'`, which keeps undo and live sync uniform.

Server → client: `state` (tailored per player; only the drawer's copy contains `word`), `board` (full operation list on join/reconnect), `strokeStart` / `strokePoints` / `strokeEnd` / `undo` / `clear` (live relay), `guess` (`result: correct | close | wrong`), `event` (`joined`, `back`, `left`), and `error` (`notfound`, `full`, `replaced`).

## Game rules

10 rounds by default (6 or 16 selectable), the drawer role rotates through every seat in join order. Timer 30 / 60 / 90 s or none. A correct guess scores 3 points, plus 2 if more than 40 s remain or 1 if more than 20 s remain. Guess matching ignores case, accents, punctuation, spacing and plurals, accepts listed alternatives ("kitty" for CAT), forgives one typo in words of 5+ letters and two in 9+, and says "So close!" for near misses.

## QA checklist (on real devices)

1. Create on one device, join by code on another; bad code shows a friendly message.
2. Rooms hold up to 16 players; a 17th device trying to join sees "That game is already full."
3. Strokes appear on the other device while still being drawn, not only on lift.
4. Every tool × size looks the same on both devices (crayon texture, dots and rainbow included).
5. Eraser works and syncs live; eraser has two sizes.
6. Undo removes the last mark on both devices; Clear asks first; Clear can be undone.
7. All 12 colours work, including white over other colours.
8. The guesser never sees the word before the reveal (check the Network tab → WS frames).
9. Wrong guesses show "Nope!", near misses "So close!", right guesses celebrate.
10. Timer counts down, ticks in the last 5 s, and ends the round at 0.
11. No-timer mode: "Show answer" ends the round.
12. Time bonus scores 5 / 4 / 3 as expected.
13. Lock one phone mid-round: the other shows "waiting", timer pauses, resumes on return.
14. Reload mid-drawing: picture, score, round and timer come back; no duplicate player.
15. Apple Pencil on iPad: smooth lines, palm resting on screen doesn't draw.
16. Finger drawing on iPhone: the page doesn't scroll, zoom or show the magnifier.
17. Rotate phone and tablet: layout adapts, drawing stays correctly placed.
18. iPhone notch / home bar: nothing important hidden under them.
19. Mute button silences everything and is remembered.
20. Game over → Play Again keeps the room; New Game goes home.
