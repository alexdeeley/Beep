// Load test: N games, two bots each, all playing at once over real WebSockets.
//
//   npm run loadtest                       10 rooms against the local server
//   ROOMS=50 DURATION=30 npm run loadtest
//   BASE=https://staging.example.workers.dev ROOMS=100 npm run loadtest
//
// Reports, per player: how many snapshots arrived per second (the server
// sends 30), and the gaps between them (p50/p95/p99/max). A healthy server
// holds ~30/s with a p95 gap near 33 ms. Targets worth running: 10, 50, 100, 500.
// Note: the bots run in this one Node process, so at several hundred rooms the
// test machine itself becomes the bottleneck - run it from more than one.

import { Bot, createGame } from './bot.mjs';

const BASE = (process.env.BASE || 'http://localhost:8787').replace(/\/$/, '');
const ROOMS = Number(process.env.ROOMS || 10);
const DURATION = Number(process.env.DURATION || 20);   // seconds of play to measure
const RAMP_MS = Number(process.env.RAMP_MS || 20);     // pause between room creations

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);

const bots = [];
let failed = 0;
const rid = () => 'load-' + Math.random().toString(36).slice(2, 12).padEnd(10, 'x');

console.log(`Load test: ${ROOMS} rooms (${ROOMS * 2} players) against ${BASE}, measuring ${DURATION}s`);
const t0 = Date.now();
for (let i = 0; i < ROOMS; i++) {
  const pid1 = rid(), pid2 = rid(), pass = 'load' + i;
  try {
    const { status, body } = await createGame(BASE, pass, pid1);
    if (status !== 200 || !body.code) { failed++; if (status === 429) { console.log('  create rate-limited at room', i); break; } continue; }
    const a = new Bot({ base: BASE, code: body.code, pass, pid: pid1, name: 'A' + i, skill: 0.7, seed: i + 1 });
    const b = new Bot({ base: BASE, code: body.code, pass, pid: pid2, name: 'B' + i, skill: 0.7, seed: i + 1001 });
    const [ra, rb] = await Promise.all([a.connect(), b.connect()]);
    if (!ra.ok || !rb.ok) { failed++; continue; }
    for (const bot of [a, b]) {
      bot.gaps = []; bot.last = 0; bot.count = 0;
      const handle = bot.handle.bind(bot);
      bot.handle = (m) => { if (m.t === 's') { const now = performance.now(); if (bot.last) bot.gaps.push(now - bot.last); bot.last = now; bot.count++; } handle(m); };
      bots.push(bot);
    }
  } catch (e) { failed++; }
  if (RAMP_MS) await sleep(RAMP_MS);
}
console.log(`  ${bots.length / 2} rooms up in ${((Date.now() - t0) / 1000).toFixed(1)}s (${failed} failed)`);

// Let games reach live play, then measure a clean window.
await sleep(6000);
for (const b of bots) { b.gaps = []; b.count = 0; b.last = 0; }
const start = performance.now();
let maxLag = 0, prev = performance.now();
const lagTimer = setInterval(() => { const n = performance.now(); maxLag = Math.max(maxLag, n - prev - 50); prev = n; }, 50);
await sleep(DURATION * 1000);
clearInterval(lagTimer);
const secs = (performance.now() - start) / 1000;

const rates = bots.map((b) => b.count / secs).sort((x, y) => x - y);
const gaps = bots.flatMap((b) => b.gaps).sort((x, y) => x - y);
const dropped = bots.filter((b) => b.closed).length;
const playing = bots.filter((b) => b.snap && ['PLAYING', 'SERVE', 'COUNTDOWN'].includes(b.snap.ph)).length;
const errs = bots.reduce((n, b) => n + b.errors.length, 0);

console.log(`\nResults over ${secs.toFixed(1)}s, ${bots.length} players`);
console.log(`  snapshots/s per player   min ${rates[0]?.toFixed(1)}  median ${pct(rates, 0.5).toFixed(1)}  (target 30)`);
console.log(`  gap between snapshots    p50 ${pct(gaps, 0.5).toFixed(0)} ms  p95 ${pct(gaps, 0.95).toFixed(0)} ms  p99 ${pct(gaps, 0.99).toFixed(0)} ms  max ${(gaps.at(-1) || 0).toFixed(0)} ms`);
console.log(`  players still connected  ${bots.length - dropped}/${bots.length}   in live play ${playing}`);
console.log(`  server errors received   ${errs}`);
console.log(`  test-machine event-loop lag peak ${maxLag.toFixed(0)} ms (if high, the test client is the bottleneck)`);

const ok = dropped === 0 && failed === 0 && pct(rates, 0.5) > 24 && pct(gaps, 0.95) < 120;
console.log(ok ? '\nPASS' : '\nDEGRADED - see numbers above');
for (const b of bots) b.close();
await sleep(200);
process.exit(ok ? 0 : 1);
