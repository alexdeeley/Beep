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

## Deployment (Cloudflare Containers → wall.deeley.org)

**Live at https://wall.deeley.org.** Deployed via Cloudflare Containers - the
exact same unmodified app and Dockerfile as any other host, with a thin Worker +
Durable Object (`wrangler.jsonc`, `src/worker/index.ts`) as Cloudflare's own
routing/lifecycle wrapper (see `DECISIONS.md` for why this was chosen over a
serverless rewrite). Verified end-to-end, not just deployed: `/api/health`,
the static page, and the tile endpoint all respond correctly, and a real browser
session drew a stroke and confirmed it round-tripped through the live Worker →
Durable Object → container → SQLite → back to the canvas.

Two things worth knowing if you redeploy or hit similar issues:

- **Cloudflare Containers requires the account to be on the Workers Paid plan**
  ($5/month) - not obvious from the Containers UI itself, which appears
  navigable on the Free plan right up until a deploy fails with an opaque 401 on
  the container registry push. If a deploy fails there, check
  Billing → Subscriptions first.
- **The API token needs three separate permission groups**, which aren't bundled
  into any single quick-pick template: **Workers Scripts: Edit**, **Cloudflare
  Containers: Edit**, and (for the custom domain) either **Workers Routes: Edit**
  scoped to the zone, or just create the domain mapping directly via
  `PUT /accounts/{account_id}/workers/domains` (what this deployment actually
  used, since the account's token didn't have the zone-level Workers Routes
  permission wrangler's own route-creation step wants - the Custom Domains API
  itself worked fine with what the token already had).

To redeploy from a machine with Docker running and this repo checked out:

```bash
npm install
npm run cf:login      # opens a browser to authenticate with Cloudflare - no token to paste anywhere
npm run cf:types       # regenerates worker-configuration.d.ts (gitignored) from wrangler.jsonc
npm run deploy         # wrangler deploy - builds the Docker image, pushes it, updates the Worker
```

If wrangler's own route-creation step fails after that (the zone-level Workers
Routes permission gap above), the custom domain mapping only needs to be created
once and persists across future deploys - use the curl command above with a
token that has Workers Scripts + Containers edit access.

**Verify after deploying**: open `https://wall.deeley.org`, draw something, reload,
confirm it persisted. Note the accepted tradeoff from `DECISIONS.md`: the wall's
data lives on the container's own disk (SQLite), not a managed database - durable
across a normal restart, but not guaranteed to survive Cloudflare rescheduling the
instance to different underlying hardware. `npm run admin -- backup <path>` run
periodically against the live container is the mitigation already built for this,
if it's worth wiring up as a cron job later.

## Documents in this repo

- `DECISIONS.md` - every design decision this build made autonomously, with the
  reasoning, in the order they came up.
- `ARCHITECTURE.md` - how the pieces fit together.
- `PERFORMANCE.md` - real measured numbers, including a real bug the load test
  found and the fix for it.
