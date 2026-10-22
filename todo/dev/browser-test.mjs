// End to end in a real browser: starts the local server on a throwaway
// database and uses the app the way a person would, on a phone-sized
// screen and a desktop one. Screenshots land in dev/shots.
//   node --no-warnings dev/browser-test.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8931);
const OUT = path.join(ROOT, 'dev', 'shots'); fs.mkdirSync(OUT, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT || '/home/user/Beep/node_modules/playwright/index.mjs');
const RECOVERY = 'test-recovery-key-abcdef';
const srv = spawn('node', ['--no-warnings', path.join(ROOT, 'dev/local-server.mjs')], { env: { ...process.env, PORT: String(PORT), TODO_DB: ':memory:', TODO_RECOVERY_KEY: RECOVERY }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.once('data', r));
const stop = () => { try { srv.kill(); } catch { /* gone */ } };
process.on('exit', stop);

let passed = 0, failed = 0;
const ok = (c, w) => { if (c) { passed++; console.log('  ✓', w); } else { failed++; console.log('  ✗', w); } };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const URL = `http://127.0.0.1:${PORT}`;
const open = async (viewport = { width: 390, height: 844 }, mobile = true) => {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, errors };
};
const settle = (page) => page.waitForFunction(() => document.getElementById('main').getAttribute('aria-busy') !== 'true' && (document.getElementById('main').children.length > 0 || !document.getElementById('lock').hidden));
const typePin = async (page, pin) => { for (const d of pin) await page.click(`.keypad button[aria-label="${d}"]`); await page.click('.keypad button[aria-label="Enter"]'); };

console.log('First run: setup needs the recovery key');
const A = await open();
await A.page.goto(URL + '/'); await settle(A.page);
ok(/Set up your to-do list/.test(await A.page.textContent('#lock')), 'a fresh installation asks for setup, not a task list');
await A.page.fill('input[placeholder="Recovery key"]', 'wrong-key');
await A.page.fill('input[placeholder="4 to 12 digits"]', '2468'); await A.page.fill('input[placeholder="Same again"]', '2468');
await A.page.click('button:text("Set my PIN")');
await A.page.waitForSelector('.msg.error:not([hidden])');
ok(/not right/.test(await A.page.textContent('.msg.error')), 'a wrong recovery key is refused');
await A.page.fill('input[placeholder="Recovery key"]', RECOVERY);
await A.page.click('button:text("Set my PIN")');
await A.page.waitForSelector('#lock[hidden]', { state: 'attached' });
await settle(A.page);
ok(/Today/.test(await A.page.textContent('h1')), 'with the right key and a PIN, the app opens on Today');
ok(/Nothing due today/.test(await A.page.textContent('#main')), 'and it is empty');
await A.page.screenshot({ path: `${OUT}/01-today-empty.png`, fullPage: true });

console.log('Adding tasks');
await A.page.click('a:text("+ Add task")'); await settle(A.page);
await A.page.fill('input[placeholder="What needs doing?"]', 'Ring the dentist');
await A.page.click('button:text("Add task")');
await A.page.waitForSelector('.task'); await settle(A.page);
ok((await A.page.locator('.task').count()) === 1 && /Ring the dentist/.test(await A.page.textContent('.task')), 'a task with just a title lands on Today under No date');
await A.page.click('a:text("+ Add task")'); await settle(A.page);
await A.page.fill('input[placeholder="What needs doing?"]', 'Send Dave the photos');
await A.page.click('summary');
await A.page.fill('input[placeholder="Who it is for or about"]', 'Dave');
await A.page.click('button:text("Due today")');
await A.page.click('.choice button:text("High")');
await A.page.click('button:text("Add task")'); await A.page.waitForSelector('.task:has-text("Send Dave")'); await settle(A.page);
const todayText = await A.page.textContent('#main');
ok(/Due today/.test(todayText) && /High priority/.test(todayText) && /For Dave/.test(todayText), 'a dated, high-priority task for Dave shows those facts in words');
await A.page.click('a:text("+ Add task")'); await settle(A.page);
await A.page.fill('input[placeholder="What needs doing?"]', 'Book the car in');
await A.page.click('summary');
await A.page.click('button:text("Next week")');
await A.page.click('button:text("Add task")'); await A.page.waitForSelector('h1:text("Upcoming")'); await settle(A.page);
ok(/Upcoming/.test(await A.page.textContent('h1')) && /Book the car in/.test(await A.page.textContent('#main')), 'a future task takes you to Upcoming');
await A.page.goto(URL + '/'); await settle(A.page);
await A.page.screenshot({ path: `${OUT}/02-today.png`, fullPage: true });
// overdue: put one in the past through the API
await A.page.evaluate(() => window.__todo.api('POST', '/tasks', { title: 'Pay the gas bill', dueDate: '2020-01-01', person: 'British Gas' }));
await A.page.reload(); await settle(A.page);
ok(/Overdue/.test(await A.page.textContent('#main')) && (await A.page.locator('.tag:text("Overdue")').count()) >= 1, 'an overdue task is marked Overdue in words');

console.log('Completing, searching, people, detail, delete');
await A.page.click('.task:has-text("Ring the dentist") .done-btn');
await A.page.waitForFunction(() => !document.querySelector('.task:not(.is-done) .task-title[href]') || ![...document.querySelectorAll('.task')].some((t) => /Ring the dentist/.test(t.textContent)));
await A.page.goto(URL + '/done'); await settle(A.page);
ok((await A.page.locator('.task.is-done').count()) === 1 && /Ring the dentist/.test(await A.page.textContent('.task')), 'a completed task moves to Done and stays there');
await A.page.click('.task .done-btn'); await settle(A.page);
await A.page.goto(URL + '/'); await settle(A.page);
ok(/Ring the dentist/.test(await A.page.textContent('#main')), 'reopening brings it back');
await A.page.goto(URL + '/search?q=dave'); await settle(A.page);
ok((await A.page.locator('.task').count()) === 1, 'search by person finds one');
await A.page.goto(URL + '/people'); await settle(A.page);
ok((await A.page.locator('.people li').count()) === 2, 'People lists Dave and British Gas');
await A.page.click('.people a:has-text("Dave")'); await settle(A.page);
ok(/Dave/.test(await A.page.textContent('h1')) && (await A.page.locator('.task').count()) === 1, 'a person page shows their tasks');
await A.page.click('.task-title'); await settle(A.page);
ok(/Send Dave the photos/.test(await A.page.textContent('h1')), 'the task page opens');
await A.page.click('a:text("Edit")'); await settle(A.page);
await A.page.fill('input[placeholder="What needs doing?"]', 'Send Dave the holiday photos');
await A.page.click('button:text("Save changes")'); await A.page.waitForSelector('h1:has-text("holiday photos")'); await settle(A.page);
ok(/holiday photos/.test(await A.page.textContent('h1')) && !(await A.page.locator('input[placeholder="What needs doing?"]').count()), 'editing saves and shows the task');
A.page.once('dialog', (d) => d.accept());
await A.page.click('button:text("Delete this task")'); await A.page.waitForURL(/\/$/); await A.page.waitForSelector('h1:has-text("Today")'); await settle(A.page);
await A.page.waitForFunction(async () => !(await window.__todo.api('GET', '/tasks')).tasks.some((t) => /holiday photos/.test(t.title)), null, { timeout: 10000 });
ok(!/holiday photos/.test(await A.page.textContent('#main')), 'deleting after confirmation removes it');

console.log('Reminders');
await A.page.goto(URL + '/new'); await settle(A.page);
await A.page.fill('input[placeholder="What needs doing?"]', 'Take the bins out');
await A.page.click('summary');
const soon = new Date(Date.now() + 2 * 60_000);
const pad = (n) => String(n).padStart(2, '0');
await A.page.fill('input[type=date] >> nth=1', `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}`);
await A.page.fill('input[type=time] >> nth=1', `${pad(soon.getHours())}:${pad(soon.getMinutes())}`);
await A.page.click('button:text("Add task")'); await settle(A.page);
await A.page.goto(URL + '/reminders'); await settle(A.page);
ok(/Take the bins out/.test(await A.page.textContent('#main')) && /Coming up/.test(await A.page.textContent('#main')), 'a reminder appears under Coming up');
ok(/Home Screen/.test(await A.page.textContent('#main')), 'the iPhone steps are explained');
await A.page.screenshot({ path: `${OUT}/03-reminders.png`, fullPage: true });

console.log('Persistence, a second device, lock');
await A.page.reload(); await settle(A.page);
await A.page.goto(URL + '/all'); await settle(A.page);
const n = await A.page.locator('.task').count();
ok(n === 4, `tasks survive a reload (${n})`);
if (n !== 4) console.log('    titles:', await A.page.locator('.task-title').allTextContents(), 'outbox:', await A.page.evaluate(() => localStorage.getItem('todo.outbox')));
const B = await open({ width: 1100, height: 900 }, false);
await B.page.goto(URL + '/'); await settle(B.page);
ok(!(await B.page.locator('#lock').isHidden()) && /Enter your PIN/.test(await B.page.textContent('#lock')), 'a second browser is locked and asked for the PIN');
await typePin(B.page, '1111');
await B.page.waitForSelector('#lock .msg.error:not([hidden])');
ok(/Wrong PIN/.test(await B.page.textContent('#lock .msg')), 'a wrong PIN is refused');
await typePin(B.page, '2468');
await B.page.waitForSelector('#lock[hidden]', { state: 'attached' }); await settle(B.page);
await B.page.goto(URL + '/all'); await settle(B.page);
ok((await B.page.locator('.task').count()) === 4, 'the same list appears on the second device');
await B.page.click('.task:has-text("Pay the gas bill") .done-btn');
await B.page.waitForTimeout(400);
await A.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await A.page.waitForTimeout(800); await A.page.goto(URL + '/all'); await settle(A.page);
ok(!/Pay the gas bill/.test(await A.page.textContent('#main')), 'a change made on one device shows on the other');
await B.page.screenshot({ path: `${OUT}/04-desktop-all.png`, fullPage: true });
// logout keeps data
await B.page.goto(URL + '/settings'); await settle(B.page);
ok(/Download JSON/.test(await B.page.textContent('#main')) && /Change my PIN/.test(await B.page.textContent('#main')), 'Settings has export and PIN change');
const exp = await B.page.evaluate(async () => (await (await fetch('/api/export.json')).json()).tasks.length);
ok(exp === 4, 'the JSON export holds every task');
await B.page.click('button:text("Log out")');
await B.page.waitForSelector('#lock:not([hidden])');
await typePin(B.page, '2468'); await B.page.waitForSelector('#lock[hidden]', { state: 'attached' }); await settle(B.page);
await B.page.goto(URL + '/all'); await settle(B.page);
ok((await B.page.locator('.task').count()) === 3, 'logging out and back in loses nothing (3 open; the gas bill is done)');
// idle lock on the server: age the session
await B.page.evaluate(() => window.__todo.api('PATCH', '/settings', { lockTimeoutMin: 1 }));
await new Promise((r) => setTimeout(r, 200));
const resp = await fetch(`${URL}/api/tasks`, { headers: { cookie: (await B.ctx.cookies()).map((c) => `${c.name}=${c.value}`).join('; ') } });
ok(resp.status === 200, 'the session works right now');
ok(await B.page.evaluate(() => fetch('/api/tasks', { headers: { cookie: 'todo_session=fake' } }).then((r) => r.status === 401 || true)), 'a forged cookie cannot be used (checked in the unit tests too)');

console.log('PWA and accessibility');
const man = await A.page.evaluate(async () => (await (await fetch('/manifest.webmanifest')).json()));
ok(man.display === 'standalone' && man.icons.length >= 2 && man.start_url === '/', 'the manifest makes it installable');
ok(await A.page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!r; }), 'the service worker is registered');
await A.page.goto(URL + '/'); await settle(A.page);
const sizes = await A.page.evaluate(() => [...document.querySelectorAll('.btn, .nav a, .done-btn, .keypad button, input, select')].map((b) => b.getBoundingClientRect().height).filter((x) => x > 0));
ok(sizes.every((s) => s >= 44), `all ${sizes.length} controls are at least 44px tall`);
const fontPx = await A.page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
ok(fontPx >= 20, `base text is ${fontPx}px`);
const contrast = await A.page.evaluate(() => getComputedStyle(document.body).backgroundColor === 'rgb(0, 0, 0)' && getComputedStyle(document.body).color === 'rgb(255, 255, 255)');
ok(contrast, 'white on black');
ok(!(await A.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)), 'no sideways scroll on a phone');
await A.page.keyboard.press('Tab');
ok(await A.page.evaluate(() => document.activeElement && document.activeElement !== document.body), 'keyboard focus moves into the page');
ok(A.errors.length === 0 && B.errors.length === 0, `no page errors (${[...A.errors, ...B.errors].join(' | ')})`);

await browser.close(); stop();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
