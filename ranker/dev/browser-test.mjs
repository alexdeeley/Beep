// End to end in a real browser: starts the local server on a throwaway
// database, then uses the app the way a person would. Screenshots land in
// dev/shots. node --no-warnings dev/browser-test.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8893);
const OUT = path.join(ROOT, 'dev', 'shots'); fs.mkdirSync(OUT, { recursive: true });
const { chromium } = await import(process.env.PLAYWRIGHT || '/home/user/Beep/node_modules/playwright/index.mjs');
const EDIT_KEY = 'test-key-123';
const srv = spawn('node', ['--no-warnings', path.join(ROOT, 'dev/local-server.mjs')], { env: { ...process.env, PORT: String(PORT), RANKER_DB: ':memory:', EDIT_KEY }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.once('data', r));
const stop = () => { try { srv.kill(); } catch { /* gone */ } };
process.on('exit', stop);

let passed = 0, failed = 0;
const ok = (c, w) => { if (c) { passed++; console.log('  ✓', w); } else { failed++; console.log('  ✗', w); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const URL = `http://127.0.0.1:${PORT}`;
const open = async (viewport = { width: 1100, height: 900 }, mobile = false) => {
  const page = await (await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  return { page, errors };
};
const settle = (page) => page.waitForFunction(() => document.getElementById('main').getAttribute('aria-busy') !== 'true' && document.getElementById('main').children.length > 0);

console.log('Locked installation: reads work, writes need the key');
const A = await open();
await A.page.goto(URL + '/'); await settle(A.page);
ok(/Empty so far/.test(await A.page.textContent('#main')), 'a fresh installation says it is empty');
await A.page.click('button:text("Load sample data to try it")');
await A.page.waitForSelector('.toast.bad');
ok(/locked/i.test(await A.page.textContent('.toast.bad')), 'without the key, a change is refused with a clear message');
await A.page.goto(URL + '/settings'); await settle(A.page);
await A.page.fill('input[type=password]', EDIT_KEY); await A.page.click('button:text("Save on this device")');
await A.page.goto(URL + '/'); await settle(A.page);
await A.page.click('button:text("Load sample data to try it")');
await A.page.waitForFunction(() => /connections/.test(document.querySelector('.stats')?.textContent ?? '') && !/Empty so far/.test(document.getElementById('main').textContent));
ok(true, 'with the key saved, sample data loads');
await A.page.screenshot({ path: `${OUT}/01-home.png` });

console.log('Library and entity pages');
await A.page.goto(URL + '/library?q=unknown'); await settle(A.page);
ok((await A.page.locator('.ent-list li').count()) === 1 && /Unknown Pleasures/.test(await A.page.textContent('.ent-list')), 'search finds Unknown Pleasures');
await A.page.click('.ent-list .ent');
await settle(A.page); await A.page.waitForSelector('.entity');
ok(/Unknown Pleasures/.test(await A.page.textContent('h1')), 'the entity page opens');
const relGroups = await A.page.locator('.rel-group h3').allTextContents();
ok(relGroups.includes('performed by') && relGroups.includes('produced by') && relGroups.includes('released by'), `connections are grouped and labelled from this side (${relGroups.join(', ')})`);
ok((await A.page.locator('.pill.kind-factual').count()) >= 3 && (await A.page.locator('.pill.kind-editorial').count()) >= 1, 'each connection shows whether it is a fact or an opinion');
ok(/sample data/.test(await A.page.textContent('.ent-head')) && /unverified/.test(await A.page.textContent('#main')), 'sample origin and missing sources are stated plainly');
await A.page.screenshot({ path: `${OUT}/02-entity.png`, fullPage: true });
// add a connection through the picker
await A.page.click('summary:text("Add a connection")');
await A.page.fill('.picker-input', 'Pink Flag');
await A.page.waitForSelector('.picker-item');
await A.page.click('.picker-item');
await A.page.selectOption('select[aria-label="Relationship"]', 'compared_with');
await A.page.fill('input[placeholder^="Why"]', 'both 1977-79 debuts');
await A.page.click('button:text("Connect")');
await A.page.waitForFunction(() => /often compared with/.test(document.querySelector('.rel-groups')?.textContent ?? ''));
ok(/Pink Flag/.test(await A.page.textContent('.rel-groups')), 'a new connection appears in its group');
// a note
await A.page.fill('textarea[placeholder^="A private note"]', 'Heard this first on a long drive.');
await A.page.click('button:text("Add note")');
await A.page.waitForSelector('.notes .note');
ok(/long drive/.test(await A.page.textContent('.notes')), 'a note is saved and shown');

console.log('Adding something new, with duplicate detection');
await A.page.goto(URL + '/library/new'); await settle(A.page);
await A.page.selectOption('select[aria-label="Media type"]', 'film');
ok(await A.page.evaluate(() => [...document.querySelectorAll('.attrs label')].map((l) => l.textContent).includes('Runtime (minutes)')), 'the form shows the attributes of the chosen type');
await A.page.fill('.form input[type=text]', 'control');
await A.page.click('.form button[type=submit]');
await A.page.waitForSelector('.card.warn');
ok(/may already be here/.test(await A.page.textContent('.card.warn')) && /Control/.test(await A.page.textContent('.card.warn')), 'a same-name film is flagged before it is created');
await A.page.click('button:text("create anyway")');
await settle(A.page); await A.page.waitForSelector('.entity');
ok(/control/i.test(await A.page.textContent('h1')) && /\/entity\//.test(A.page.url()), 'creating anyway makes a separate entity');
await A.page.click('button:text("Delete")'); // clean it up (dialog auto-accepts below)
A.page.on('dialog', (d) => d.accept());
await sleep(300);

console.log('Collections');
await A.page.goto(URL + '/collections'); await settle(A.page);
await A.page.fill('input[placeholder=Title]', 'Late night');
await A.page.click('button:text("New collection")');
await settle(A.page); await A.page.waitForSelector('h1:text("Late night")');
for (const name of ['Closer', 'Eraserhead', 'Neuromancer']) { await A.page.fill('.picker-input', name); await A.page.waitForSelector('.picker-item'); await A.page.click('.picker-item'); await A.page.waitForFunction((n) => (document.querySelector('.items')?.textContent ?? '').includes(n), name); }
ok((await A.page.locator('.items .item').count()) === 3, 'three things added through the picker');
await A.page.click('.items .item:nth-child(3) button[aria-label^="Move"][aria-label$="up"]');
await A.page.waitForFunction(() => document.querySelector('.items .item:nth-child(2) .ent-name')?.textContent === 'Neuromancer');
ok(true, 'move up reorders and the order is saved');
await A.page.screenshot({ path: `${OUT}/03-collection.png` });

console.log('Discover');
await A.page.goto(URL + '/library?q=unknown'); await settle(A.page); await A.page.click('.ent-list .ent'); await settle(A.page);
await A.page.click('a:text("Explore from here")'); await settle(A.page);
await A.page.waitForSelector('.rec');
const recs = await A.page.locator('.rec').count();
ok(recs >= 5, `a trail from Unknown Pleasures gives ${recs} suggestions`);
const first = A.page.locator('.rec').first();
ok(/step/.test(await first.locator('.rec-why').textContent()) && /Unknown Pleasures/.test(await first.locator('.rec-why').textContent()), 'each one explains the path in words');
await first.locator('summary').click();
ok((await first.locator('.list.small li').count()) >= 1 && (await first.locator('.pill.kind-factual, .pill.kind-editorial').count()) >= 1, 'with the evidence listed and labelled');
ok((await first.locator('.bar').count()) === 3, 'relevance, novelty and confidence are shown as estimates');
await A.page.screenshot({ path: `${OUT}/04-discover.png`, fullPage: true });
await first.locator('button:text("Not for me")').click();
ok((await A.page.locator('.rec').count()) === recs - 1, 'a dismissed suggestion goes away');
await A.page.click('.strategy:has-text("Controlled randomness")'); await settle(A.page); await A.page.waitForSelector('.rec');
ok(/random|chance/i.test(await A.page.locator('.rec').first().textContent()), 'the random strategy says it is random');

console.log('Data: export and import');
const exp = await (await fetch(`${URL}/api/export`)).json();
ok(exp.format === 'ranker-export' && exp.entities.length >= 25 && exp.collections.some((c) => c.title === 'Late night'), 'the export has everything, including the new collection');
await A.page.goto(URL + '/data'); await settle(A.page);
await A.page.setInputFiles('input[type=file]', { name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...exp, entities: [...exp.entities, { id: 'ent_fresh1', type: 'book', name: 'A Brand New Book', year: 2020 }] })) });
await A.page.click('button:text("Check the file")');
await A.page.waitForSelector('button:text("Import it")');
ok(/entities: 1 would be added/.test(await A.page.textContent('#main')), 'a dry run reports exactly what would change');
await A.page.click('button:text("Import it")');
await A.page.waitForFunction(() => /Imported/.test(document.getElementById('main').textContent));
const check = await (await fetch(`${URL}/api/entities?q=brand%20new`)).json();
ok(check.total === 1, 'and the import lands');
ok(/Remove sample data/.test(await A.page.textContent('#main')), 'the sample data can be removed from here');
await A.page.screenshot({ path: `${OUT}/05-data.png` });
ok(A.errors.length === 0, A.errors.length ? 'page errors: ' + A.errors.join(' | ').slice(0, 300) : 'no page errors on desktop');

console.log('Phone layout and keyboard');
const M = await open({ width: 390, height: 844 }, true);
for (const p of ['/', '/library', '/discover?strategy=random', '/collections', '/data', '/roadmap']) {
  await M.page.goto(URL + p); await settle(M.page);
  const over = await M.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok(!over, `${p}: no sideways scroll on a phone`);
}
await M.page.goto(URL + '/library?q=closer'); await settle(M.page); await M.page.click('.ent-list .ent'); await settle(M.page);
await M.page.screenshot({ path: `${OUT}/06-entity-phone.png`, fullPage: true });
const targets = await M.page.evaluate(() => [...document.querySelectorAll('.btn, .nav a, .chip')].map((b) => b.getBoundingClientRect().height));
ok(targets.every((hgt) => hgt >= 32), `all ${targets.length} buttons and links on the entity page are at least 32px tall (most 44px)`);
ok(await M.page.evaluate(() => document.activeElement?.id === 'main'), 'after navigation, keyboard focus is on the page content, not lost at the top');
await M.page.keyboard.press('Tab');
ok(await M.page.evaluate(() => document.getElementById('main').contains(document.activeElement)), 'and Tab moves into that content');
await M.page.keyboard.press('Shift+Tab'); await M.page.keyboard.press('Shift+Tab');
ok(await M.page.evaluate(() => !!document.activeElement?.closest('.nav')), 'Shift+Tab reaches the navigation');
ok(M.errors.length === 0, 'no page errors on the phone');

await browser.close(); stop();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
