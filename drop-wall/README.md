# THE DROP WALL

A million-point peg machine, live at **https://drop.deeley.org**. Pick a
lane, drop the ball, and every point is earned by the pegs on the way down.
Classic, Jackpot, Endurance (25 balls / 60 seconds / reach 10,000), a Daily
board that is the same for everyone, Practice, and Pass & Play for 2-4
people on one device.

## High scores

Every mode has a shared board of the top 25, kept on the server, so everyone
who plays sees the same list. A board is keyed by the game's own mode key -
mode plus the settings that change the scoring (balls per round, lanes,
values, physics) - so like is only ever compared with like; "Reach 10,000"
boards rank by fewest balls. After a round that counts, a score that would
make its board gets an ADD ME prompt on the results screen; the name is
remembered on that device. Nothing is sent unless you press the button.

- `src/scores.js` - the rules (valid keys, names, scores; sorted, capped insert). Pure, tested in Node.
- `src/worker.js` - `GET/POST /api/scores`, one Durable Object (`DropWallScores`) holding every board, with a light per-IP rate limit.
- `public/index.html` - the game, plus the HIGH SCORES screen and the results-screen prompt.
- `dev/local-server.mjs` - the same API in memory, for local play and the browser test.

Scores are reported by the game in the browser, so this is a friendly
family board, not a tamper-proof one.

## Running and testing

```sh
npm install
npm test               # Node: the board rules
npm run test:browser   # Playwright: plays a round, adds a name, checks another device sees it
npm start              # local server on http://127.0.0.1:8880/
```

## Deploying

Run the *Deploy Cloudflare Workers* workflow with the `drop-wall` option, or
`npm run deploy` here with a Cloudflare token in `CLOUDFLARE_API_TOKEN`.
