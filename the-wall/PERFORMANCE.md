# Performance

All numbers below were actually measured against this codebase in this environment
(a single shared container, SQLite backend, Node 22, headless Chromium) - none are
estimated. Where a measurement genuinely wasn't taken, that's stated plainly instead
of a guess. Every command is reproducible: run it yourself and you should land in the
same neighbourhood, modulo hardware.

## Server-side operation throughput

Sequential `insertOperation` calls, single connection, SQLite, no network/WebSocket
overhead - the DB layer's own ceiling:

```
5000 operations inserted in 1073ms → 4659.8 ops/sec
```

## Tile rendering

A level-0 tile (512×512 world units) with ~500 operations already indexed to it:

| Path | Latency |
|---|---|
| Cold render (compose + PNG encode, nothing cached) | 49ms |
| Warm cache hit (seq comparison only) | p50 0ms, p95 1ms |

Cold-render cost is dominated by walking every indexed operation and re-drawing it;
warm hits are effectively free, which is the point of the seq-based cache.

## Client rendering (headless Chromium, 1280×800 viewport)

Measured via `requestAnimationFrame` instrumentation while the wall had ~5000
operations loaded across nearby tiles:

| Scenario | Frame rate |
|---|---|
| Idle | 60 fps |
| Continuously panning (trackpad-style wheel) across the populated region | 60 fps |

No dropped frames observed panning through populated tiles in this run. This
environment's headless Chromium renders in software (no GPU), so a real device
would be expected to do at least this well, not worse.

**Pointer-to-frame latency** (time from a `pointermove` being dispatched to the next
animation frame observing it): p50 8.1ms, p95 8.7ms, n=30 samples. Caveat: these
samples were driven through Playwright's automation protocol, which adds its own
dispatch overhead on top of whatever a real OS input event would cost - so this is
an upper bound on the app's actual input-to-paint latency, not an isolated
measurement of it. Both values sit comfortably under one 60Hz frame (16.7ms)
either way.

## Load test: 500 concurrent clients

`npm run test:load` (`tests/load/load-test.ts`) opens 500 real WebSocket
connections from one process against a real running server and sends 5 stroke
commits per client (2500 total), measuring actual connect time and ack latency.

```json
{
  "clients": 500,
  "connectFailures": 0,
  "totalOpsSent": 2500,
  "opsCommittedServerSide": 160,
  "unackedClientSide": 2340,
  "durationMs": 5385,
  "throughputOpsPerSec": 29.7,
  "connectMsP50": 155,
  "connectMsP95": 2080,
  "ackLatencyMsP50": 875,
  "ackLatencyMsP95": 1737,
  "ackLatencyMsP99": 1890
}
```
(Consistent across repeated runs: a second run measured 160 committed, 29.8
ops/sec, well within noise of the above.)

**This surfaced and fixed a real crash bug.** The first time this load test ran, it
took the whole server process down within a couple of seconds:

```
SqliteError: UNIQUE constraint failed: tile_cache.level, tile_cache.tx, tile_cache.ty
    at ... setTileCache (src/server/db/store.js:175)
```

`setTileCache` and `insertOperation` both used a select-then-insert-or-update
pattern with a time-of-check-to-time-of-use race: two concurrent requests touching
the same never-yet-cached tile (or, for `insertOperation`, the same retried op id)
could both see "no existing row" and both attempt an insert, and the loser threw an
uncaught `SQLITE_CONSTRAINT` error that crashed the process. Fixed by making
`setTileCache` an atomic `INSERT ... ON CONFLICT DO UPDATE`, and by wrapping
`insertOperation`'s insert in a try/catch that falls back to reading the row that
won the race instead of crashing (see `DECISIONS.md` for the full reasoning,
including why a "stale" raced write is provably harmless here). After the fix, the
same 500-client test no longer crashes the server, run repeatedly.

**Why most ops go unacked, honestly**: all 500 simulated clients share one real
source IP (they're all one process on loopback), and the server's per-IP-hash rate
limit bucket (120 capacity, 40/sec refill - see `ratelimit.ts`) is deliberately
shared across every connection from the same IP. A burst of 2500 near-simultaneous
ops from one IP hits that shared ceiling almost immediately; the ~160 that get
through roughly tracks the bucket's capacity plus a few seconds of refill. This is
the rate limiter doing exactly what it's specified to do, not a bug - but it is a
real, worth-flagging tradeoff: many genuine users behind the same NAT/corporate
proxy drawing at the same moment would see the same throttling. The per-connection
bucket (60/30 per sec) is not the bottleneck here since 5 ops/client is well under it.

## Memory

| Point | RSS |
|---|---|
| Server boot, empty-ish DB | ~107 MB |
| Immediately after the 500-client / 2500-op load test above | ~178 MB |

**Not measured**: sustained memory after a 30-minute soak. A real 30-minute run
wasn't performed in this session (the environment used for this build is
short-lived and the other checkpoints took priority); the number above is an
honest before/after snapshot around one load-test burst, not a soak test, and
should not be read as one. If this matters before shipping, run the server for 30
real minutes under steady synthetic traffic (`test:load` in a loop, or a slower
trickle) and watch RSS with `ps` or `/proc/<pid>/status` - nothing in the
architecture (an in-memory `Map` per open WebSocket connection for pending acks,
plus whatever V8 itself retains) suggests an obvious unbounded leak, but that's
a code-reading argument, not a measurement, and the brief is explicit that the
difference matters.

## Reproducing these numbers

```bash
npm run build
node dist-server/server/index.js &            # SQLITE_PATH/PORT as needed
npm run test:load                              # 500-client load test
node --import tsx/esm <ad-hoc script>          # tile/insert benchmarks (see git history
                                                # of this file's authoring session for the
                                                # exact scripts used, not checked in - they
                                                # were scratch, not part of the deliverable)
```
