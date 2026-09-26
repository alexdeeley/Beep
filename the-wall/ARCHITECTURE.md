# Architecture

One app server, one database. Nothing else. This document is the map; `DECISIONS.md`
is the reasoning behind each fork in it.

## Processes

```
┌─────────────┐        HTTP (static + /api/*)        ┌──────────────────┐
│   Browser    │ ───────────────────────────────────▶ │                  │
│  (client/)   │ ◀─── WebSocket (/ws) ───────────────▶ │   Node server    │
└─────────────┘                                        │   (server/)      │
                                                        └────────┬─────────┘
                                                                 │ Kysely
                                                        ┌────────▼─────────┐
                                                        │ SQLite / Postgres │
                                                        └───────────────────┘
```

In production, `dist-client/` (built by Vite) is served as static files by the same
Node process that runs the API and WebSocket server - one deployable unit. In
development, Vite's own dev server runs on :5173 and proxies `/api` and `/ws` to the
backend on :8787 (`vite.config.ts`).

Three standalone CLIs (`src/cli/`) talk to the same storage layer directly, no HTTP:
`timelapse` (renders the op log to video), `admin` (stats/moderation/backup/export).

## Data model (`src/shared/types.ts`)

Everything that has ever happened to the wall is one of three **operations**,
appended to a single ordered log and never mutated:

- `stroke` - a smoothed, pressure-sampled polyline (points quantised to 1/16 world
  unit).
- `pixels` - a set of integer grid cells at one of four fixed cell sizes (pixel-mode
  drawing).
- `hide` - a moderation action referencing earlier operation ids to exclude from
  rendering. Nothing is ever deleted; a hide just tells every renderer to skip
  certain ids.

Each operation gets a server-assigned monotonic `seq` (the operations table's own
autoincrement primary key - "assign a seq" is just "insert a row") and a server
timestamp on commit. The client-generated `id` (UUID) is the idempotency key: 
resubmitting the same id (a retried commit after a dropped ack) is a no-op that
returns the existing row, not a duplicate insert.

## Storage (`src/server/db/`)

One interface (`Kysely<Schema>`), two dialects (SQLite for dev, Postgres for prod),
selected by whether `DATABASE_URL` is set. Migrations are written once in
TypeScript against Kysely's schema builder and branch on dialect only for the two
things it can't paper over (autoincrement PK syntax, the native blob/bytea type
name) - see `migrations.ts`.

Four tables: `operations` (the log itself), `tile_index` (which level-0 tiles each
operation's bbox touches, brush-radius padded), `tile_cache` (one cached PNG raster
per `(level, tx, ty)`, tagged with the highest seq baked into it), `snapshots`
(checkpoint markers).

## Tile pyramid (`src/shared/coords.ts`, `src/server/tiles.ts`)

The infinite canvas is divided into level-0 tiles of 512×512 world units. Level N+1
tiles are exactly 4 level-N tiles composited together (double the side length,
quadruple the area), all the way up. Only level-0 membership is ever indexed in the
database; every coarser level is composed on demand from its four children,
recursively, and the result is cached.

Cache invalidation is **lazy and seq-based**, not push-based: a cached tile row
stores the highest `seq` baked into it; a request compares that against a fresh
`MAX(seq)` (or a recursive max over children, for composite levels) and only
re-renders if the tile is actually stale. A tile nothing has ever touched is
rendered on the fly as a blank transparent PNG and **never persisted** - the
alternative (persisting a row for every tile anyone has ever scrolled past, blank
or not) doesn't scale on an infinite canvas.

## Shared rendering (`src/shared/draw.ts`)

`renderOperation`/`renderStroke`/`renderPixels` are plain functions against a
hand-written structural `DrawContext2D` interface (not the DOM's
`CanvasRenderingContext2D` type, which the server build can't import). Both the
browser's real canvas context and `@napi-rs/canvas`'s server-side context satisfy
that same shape, so **the exact same drawing code runs in three places**: the live
client, the server's tile renderer, and the timelapse CLI's frame renderer. There is
one implementation of "what a stroke looks like," not three that have to be kept in
sync.

## Realtime protocol (`src/server/ws.ts`, `src/client/net.ts`)

JSON over one WebSocket per client. Client → server: `hello` (announce session +
last known seq), `viewport` (subscribe to a world region), `op` (a stroke/pixels/hide,
either an in-progress chunk (`final: false`, relayed live, never persisted) or the
commit (`final: true`, gets a seq and is stored)). Server → client: `welcome`
(current head seq), `ops` (committed operations for tiles you're subscribed to -
never echoed back to the sender that produced them), `ack` (your op got a seq),
`live` (someone else's in-progress stroke), `error` (currently only
`resync-required`, sent when a reconnecting client is too far behind to walk
forward incrementally - it falls back to refetching tiles directly instead).

Every write path is idempotent on the client-generated operation id and defends
against exactly the races two clients committing near-simultaneously actually hit in
testing (see `DECISIONS.md` and `PERFORMANCE.md` for the real one this caught).

## Client (`src/client/`)

`store.ts` holds client state: a level-0-only live-op overlay (drawn directly on top
of the cached tile bitmap for zero flicker at the zoom people actually draw at) plus
a bitmap cache keyed `level:tx:ty` for every zoom level. `input.ts` is the
gesture state machine (draw vs. pan vs. pinch-zoom vs. wheel, inertia, pixel-mode
dispatch). `camera.ts` encodes/decodes the view in the URL hash and picks the
initial camera (origin at zoom 1 if the wall's empty, otherwise framed on the last
24h of activity). `offline-queue.ts` is an IndexedDB-backed queue so a commit made
while offline survives a reload and flushes on reconnect.

## Abuse resistance (`src/server/ratelimit.ts`, `src/shared/validate.ts`)

Every operation is validated server-side regardless of what the client claims
(palette index range, size index range, point/cell counts, coordinate bounds,
bbox sanity) - the client's own constraints are a UX nicety, not the security
boundary. Two token buckets gate writes: per-connection (60 cap / 30 per sec) and
per-IP-hash (120 cap / 40 per sec, salted, process-lifetime salt only - never
used for anything but throttling). Moderation is hide-ops plus the admin CLI, both
append-only.

## CLIs (`src/cli/`)

`timelapse.ts` reconstructs the wall's history as video using the exact shared draw
code - never a screen capture - with an activity-based time-compression scheme
(stretches simultaneous bursts across multiple frames via a per-frame cap, collapses
long idle gaps via a capped compressed-time contribution) and a choice of full
(camera eases to contain everything revealed so far) or region (fixed bbox) camera
modes. `admin.ts` covers stats, moderation (`hide`), export (ops as JSON, a
rendered PNG), and backup/restore (dialect-agnostic - it round-trips only
`operations` + `snapshots`, since the tile tables are pure derived caches).
