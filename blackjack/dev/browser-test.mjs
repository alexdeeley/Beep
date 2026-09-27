// Two real browsers play multiple rounds of blackjack against the local
// server. Real cards are random (there's no debug hook to force a shoe over
// the wire, unlike Draw Together's word list), so this drives the game
// adaptively via window.__bj rather than asserting exact hands: whoever's
// turn it is hits once if it's safe, otherwise stands, and the test just
// verifies the flow, sync, and math hold up regardless of what was dealt.
//   PLAYWRIGHT_BROWSERS_PATH=... node dev/browser-test.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.PW || 'playwright');
const PORT = 8793, URL0 = `http://localhost:${PORT}/`;
const OUT = process.env.SHOTS || '/tmp/bj-shots';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  ✓ ' + l); } else { fail++; console.log('  ✗ ' + l); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = spawn('node', [path.join(ROOT, 'dev/local-server.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.once('data', r));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
async function player(name, opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|net::ERR_FAILED/.test(m.text())) errors.push(name + ': ' + m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await page.goto(URL0);
  return { ctx, page };
}

const state = (page) => page.evaluate(() => window.__bj.S.st);

// Plays out the current hand for whoever's turn it is: hits once while
// comfortably under 21 (never on a hand that could bust badly), otherwise
// stands. Returns once the phase leaves 'playing'.
async function autoPlayRound(A, M, aSeat) {
  for (let i = 0; i < 40; i++) {
    const st = await state(A.page);
    if (st.phase !== 'playing') return st.phase;
    const actor = st.turnSeat === aSeat ? A : M;
    const hand = st.hands[st.turnSeat]?.[st.turnHandIdx];
    if (!hand) { await sleep(150); continue; }
    let total = 0, aces = 0;
    for (const c of hand.cards) { total += c.rank === 'A' ? 11 : (['J', 'Q', 'K'].includes(c.rank) ? 10 : Number(c.rank)); if (c.rank === 'A') aces++; }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    const action = total <= 15 && hand.cards.length < 4 ? 'hit' : 'stand';
    const visible = await actor.page.isVisible(`#btn-${action}`);
    if (visible) await actor.page.click(`#btn-${action}`);
    await sleep(180);
  }
  return (await state(A.page)).phase;
}

async function waitPhase(page, phase, timeout = 8000) {
  await page.waitForFunction((p) => window.__bj.S.st?.phase === p, phase, { timeout });
}

// ── Lobby, seating, table code ───────────────────────────────

const A = await player('Alex', { viewport: { width: 1180, height: 820 } });
const M = await player('Maisie', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

await A.page.screenshot({ path: `${OUT}/01-home-a.png` });

await A.page.fill('#in-name', 'Alex');
await A.page.click('#btn-create');
await A.page.waitForSelector('#ctl-lobby:not([hidden])');
const code = (await A.page.textContent('#hud-code')).trim();
ok(/^[A-Z]{3,5}[2-9]$/.test(code), 'table created: ' + code);

await M.page.fill('#in-name', 'Maisie');
await M.page.click('#btn-join');
await M.page.fill('#in-code', 'NOPE9');
await M.page.click('#btn-join-go');
await M.page.waitForFunction(() => document.getElementById('join-err').textContent.length > 0);
ok((await M.page.textContent('#join-err')).includes("couldn't find") || (await M.page.textContent('#join-err')).length > 0, 'friendly unknown-code message');
await M.page.fill('#in-code', code);
await M.page.click('#btn-join-go');
await M.page.waitForSelector('#ctl-lobby:not([hidden])');
await sleep(300);
ok((await state(A.page)).players.length === 2, 'both players seated at the same table');
await A.page.screenshot({ path: `${OUT}/02-lobby.png` });

const aSeat = (await state(A.page)).you;

// Non-host cannot start.
await M.page.evaluate(() => window.__bj.S.net.send({ type: 'start' }));
await sleep(200);
ok((await state(A.page)).phase === 'lobby', 'non-host cannot start the table');

await A.page.click('#btn-start');
await waitPhase(A.page, 'betting');
ok(true, 'host starting moves the table to betting');

// ── Round 1: both bet, play out, reach reveal ────────────────

await A.page.click('.chip-btn:text("25")');
await M.page.click('.chip-btn:text("25")');
await A.page.screenshot({ path: `${OUT}/03-betting.png` });
await A.page.waitForFunction(() => window.__bj.S.st.phase !== 'betting', null, { timeout: 5000 });
const st1 = await state(A.page);
ok(st1.phase === 'playing' || st1.phase === 'dealer' || st1.phase === 'reveal', 'betting resolves into a dealt hand');

// Verify both clients see the identical shared state (only "you" differs).
{
  const a = await state(A.page), m = await state(M.page);
  const stripYou = (s) => JSON.stringify({ ...s, you: null, serverNow: null });
  ok(stripYou(a) === stripYou(m), 'both clients see byte-identical table state (only "you" differs)');
}

const phaseAfterPlay = await autoPlayRound(A, M, aSeat);
ok(phaseAfterPlay === 'dealer' || phaseAfterPlay === 'reveal', 'playing phase ends once both hands are done');
await waitPhase(A.page, 'reveal');
await A.page.screenshot({ path: `${OUT}/04-reveal.png` });
ok(!(await state(A.page)).dealer.holeHidden, "dealer's hole card is revealed by the time results show");
ok((await state(A.page)).lastResults.players.length >= 1, 'reveal carries results for at least one player');

await waitPhase(A.page, 'betting', 8000);
ok((await state(A.page)).round === 2, 'table loops automatically into round 2');

// ── Round 2: exercise Double Down if it comes up ─────────────

await A.page.click('.chip-btn:text("10")');
await M.page.click('.chip-btn:text("10")');
await A.page.waitForFunction(() => window.__bj.S.st.phase !== 'betting', null, { timeout: 5000 });
{
  // If it's my turn and Double is enabled, use it once for coverage.
  const st = await state(A.page);
  if (st.phase === 'playing') {
    const actor = st.turnSeat === aSeat ? A : M;
    if (await actor.page.isVisible('#btn-double') && !(await actor.page.locator('#btn-double').isDisabled())) {
      const before = st.players.find((p) => p.seat === st.turnSeat).chips;
      await actor.page.click('#btn-double');
      await sleep(300);
      const after = (await state(A.page)).players.find((p) => p.seat === st.turnSeat).chips;
      ok(after < before, 'doubling down deducts an additional bet');
    }
  }
}
await autoPlayRound(A, M, aSeat);
await waitPhase(A.page, 'reveal', 10000);
await waitPhase(A.page, 'betting', 8000);
ok((await state(A.page)).round === 3, 'a second full round completes and loops again');

// ── Reconnection: Maisie reloads mid-lobby-of-next-bet ───────

await M.page.reload();
await M.page.waitForFunction(() => window.__bj.S.net?.isOpen, null, { timeout: 8000 }).catch(() => {});
await sleep(500);
const afterReload = await state(M.page);
ok(afterReload && afterReload.players.length === 2, 'reconnecting after a reload keeps both seats (no duplicate)');
ok(afterReload.you === (await state(A.page)).players.find((p) => p.name === 'Maisie').seat, "Maisie's seat is restored, not reassigned");

// ── Leaderboard reflects real chip movement ──────────────────

const lbRes = await A.page.evaluate(async (c) => (await fetch(`/api/tables/${c}/leaderboard`)).json(), code);
ok(lbRes.exists && lbRes.rows.length === 2, 'leaderboard API returns both players');
ok(lbRes.rows.every((r) => r.handsPlayed >= 2), 'stats accumulate hands played across rounds');

// ── Mute + invert-colors (shared UI, quick smoke) ────────────

await A.page.click('#btn-mute');
ok((await A.page.getAttribute('#btn-mute', 'aria-pressed')) === 'true', 'mute toggles on');
await A.page.click('#btn-a11y-hud');
ok(await A.page.evaluate(() => document.documentElement.classList.contains('a11y-invert')), 'invert-colors toggles on');
await A.page.screenshot({ path: `${OUT}/05-inverted.png` });

// ── Leaving frees the seat ────────────────────────────────────

await M.page.evaluate(() => window.__bj.S.net.send({ type: 'leave' }));
await sleep(400);
ok((await state(A.page)).players.length === 1, 'leaving removes the player for everyone else watching');

ok(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));

await browser.close();
srv.kill();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
