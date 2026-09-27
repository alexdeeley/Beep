# Blackjack

Real-time multiplayer blackjack. One shared table, one live dealer, up to seven
seats - everyone sees every hand as it's dealt, bets with the same chip stack
across rounds, and the table just keeps dealing hand after hand. No accounts,
just a table code.

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
npm test                                   # card/hand math + full table protocol (93 checks)
node dev/browser-test.mjs                  # two real browsers play several rounds together
```

The browser test can't force a specific shoe the way a word-bank game could force a specific word - the cards are genuinely random - so it drives the game adaptively (hits under 15, stands otherwise) via a `window.__bj` debug hook and checks that the *flow*, *sync*, and *math* hold up regardless of what was actually dealt: both clients see byte-identical table state, the dealer's hole card stays hidden until reveal, doubling deducts the right amount, chips and stats accumulate correctly across rounds, reconnecting restores the same seat, and the table loops automatically from reveal back into betting.

## Deployment (Cloudflare Workers + Durable Objects → blackjack.deeley.org)

```bash
npm install
npx wrangler login
npx wrangler deploy
```

Standalone for now at its own subdomain - see `DECISIONS.md` for how this is expected to fold into a shared `play.deeley.org` later, once there's more than one multiplayer game to host.

## Project layout

```
src/worker.js        HTTP routes, table creation, WebSocket hand-off
src/table-room.js     TableRoom Durable Object: the whole game - shoe, turns, dealer, payouts, chips
src/cards.js          Deck/shoe, hand-value math, blackjack/bust detection (pure, no game state)
public/index.html     All screens
public/styles.css     Green-felt table look, portrait/landscape safe
public/js/shared.js   Constants shared by browser and server (seats, bet limits, timers)
public/js/app.js      Screens, rendering, actions
public/js/net.js      WebSocket client with reconnect + heartbeat
public/js/sound.js    Procedural sound effects + mute
public/js/a11y.js     Invert-colors accessibility toggle
dev/                  Local server emulator, DO-emulation harness, and tests
```

## How it works

**Tables.** `POST /api/tables` makes a code like `ACE7` (a card-themed word + a digit 2-9, no confusable letters). `GET /api/tables/:code` says whether it exists and is full. `/api/tables/:code/ws` upgrades to a WebSocket owned by that table's Durable Object. `GET /api/tables/:code/leaderboard` returns each seated player's stats. Idle tables clean themselves up after 12 hours.

**The server is the dealer.** The shoe, every hand, the hole card, and every chip stack live only on the server. Guessing at cards client-side is pointless - there's nothing to guess, every hand is visible to everyone except the dealer's hole card, which is hidden identically for every client (not per-viewer like a word to guess) until the dealer's turn.

**One table, forever.** Unlike a fixed-round party game, blackjack doesn't really have a "game over" - real tables just keep dealing. After the host's one-time `start`, the table cycles **betting → (deal) → playing → dealer → reveal → betting → …** indefinitely. New players can sit down mid-session; they simply wait for the next betting phase. Chip stacks and stats persist across the whole session, and a player who busts out completely is restocked (see `DECISIONS.md`).

**Turn clock.** Betting has a 20-second window - once everyone connected has bet (or time runs out), the hand deals. Each decision (hit/stand/double/split) gets its own 20-second clock; not acting in time auto-stands that hand, exactly like a distracted player at a real table. The dealer's own cards are paced ~900ms apart for a readable reveal.

## Rules implemented

- 6-deck shoe, reshuffled once it drops below ~25% remaining (never mid-hand).
- Dealer **stands on soft 17** (a deliberate, slightly player-friendlier house rule - see `DECISIONS.md`).
- Blackjack (natural 21 on the first two cards) pays **3:2**. A dealer peek: if the dealer's own hand is a natural, the round settles immediately for everyone (pushes against another natural, otherwise everyone else loses) - nobody plays out a hand the dealer already won.
- **Double down** on the first two cards only, for an equal additional bet, exactly one more card.
- **Split** once per hand on any starting pair of the same rank (not just same value - a King and a 10 can't split). Splitting aces deals exactly one card to each and ends the hand there (no blackjack bonus on a split-ace 21, and no re-splitting or doubling after any split) - all standard casino rules.
- Busting out completely (0 chips) restocks a player back to the starting stack so the table keeps going rather than stranding them.

**Deliberately not implemented** (documented, not forgotten - see `DECISIONS.md`): insurance, surrender, re-splitting past one split, and doubling after a split.

## Protocol

Client → server (JSON):

| type | fields | who |
|---|---|---|
| `hello` | `playerId` (secret token), `name` | anyone joining or reconnecting |
| `start` | | host, in lobby |
| `bet` | `amount` | anyone seated, during betting |
| `action` | `action: hit\|stand\|double\|split` | whoever's turn it is |
| `leave` | | anyone, anytime |

Server → client: one shared `state` for everyone (only `you` differs - there's no per-player secret the way a word-guessing game hides the word), `event` (`joined`, `back`, `left`), `error` (`notfound`, `full`, `replaced`).

## Accessibility

A mute button and an invert-colors toggle, same pattern (and same reasoning) as Draw Together's: sound is a genuine accessibility feature here too - a distinct chip-click, card-deal, hole-card-flip, and win/blackjack/bust cue, plus a countdown tick in a decision's last five seconds, so the table is followable by ear, not just by eye.

## QA checklist (on real devices)

1. Create on one device, join by code on another; a full table shows a friendly message.
2. Both clients see the exact same cards, chips, and bets in real time.
3. The dealer's hole card never appears in any frame before the reveal (check the Network tab → WS frames).
4. Betting: chip presets disable once you've bet, or if you can't afford them.
5. Turn: Hit/Stand/Double/Split only appear for whoever's turn it is; Double disables past two cards; Split only enables on a genuine pair you can afford to match.
6. Not acting in time auto-stands your hand and the game moves on.
7. Dealer reveals the hole card and plays out (hitting under 17, standing on soft 17) with a readable pace.
8. Blackjack pays 3:2, a push returns the bet, a plain win pays even money, a bust or loss pays nothing.
9. A player who busts out completely gets restocked rather than stuck.
10. The table loops from reveal back into a fresh betting phase automatically - no "Play Again" click needed.
11. Reload mid-session: chips, seat, and stats all come back; no duplicate player.
12. Leaderboard shows every seated player's chips, best streak, and blackjack count.
13. Mute silences every sound; invert-colors flips the whole page and is remembered.
