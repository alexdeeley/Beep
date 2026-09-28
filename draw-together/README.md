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
src/words.js         Word bank (~300 words, plus ~3,000 opt-in Chaos-mode
                     scenario prompts) + guess matching + letter-count hint
public/index.html    All screens and overlays
public/gallery.html  Shareable gallery of a room's finished drawings
public/remix.html    Editor for adding to an already-finished drawing
public/styles.css    Sticker-book look, portrait/landscape layouts, safe areas
public/js/shared.js  Constants shared by browser and server (tools, sizes, palette, options)
public/js/board.js   Canvas renderer (high-DPI, letterboxing, deterministic brushes, replay)
public/js/net.js     WebSocket client with reconnect + heartbeat
public/js/sound.js   Procedural sound effects + mute
public/js/app.js     Screens, input, game UI
public/js/gallery.js Fetches and renders a room's gallery, PNG export, share + QR code, the Mine/All filter
public/js/remix.js   Loads one gallery entry, lets you draw more on top, saves it as a new entry
dev/                 Local server emulator and test harnesses
```

## How it works

**Rooms.** `POST /api/rooms` makes a code like `CAT7` (short word + a digit 2–9, no confusable letters). `GET /api/rooms/:code` says whether it exists and is full. `/api/rooms/:code/ws` upgrades to a WebSocket owned by that room's Durable Object. `GET /api/rooms/:code/gallery` returns the finished drawings for the gallery page. `POST /api/rooms/:code/remix` submits a remix - see "Remix" above - and is the only other way a drawing ever reaches storage; there's no way to write to a room over plain HTTP that skips validation. Rooms clean themselves up after 12 hours idle.

**The server is the referee.** The word is picked on the server and sent only to the drawer's socket. Guesses are judged on the server; the guesser's browser never receives the word until the reveal. Every incoming message is validated (whose turn it is, tool, colour, size, point counts).

**Coordinates.** Everything is sent as integers 0–10000 on both axes. The drawer's screen shape is fixed when they press Ready (clamped between 0.55 and 1.8), and the guesser's board is letterboxed to match, so the picture looks the same on both devices. Brush sizes are in "board units" so a thick marker is equally thick on a phone and a tablet.

**Reconnection.** Each player holds a secret token in `sessionStorage`; the last room is also kept in `localStorage` for a "Rejoin" button. Coming back restores score, round, the whole drawing and the timer, and never creates a duplicate player. The timer pauses while either player is away. If the token is lost, a player can reclaim their empty seat by typing the same name.

**Storage.** Room state lives under the `room` key; each finished drawing operation is stored separately (`op:N`, an ever-increasing key across the whole game) so a round with lots of strokes never rewrites one huge value. The in-progress stroke is held in memory and streamed live. A finished round's ops are archived into `room.gallery` (word, artist, aspect, and which `op:N` keys are theirs) rather than deleted, so the gallery can replay them later; they're only actually deleted from storage if a round is abandoned mid-drawing (someone leaves before it ends) or when the room itself expires.

**Hibernation.** Uses the WebSocket Hibernation API with a `ping`→`pong` auto-response, so idle rooms cost nothing while players are connected.

**Invert colors (accessibility).** A per-device toggle (home screen, in-game HUD, and the gallery page) that inverts the whole page - `filter: invert(1) hue-rotate(180deg)` on `<html>` - for light sensitivity or low vision, while the drawing itself stays true to its real colors: the `.sheet` canvases and the color/tool pickers get the exact same filter applied a second time, which cancels out precisely (invert-of-invert is the original, pixel for pixel). So if one player draws a yellow sun, it looks yellow on every screen watching, whether or not that screen has inverted colors on. Persisted in `localStorage` (`public/js/a11y.js`), same pattern as the mute button.

**Sound as an accessibility feature, not decoration.** Background music (`public/js/music.js`) plays everywhere in the app - the home screen and lobby included, not just mid-game - as a two-track playlist that alternates forever (track A through, then B, then back to A). It pauses on the game-over screen so a finished game ends on its chime instead of the music running under it forever, and picks the same track back up (not a restart) once the next round actually begins. Every button, chip, and color swatch anywhere in the app gets a clear, deliberately prominent tap sound on press, so an interaction is always confirmed audibly, not just visually. And while a round is being drawn, the guesser hears a soft pencil-scratch texture (filtered noise, not a musical tone, so it doesn't get confused with the other cues) synced to the drawer's actual pen movement - live strokes are audible as they happen, not just visible. All of it shares the same mute button and the same synthesized-sound approach as the rest of the game (no samples for effects; the two music tracks are the only actual audio files, both user-supplied).

## Protocol

Client → server (JSON):

| type | fields | who |
|---|---|---|
| `hello` | `playerId` (secret token), `name` | anyone joining or reconnecting |
| `settings` | `settings: {timer, rounds, difficulty, categories, lockGuesses}` | host, in lobby |
| `start` | | host, in lobby, 2+ players |
| `swap` | | drawer, while choosing (cycles through 5 options, wraps back to the first) |
| `ready` | `aspect` | drawer, while choosing |
| `unlock` | | drawer, while drawing, only if `lockGuesses` held guessing back |
| `strokeStart` | `id, tool, size, color, pts` | drawer |
| `strokePoints` | `id, pts` (flat `[x,y,x,y…]`, max 400 values) | drawer |
| `strokeEnd` | `id` | drawer |
| `undo` / `clear` | | drawer |
| `guess` | `text` (rate limited 1 per 350 ms) | guesser, once guessing is open |
| `giveup` | | guesser, while drawing ("Show answer") |
| `react` | `i` (index into the fixed `REACTIONS` list, rate limited 1 per 500 ms) | anyone, while drawing |
| `doodleStart` / `doodlePoints` / `doodleEnd` | `id, pts` (`doodleEnd` just `id`) | anyone but the drawer, while drawing |
| `next` / `again` / `lobby` / `leave` | | reveal / game over / anytime |

The spec's separate "erase" events are simply strokes with `tool: 'eraser'`, which keeps undo and live sync uniform.

Server → client: `state` (tailored per player; only the drawer's copy contains `word`), `board` (full operation list on join/reconnect), `strokeStart` / `strokePoints` / `strokeEnd` / `undo` / `clear` (live relay), `guess` (`result: correct | close | wrong`), `react` (`seat, i`), `doodleStart` / `doodlePoints` / `doodleEnd` (`seat, id, pts`), `event` (`joined`, `back`, `left`), and `error` (`notfound`, `full`, `replaced`).

## Game rules

10 rounds by default (6 or 16 selectable), the drawer role rotates through every seat in join order. The chosen round count is rounded to the nearest multiple of the player count when the game starts, so every player always draws the same number of times - e.g. 3 players + "10 rounds" plays 9 (3 each), not 10 (one player drawing an extra round). Timer 30 / 60 / 90 s or none, with a tick in the last 10 seconds. A correct guess scores 3 points, plus 2 if more than 40 s remain or 1 if more than 20 s remain, with a little victory fanfare. Guess matching ignores case, accents, punctuation, spacing and plurals, accepts listed alternatives ("kitty" for CAT), forgives one typo in words of 5+ letters and two in 9+, and says "So close!" for near misses. Guessers see how many letters are in each word of the answer (one numeral per word, not a row of blanks - those break apart confusingly when the page is pinch-zoomed).

**Word choices.** The drawer is offered 5 words at once and can press "Try another word" as many times as they like - it cycles forward through that fixed batch of 5, wrapping back to the first once it's gone all the way around, so there's always a next option and the same 5 to return to.

**Guessing starts.** A lobby setting ("Right away" / "Let the drawer finish first"). On, guessing is held back the moment drawing starts - the timer doesn't run, the letter-count hint stays hidden, and the guess box is disabled - until the drawer presses their own "Let people guess" button, at which point the timer starts fresh at its full duration and guessing opens for everyone at once.

**Quick reactions.** A row of six emoji buttons (😂 👏 😍 😮 🤔 👀), visible to everyone - drawer included - while a round is being drawn. Tapping one pops a bubble in the same feed a guess would, but it's gone in about a second (a much faster fade than a guess bubble) - a reaction is a quick aside, not something anyone needs to sit and read. It's a fixed list, not free text, so there's nothing to type and nothing to moderate.

**Guesser doodles.** While a round is being drawn, anyone who isn't the drawer can gesture directly on the drawing - point at something, scribble a quick "here!" - without touching the real picture at all. It renders on its own layer above the real drawing, in the doodler's own color and at reduced opacity so it can never compete with the actual artwork, and it's gone within about a second of lifting a finger. None of it is a real stroke: it's never sent through the same pipeline as the drawer's strokes, never stored, never undoable, and never appears in the gallery - it's relayed live and then simply forgotten.

**Difficulty & categories.** Easy / Mixed / Silly draw from the regular word bank (Mixed being everything except Silly and Hard). **Hard** is a separate opt-in tier - currently Symbols, Music and Architecture - full of trickier, more abstract prompts that never show up under any other difficulty by accident. **Chaos** is a second opt-in tier: ~3,000 longer, sillier scenario prompts ("A firefighter arguing with a dinosaur over a traffic cone") from a curated expansion pack, kept out of every other difficulty the same way Hard mode is, so the regular game stays exactly as it was unless a group chooses Chaos on purpose.

**Gallery.** After a game ends, "View & share the gallery" opens a page (`gallery.html?code=CODE`) listing every drawing made that game - word, artist, and the drawing itself replayed from its strokes (never a raster image, so it renders crisply at any size). Each drawing can be saved as a PNG, and the gallery page itself has a share button (native share sheet, or copies the link) plus a QR code back to the site so people can scan their way into a game of their own. A room's drawings live exactly as long as the room does (12 hours idle), and starting a new game (Play Again or New Game) clears the previous game's gallery. If the gallery link was opened from inside a game (`?you=SEAT`), a "My drawings / All drawings" filter appears, letting a player pick out just their own.

**Remix.** Every card also has an "Add to this drawing" button (`remix.html?code=CODE&entry=INDEX`), which loads that finished drawing - anyone's, not just your own - into the same drawing tools as the live game and lets you add more strokes on top, then save the result as its own new gallery card ("Remix by X - started from Y's drawing"). The original is never touched: a remix's new strokes are appended to a copy of the source's stroke list, under a fresh gallery entry, so the drawing being remixed keeps existing exactly as it was, remixable again by someone else independently. There's no live sync while remixing - it's a solo, asynchronous action against the finished picture, submitted once as a whole (`POST /api/rooms/:code/remix`), validated with the same tool/color/size/point-count rules as a live stroke.

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
10. Timer counts down, ticks in the last 10 s, and ends the round at 0.
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
21. 3+ players: picked round count is rounded so every seat draws the same number of times.
22. Guesser sees a numeral per word (not letter blanks) while drawing is in progress; drawer never sees it.
23. Hard difficulty surfaces Symbols/Music/Architecture words; Mixed never does.
24. Chaos difficulty surfaces the expansion-pack scenario prompts; Mixed never does.
25. Gallery: every drawing from the game appears, replays correctly, downloads as a PNG, and the share button + QR code both work.
26. Invert-colors toggle flips the page's colors and is remembered across reload; the drawing itself (and the color/tool pickers) look identical whether it's on or off.
27. Background music is audible on the home screen and lobby, not just mid-game, and switches to the other track once the current one finishes.
28. Every button/chip/swatch press has an audible tap sound.
29. Guessing while someone draws: a soft pen-movement sound is audible in time with the drawer's strokes, distinct from every other sound cue.
30. Game over: music pauses (just the chime plays); Play Again brings the music back once the next round starts.
31. Choosing a word: "Try another word" cycles through 5 options and going past the 5th returns to the 1st, forever.
32. "Let the drawer finish first" setting: guessers see "Hang tight!" with the guess box disabled and no timer running until the drawer taps "Let people guess"; then the timer starts fresh and guessing opens for everyone at once.
33. Quick reactions: tapping an emoji shows it on every screen (including the drawer's) and it's gone in about a second - much quicker than a guess bubble.
34. Guesser doodles: anyone but the drawer can gesture on the drawing with a finger or mouse; the mark shows up faded on everyone's screen, never touches the real drawing, and fades away on its own roughly a second after it's lifted.
