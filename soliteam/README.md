# SOLITEAM

**THE SOLITAIRE GAME THAT NEVER ENDS.**
**ONE GAME. EVERYONE. FOREVER.**

SOLITEAM is a single game of Klondike Solitaire that is always running and
available to anyone. There is no "New Game" button, no account, no save, no
owner. When you open the page you do not start a game: you walk in on THE
GAME, which other people may already have moved cards in, tidied up, or
ruined. Every move anyone makes changes the one shared table, live, for
everyone looking at it.

When the game can no longer progress - no legal move anywhere could get it
anywhere - the machine announces that there are no more moves, shuffles, and
deals again. The game number goes up by one. Nobody is blamed. It has
theoretically been doing this forever and will theoretically do it forever.

```
SHUFFLE → PLAY → CHAOS → DEAD END → RESET → SHUFFLE → PLAY → …
```

The joke is presented completely seriously, as a piece of public
infrastructure.

**Live:** https://soliteam.deeley.org

---

## 1. Playing

- **Tap a card, then tap where it should go.** A card, a foundation, or an empty column. Legal destinations light up.
- **Tap the stock** (top left) to turn the next card. When it is empty, tap it to turn the waste back over.
- **Double-tap a card** to send it home to its foundation, if it can go.
- **Drag** works too, on a mouse or a finger.
- **Keyboard:** Tab to a card or a pile, Enter to pick it up or put it down, Escape to put it back.

Draw one card at a time, unlimited passes through the stock: the kind of
Solitaire that strangers can reasonably finish together.

Things other people do appear as they happen: their card moves across your
table with a **SOMEONE** label, and the feed at the bottom says what they did
(`SOMEONE MOVED 8♣`, `A PLAYER COMPLETED THE HEARTS`, `SOMEONE HAS BEEN
PLAYING FOR 20 MINUTES`). Nobody is ever named. Occasionally the machine has
something to say for itself.

## 2. Running it locally

Needs Node 22.18+ (it runs TypeScript straight from source).

```sh
npm install
npm run dev          # builds the page, starts THE GAME on http://localhost:8787
```

Open it in two windows and move a card in one. The local server keeps the
game in `.soliteam-state.json` between restarts.

`npm run dev:cf` runs it under Cloudflare's real `workerd` (Durable Object and all).

## 3. How it works

```
client/   the page: cards, dragging, the feed, the curtain
server/   Table (the game, the people, the reset ceremony) · Worker (routing, the Durable Object)
shared/   solitaire.ts: the rules, pure and deterministic · protocol.ts: the messages
tests/    rules, table and worker tests
dev/      local server, browser test
```

**There is exactly one game.** It lives in one Cloudflare Durable Object - a
single, persistent, single-threaded place. The Worker routes every visitor's
WebSocket to the same object (`idFromName('the-game')`), and the object's
storage keeps the cards, the game number and the move total across restarts,
deployments and the long stretches when nobody is looking.

**The server is authoritative.** Browsers send *intent* - "move the top card
of column 3 onto column 5", "turn the stock" - and nothing else. The table
checks every request against the real rules (`shared/solitaire.ts`),
applies it if legal, and broadcasts the new table to everyone. If it is not
legal (any more), nothing happens and the sender is simply shown the real
table. The browser uses the same rules file only to light up where a card
*could* go; it never decides that a move happened.

**Two people grabbing the same card** are handled by the simplest possible
rule: the object processes messages one at a time, so the first move is
applied and the second is checked against the table as it is after that -
and quietly fails.

**Every change carries a sequence number.** A browser ignores anything older
than what it already has, so a late packet can never roll the table back.

### The Great Rule: when does it reset?

After every move (and every few seconds regardless) the table asks whether
anyone could still make *progress*. Progress means a move that provably gets
somewhere:

- any card onto a foundation;
- any stock/waste card onto a column (with draw-one and unlimited passes, every stock card is reachable);
- a whole column onto another when that uncovers a face-down card, or empties the column for something better than a king already at its base;
- part of a column onto another, when the card it uncovers can then take a stock/waste card or go home.

Shuffling kings between empty columns, or moving a run back and forth, is
not progress. When no progress exists the game is stuck, and the reset
ceremony begins: `GAME OVER` → `THERE ARE NO MORE MOVES.` → `THE GAME WILL
NOW RESET ITSELF.` → the cards fly back to the stock → a new deal → `GAME
#… BEGINS`. Moves are refused while it runs. Winning (all four foundations
full) resets the same way, with different words.

### Idle behaviour

If nobody is connected the game simply sits in storage. If people are
connected but nobody has moved for 12 minutes, the system is allowed to put
**one** obviously-finished card on its foundation, and says so (`NOBODY WAS
LOOKING. THE SYSTEM PUT 4♦ HOME.`) - then not again for another 12 minutes.
It never plays the game. Human beings are the engine.

## 4. What is deliberately missing

No accounts, names, profiles, saved games, private games, achievements,
leaderboards, personal statistics, a New Game button, a Give Up button, or a
reset button. The absence is part of the piece.

## 5. Accessibility

Cards are as large as seven columns allow on the screen in use (never
smaller than 44 px wide on a phone, up to 124 px on a desktop), with big
rank and suit in two corners and a large pip in the middle; red suits are
red, black suits are black, and the suit *shapes* carry the information too.
Every card and pile is a real button with a screen-reader label that says
what it is and where it is (`eight of clubs, column 3, with 2 cards on top`).
The feed is an `aria-live` region. Focus is a thick white ring. Tap-then-tap
is a full alternative to dragging. `prefers-reduced-motion` turns the card
animations off.

## 6. Configuration

Nothing is secret. See `.env.example`.

| Variable | Used by | Meaning |
|---|---|---|
| `VITE_API_URL`, `VITE_WS_URL` | client build | Only if the page is served from a different host than the game. Empty = same host. |
| `PORT` | local server | Default `8787`. |
| `STATE_FILE` | local server | Where the game is kept between restarts. |
| `ALLOWED_ORIGINS` | Worker | Extra browser origins allowed to open the game socket. |
| `GAME_OFFSET`, `MOVE_OFFSET` | Worker / local | Added to the *displayed* counters only (never stored). Default 0. If you want the piece to claim that game #8,492,103 is in progress, this is where you lie. |

## 7. Scripts

| | |
|---|---|
| `npm run dev` | build the page + run THE GAME locally |
| `npm run dev:client` | rebuild the page on every change |
| `npm run dev:server` | just the local game server |
| `npm run dev:cf` | run under Cloudflare's `workerd` via `wrangler dev` |
| `npm run build` | bundle the page into `public/` (hashed filenames, service worker) |
| `npm run typecheck` | TypeScript, client and server |
| `npm test` | rules, table and worker tests (seconds) |
| `npm run test:browser` | a phone and a desktop at the same table in real Chromium, including a full reset; needs `playwright` |
| `npm run deploy` | `wrangler deploy` |

## 8. Deploying to a public URL

Hosted on Cloudflare Workers; the game is a Durable Object.

```sh
npm install
export CLOUDFLARE_API_TOKEN=...      # a token with Workers Scripts: Edit (set it in your shell or CI secrets, never commit it)
npm run deploy                       # → soliteam.deeley.org (see wrangler.jsonc "routes")
```

Change `routes` in `wrangler.jsonc` for your own address, or delete it to
use the `*.workers.dev` URL wrangler prints. HTTPS and WSS are provided by
Cloudflare. `/health` returns `{"ok":true}` for uptime checks; `/api/table`
returns the whole table as JSON for the curious.

There is no separate database to set up: the Durable Object's own storage
*is* the database (`wrangler.jsonc` declares it under `migrations`). The
frontend is static files in `public/`, served by the same Worker, built by
`build.mjs` automatically on every deploy.

In this repository the deploy is a GitHub Actions workflow (`Deploy
Cloudflare Workers` → `soliteam`) with the token held as a repository secret.

## 9. Why Cloudflare rather than a Node server?

A single eternal game wants one program, in one place, that is always the
same program, with state that outlives the process. That is exactly what a
Durable Object is: it wakes when someone connects, serves everyone from one
thread, persists to its own storage, and sleeps when they leave. No server
to keep alive, nothing to back up, no way for two copies to disagree about
where the ♠8 is.
