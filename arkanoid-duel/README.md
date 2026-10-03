# ARKANOID // DUEL

**Two players. One ball. One wall. Break it before they do.**

A real-time, server-authoritative two-player Arkanoid / Breakout / Pong hybrid
that runs in the browser — phone or desktop. Player 1 sits at the bottom,
Player 2 at the top, one shared ball bounces between you and through a wall of
blocks in the middle. Every block you break scores. Win three levels to win the
match.

Games are private: you create one, get a four-character **game code** and a
**passcode**, and share both with a friend. No friend handy? Tap **PLAY THE
COMPUTER** and play on your own against an AI at easy, normal or hard.

---

## 1. Play it

**Live:** https://duel.deeley.org

1. One player taps **CREATE GAME**, picks a name, and gets a code (like `Q7K9`) and a passcode.
2. The other player taps **JOIN GAME** and enters the code and passcode (or opens the invite link, which fills the code in).
3. Both tap **READY**. A 3-2-1-GO countdown runs on the server's clock.
4. The player whose serve it is taps / presses Space to launch. Play.

### Playing the computer

**PLAY THE COMPUTER** on the landing screen asks for your name, a difficulty and a
game speed, then drops you straight into a match as Player 1 (bottom) with the
computer as Player 2 (top). There is no code or passcode to deal with, and the
computer readies up, serves on its turn and accepts rematches by itself.

- **Easy** — slow to react, imprecise, doesn't aim, ignores power-ups. Good for learning.
- **Normal** — reacts quickly, aims some of its shots, fetches power-ups.
- **Hard** — near-instant reactions and a fast paddle. It works out every shot: it traces where the ball would go off the walls for each part of its paddle and picks the one that breaks the most useful block — above all the last blocks of a level, which decide who wins it.

The computer is not a cheat and not a shortcut: it runs on the server, inside the same
simulation as everyone else, and does only what a person can — move its paddle (at a
limited speed) and press READY / SERVE / REMATCH. It reacts a beat late and aims with
some error. Same rules, same serve order, same scoring. (`shared/ai.ts`; the tests play
computer against computer to check each level really is stronger than the one below.)

## 2. Run it locally

Needs Node 22.18+ (it runs TypeScript straight from source).

```sh
npm install
npm run dev          # builds the client, starts the game server on http://localhost:8787
```

To play yourself: open `http://localhost:8787` in **two browser windows** (a second tab or window is a separate player), create a game
in one, join it in the other. A phone on the same Wi-Fi can join at
`http://<your-computer's-ip>:8787`.

`npm run dev:cf` runs the same thing under real Cloudflare `workerd` (Durable
Objects and all) instead of the lightweight Node stand-in.

## 3. Rules

- **Serve.** Player 1 serves first. After that serves **strictly alternate every rally** — whoever *won* the rally does not serve. Only the player the server names can launch the ball; anything else is rejected.
- **Scoring.** Each block is worth 100 × your combo multiplier. The last paddle to touch the ball gets the credit. Your combo grows with every block you break in a row and **resets only when you lose a rally**.
- **Losing a rally.** Let the last ball past your paddle. (No lives are lost — a rally only changes who serves and resets your combo.)
- **Speed.** The ball speeds up each paddle hit within a rally (capped), and a little each level.
- **Aiming.** Where the ball strikes your paddle sets its angle. The ball can never go too flat.
- **Levels.** A level ends when every required block is gone. Whoever broke the *last* required block takes the level. First to **3 levels** wins the match, then **REMATCH** or leave.
- **Walls.** Level 1 is 16 × 4. Later levels add rows (up to 8) and new block types.

### Blocks

| Look | Block | Does |
|---|---|---|
| plain | Normal | one hit |
| thick | Armored | two or three hits (cracks show) |
| ✸ | Explosive | blows up its neighbours |
| ⑂ | Splitter | splits the ball in two |
| ↻ | Regenerating | heals over time |
| ↔ | Moving | slides side to side |
| grey, solid | Indestructible | never breaks; not required to clear the level |
| ★ | Power block | always drops a power-up |

### Power-ups (any block may drop one — it falls toward whoever broke it, so catch it with your paddle; effects last a few seconds and all end when the next serve begins)

Wide paddle · Multi-ball · Pierce · Slow ball · Fast ball · Shield (a barrier behind your paddle for ten seconds) · Magnet (a wider aiming range off your paddle) · Chaos.

## 4. Controls

| | Move | Serve |
|---|---|---|
| Touch | drag anywhere | tap |
| Mouse | move | click |
| Keyboard | `A` `D` / `←` `→` / `J` `L` | `Space` / `Enter` / `↑` / `W` |

The **⚙** menu has: high-contrast mode, flip the arena (so you're at the bottom even as Player 2), vibration, sound effects, music, and game speed (slow / normal / fast, chosen in the lobby). Shapes, patterns and icons carry meaning as well as colour.

## 5. Architecture

```
client/   browser game: rendering (canvas), input, audio (Web Audio), networking
server/   Room (the match and its players) · Worker (HTTP + WebSocket routing, Durable Object)
shared/   the game itself: constants, levels, and sim.ts — the whole simulation
tests/    unit, room, worker and full-match integration tests
dev/      local server, bots, browser test, load test, lint
```

**The server owns the game.** `shared/sim.ts` is a single deterministic `Match`
class: phases, physics, collisions, scoring, combos, serve order, levels, power-ups,
match result. The server runs it. Browsers only send *intent* (paddle position,
"ready", "serve") and draw what the server says. There is nothing in the browser
to cheat with — a modified client can still only move its own paddle, and only at
the speed the server allows.

The same `sim.ts` is imported by the tests, so the rules that are tested are the
rules that run.

### Phases

`WAITING_FOR_PLAYER → READY → COUNTDOWN → SERVE → PLAYING → RALLY_END → (SERVE | LEVEL_CLEAR → COUNTDOWN) → MATCH_WON → REMATCH`, plus `DISCONNECTED` when a player drops mid-match.

## 6. Networking

- WebSocket per player at `/api/rooms/:code/ws`, JSON messages, validated and size-limited.
- The server steps physics at a fixed **60 Hz** (with swept collision, so fast balls can't tunnel through blocks or paddles) and sends **30 Hz** snapshots. Block layouts are sent once per level, not every snapshot.
- Clients draw about **100 ms in the past**, interpolating between snapshots, so other people's motion is smooth even on a jittery connection. Your *own* paddle is predicted locally so it always feels instant.
- A ping/pong handshake estimates the server clock offset. Countdowns, serve timing and the music all hang off that clock, so both players see (and hear) the same beat.
- The connection chip (top left) shows round-trip time and `GOOD` / `MODERATE` / `POOR`. Lost connections reconnect automatically with backoff and slot back into the same seat.

### Messages

The create request takes an optional `solo` (`easy` / `normal` / `hard`) which seats the computer as Player 2.

Client → server: `hello` (code, passcode, player id, name) · `in` (paddle x) · `ready` · `serve` · `rematch` · `lobby` · `wait` · `leave` · `speed` · `ping`.
Server → client: `welcome` · `level` · `s` (snapshot) · `pong` · `names` · `err`. See `shared/protocol.ts`.

## 7. Passcodes and safety

- A game is created with a passcode (you choose one, or accept the generated one). To join you need **both** the code and the passcode.
- The server stores only a salted SHA-256 hash of the passcode, never the passcode itself, and compares in constant time.
- 5 wrong passcodes lock that game's join attempts for a minute (so a four-letter code can't be brute-forced).
- A game holds exactly two players. A third visitor gets **GAME FULL**. In a game against the computer the second seat belongs to the computer for good, so nobody can join it.
- WebSocket upgrades are **origin-checked** — other websites can't open sockets into your games. Extra allowed origins can be added with `ALLOWED_ORIGINS`.
- Messages are size-limited and rate-limited; a flooding client is cut off. Creating games is rate-limited per address.
- Each browser tab gets a random player id (kept in session storage). That's how you can reload or lose signal and slide back in as the same player. Your seat can't be taken by someone who doesn't know the passcode, and a different tab is a different player.
- The passcode only keeps strangers out of a casual game; it isn't an account system.

## 8. Disconnects

If a player drops mid-match the game pauses on `DISCONNECTED` and the other player sees **OPPONENT DISCONNECTED** with two choices:

- **WAIT** — the game holds for a grace period (25 s, extendable) for them to come back, and resumes with a countdown when they do.
- **RETURN TO LOBBY** — frees the seat so someone else (or the same person later) can join.

A game that stays empty is cleaned up automatically.

## 9. Audio

All procedural Web Audio — no audio files. A 150 BPM acid-bass line (TB-303-style: sawtooth, resonant filter sweeps, accents and slides) plus drums that intensify with combos, and sound effects for paddle, blocks, power-ups, combos, scoring and winning. Notes are scheduled on the audio clock and anchored to the server clock, so both players' music lines up. Music and effects can each be turned off. Browsers need a tap before they'll play sound; the first tap on the page starts it.

## 10. Configuration

Copy `.env.example`. None of these are secret.

| Variable | Used by | Meaning |
|---|---|---|
| `VITE_API_URL` | client build | Base URL of the API if the server is on a different host than the page. Empty = same host. |
| `VITE_WS_URL` | client build | Base URL for WebSockets, same rule. |
| `PORT` | local server | Default `8787`. |
| `NODE_ENV` | local server | `production` tightens origin checks. |
| `ALLOWED_ORIGINS` | Worker | Extra browser origins allowed to open game sockets. |
| `CREATE_LIMIT` | Worker / local | Games one address may create per 10 minutes (default 20). Raise for load tests. |

## 11. Scripts

| | |
|---|---|
| `npm run dev` | build the client + run the local game server |
| `npm run dev:client` | rebuild the client on every change |
| `npm run dev:server` | just the local game server |
| `npm run dev:cf` | run under Cloudflare's `workerd` via `wrangler dev` |
| `npm run build` | bundle the client into `public/` (hashed filenames, service worker) |
| `npm start` | run the local server |
| `npm run typecheck` | TypeScript, client and server |
| `npm run lint` | repo-specific checks (determinism of `shared/`, no stray `console.log`, no secrets…) |
| `npm test` | fast unit / AI / room / worker tests (≈ 80 tests, under a minute) |
| `npm run test:integration` | bots play a whole match over real WebSockets, ~100 s |
| `npm run test:browser` | two real Chromium browsers (a phone and a desktop) play each other; needs `playwright` |
| `npm run loadtest` | N simultaneous games; see below |
| `npm run deploy` | `wrangler deploy` |

CI (`.github/workflows/arkanoid-duel.yml`) runs lint, typecheck, tests, the build, a Worker bundle dry run, and the integration test on every change.

## 12. Testing

- **Sim tests** exercise the rules directly: serve alternation, combo reset, credit for the last paddle touch, level and match results, swept collisions, speed caps, disconnect and rematch.
- **AI tests** play computer against computer through whole matches: serve order, difficulty ladder (hard > normal > easy over many seeds), paddle speed limits, determinism, and that it can never serve out of turn.
- **Room tests** drive the server logic with fake connections: seating, passcodes, lockout, a third player, replaced connections, flooding, reconnect during every phase.
- **Integration**: two bot clients play a full match through the real HTTP + WebSocket path, including rematch and a dropped-then-returning player.
- **Browser**: phone-size touch and desktop browsers play each other and check the screens, serve order, settings and disconnect overlay (screenshots saved for review).
- **Always test with two real devices before calling a change done** — the whole point is people playing each other.

## 13. Deploying

Hosted on Cloudflare Workers; each game is a Durable Object.

```sh
npm install
export CLOUDFLARE_API_TOKEN=...      # an API token with Workers edit rights (set it in your shell or CI secrets, never commit it)
npm run deploy                       # production → duel.deeley.org (see wrangler.jsonc "routes")
npx wrangler deploy --env staging    # a separate staging copy with its own games
```

Changing `routes` in `wrangler.jsonc` changes the address. The `https` / `wss` connection is provided by Cloudflare. `/health` returns `{"ok":true}` for uptime checks.

### Why Cloudflare rather than a Node server?

A multiplayer game wants one program in one place that holds the match in memory and ticks it 60 times a second. That is exactly what a Durable Object is. It also means no servers to run, global edge locations (each game lives near where it was created), WSS with no setup, and scaling by simply having more rooms.

## 14. Scaling and load

One game = one Durable Object, so games never contend with each other; adding games adds objects, not load on a shared process. A game costs very little: a 60 Hz tick over at most 128 blocks and two 30 Hz streams of small snapshots.

Run `npm run loadtest` (`ROOMS=10|50|100|500`, `DURATION=30`, `BASE=https://…`) for a number of simultaneous games with two bots each. It reports snapshot rate and the p50 / p95 / p99 / max gap between snapshots per player. On the single-process local server on a laptop-class machine with the bots in the same process, 10, 50, 100 and 500 simultaneous games (1,000 players) all hold 30 snapshots/s with no dropped connections; the p95 gap rises from ~35 ms to ~90 ms at 500 because the server and 1,000 bots share one machine. For a hosted test run it from a separate machine, and raise `CREATE_LIMIT` on the target first.

## Troubleshooting

- *"Not a valid passcode / wrong passcode"* — check capitals; a game has locked itself for a minute after five wrong tries.
- *Stuck on "connecting"* — a corporate or captive network may block WebSockets. Try another network.
- *No sound* — tap the page once; browsers block audio until you interact. Check the ⚙ menu.
- *Laggy on mobile data* — the chip shows `POOR` when round trips are slow; the server game is unaffected and catches up as soon as the signal improves.
