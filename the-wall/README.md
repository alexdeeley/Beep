# The Wall

A persistent, anonymous, shared drawing wall. One infinite canvas, no accounts, no
text anywhere in the UI except accessibility labels. Everyone who opens it draws on
the same wall, in real time, forever.

## Run it locally

```bash
npm install
npm run migrate      # creates ./data/wall.db (SQLite) - skip if using Postgres
npm run dev          # backend on :8787, frontend (Vite) on :5173, proxied together
```

Open `http://localhost:5173`. Draw with a mouse, finger, or pen. Two fingers /
wheel / trackpad pinch to pan and zoom. The corner dot (or a long-press) opens the
colour and brush palette.

For a production-like run: `npm run build && node dist-server/server/index.js`
(serves the built client + API + WebSocket from one process on `$PORT`, default
8787). See `Dockerfile` / `.env.example` for the containerized version.

## Environment variables

See `.env.example`. The short version: set `DATABASE_URL` for Postgres, or leave it
unset to use `SQLITE_PATH` (defaults to `./data/wall.db`). `IP_HASH_SALT` is
optional (a random one is generated at boot if unset - fine for a single
long-running instance, regenerates on restart otherwise).

## Testing

```bash
npm test            # unit tests (vitest) - fast, no server needed
npm run test:e2e     # multi-client Playwright acceptance test - starts its own
                      # server + Vite dev server, exercises the full 5-part
                      # scenario (draw sync, concurrent convergence, offline
                      # reconnect, server restart, timelapse fidelity)
npm run test:load     # 500 concurrent WebSocket clients against an already-
                      # running server - see PERFORMANCE.md for results
npm run typecheck
```

## CLIs

```bash
npm run timelapse -- --duration 30 --fps 24 --out timelapse.mp4
npm run admin -- stats | snapshot | hide <ids...> | export-ops <path> |
  export-png <path> [--bbox ...] | backup <path> | restore <path>
```

Both talk to whatever `SQLITE_PATH`/`DATABASE_URL` the environment points at - run
them against a stopped server's data file, or a live one (reads are safe
concurrent with a running server; `restore` is destructive and should not be run
against a database a live server is also writing to).

## Documents in this repo

- `DECISIONS.md` - every design decision this build made autonomously, with the
  reasoning, in the order they came up.
- `ARCHITECTURE.md` - how the pieces fit together.
- `PERFORMANCE.md` - real measured numbers, including a real bug the load test
  found and the fix for it.
