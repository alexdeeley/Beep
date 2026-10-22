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
const srv = spawn('node', ['--no-warnings', path.join(ROOT, 'dev/local-server.mjs')], { env: { ...process.env, PORT: String(PORT), RANKER_DB: ':memory:', EDIT_KEY, RANKER_AI: 'fake' }, stdio: ['ignore', 'pipe', 'inherit'] });
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
await A.page.click('button:text("New list")');
await settle(A.page); await A.page.waitForSelector('h1:text("Late night")');
for (const name of ['Closer', 'Eraserhead', 'Neuromancer']) { await A.page.fill('.picker-input', name); await A.page.waitForSelector('.picker-item'); await A.page.click('.picker-item'); await A.page.waitForFunction((n) => (document.querySelector('.items')?.textContent ?? '').includes(n), name); }
ok((await A.page.locator('.items .item').count()) === 3, 'three things added through the picker');
await A.page.click('.items .item:nth-child(3) button[aria-label^="Move"][aria-label$="up"]');
await A.page.waitForFunction(() => document.querySelector('.items .item:nth-child(2) .ent-name')?.textContent === 'Neuromancer');
ok(!(await A.page.locator('button:text("Save my order")').isDisabled()), 'move up reorders on the page and offers Save my order');
await A.page.click('button:text("Save my order")');
await A.page.waitForSelector('.toast.ok');
await A.page.reload(); await settle(A.page);
ok((await A.page.locator('.items .item .ent-name').allTextContents())[1] === 'Neuromancer', 'the saved order survives a reload');
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
const targets = await M.page.evaluate(() => [...document.querySelectorAll('.btn, .nav a, .nav button, .chip, .ctl-tri')].map((b) => b.getBoundingClientRect().height).filter((hgt) => hgt > 0));
ok(targets.every((hgt) => hgt >= 32), `all ${targets.length} buttons and links on the entity page are at least 32px tall (most 44px)`);
ok(await M.page.evaluate(() => document.activeElement?.id === 'main'), 'after navigation, keyboard focus is on the page content, not lost at the top');
await M.page.keyboard.press('Tab');
ok(await M.page.evaluate(() => document.getElementById('main').contains(document.activeElement)), 'and Tab moves into that content');
await M.page.keyboard.press('Shift+Tab'); await M.page.keyboard.press('Shift+Tab');
ok(await M.page.evaluate(() => !!document.activeElement?.closest('.nav')), 'Shift+Tab reaches the navigation');
ok(M.errors.length === 0, 'no page errors on the phone');

console.log('Lists from a topic (fake AI provider)');
const L = await open();
await L.page.goto(URL + '/settings'); await settle(L.page);
await L.page.fill('input[type=password]', EDIT_KEY); await L.page.click('button:text("Save on this device")');
ok(/On: lists from a topic are gathered by fake/.test(await L.page.textContent('#main')), 'Settings says which AI provider is on');
// something already in the library gets linked, not doubled
await L.page.evaluate(() => window.__ranker.api('POST', '/entities', { type: 'album', name: 'Revolver', year: 1966 }));
await L.page.goto(URL + '/collections'); await settle(L.page);
await L.page.click('.fbar .plus'); await settle(L.page);
ok(/New list from a topic/.test(await L.page.textContent('h1')), 'the + on the Lists page leads to the list builder');
ok(/AI provider: fake/.test(await L.page.textContent('#main')), 'the page names the provider in use');
await L.page.click('summary:text("The list templates")');
ok((await L.page.locator('.tpl-list li').count()) >= 8, 'the templates (the stylesheet for lists) are listed with their columns');
await L.page.fill('input[type=text]', 'Beatles albums');
await L.page.click('button:text("Gather with AI")');
await L.page.waitForSelector('.review-sec .ltable');
const names = await L.page.locator('.review-sec .ltable tr.lrow .k-name').allTextContents();
ok(names.length === 6 && names[0] === 'Please Please Me', `the draft lists ${names.length} items in order (${names[0]}…)`);
const heads = await L.page.locator('.review-sec .ltable th').allTextContents();
ok(heads.includes('Year') && heads.includes('By') && heads.includes('Popularity') && heads.includes('Genres') && heads.includes('Format'), `columns follow the albums template (${heads.filter(Boolean).join(', ')})`);
ok((await L.page.locator('.review-sec .pop').count()) === 6, 'popularity is drawn as a bar per row');
ok(/AI-gathered · unverified/.test(await L.page.textContent('.review-sec')), 'the draft is labelled AI-gathered and unverified');
const revolverRow = L.page.locator('.review-sec tr.lrow', { hasText: 'Revolver' });
ok(/already in the library/.test(await revolverRow.textContent()) && (await revolverRow.locator('select.decide').inputValue()) === 'existing', 'Revolver, already in the library, defaults to linking the existing entry');
await L.page.locator('.review-sec tr.lrow', { hasText: 'Rubber Soul' }).locator('select.decide').selectOption('skip');
ok(/4 new entries.*1 linked.*1 skipped/.test(await L.page.textContent('.counts')), 'the summary updates with the decisions');
await L.page.screenshot({ path: `${OUT}/07-list-review.png`, fullPage: true });
await L.page.fill('.review-sec form input[type=text]', 'Beatles: the studio albums');
await L.page.click('button:text("Save this list")');
await L.page.waitForURL(/\/collections\/col_/); await settle(L.page);
ok(/Beatles: the studio albums/.test(await L.page.textContent('h1')), 'saving lands on the new collection');
ok(/Built from the topic Beatles albums/.test(await L.page.textContent('.prov')) && /gathered by AI/.test(await L.page.textContent('.prov')), 'the collection states its topic and that AI gathered it');
const saved = await L.page.locator('.items .item .ent-name').allTextContents();
ok(saved.length === 5 && !saved.includes('Rubber Soul') && saved.includes('Revolver'), `the saved list has ${saved.length} numbered rows, without the skipped one`);
ok((await L.page.locator('.items .item .ctl-tri').count()) === 20, 'each row has up, down, note and remove controls');
await L.page.screenshot({ path: `${OUT}/08-list-saved.png`, fullPage: true });
await L.page.click('.view-row button:text("Details")');
await settle(L.page); await L.page.waitForSelector('.ltable');
ok((await L.page.locator('.ltable tr.lrow .k-name').count()) === 5, 'the details view lays the list out in the template columns');
ok((await L.page.locator('.ltable .pop').count()) === 4, 'popularity bars are shown there (not for Revolver, which was added by hand without one)');
await L.page.screenshot({ path: `${OUT}/09-list-details.png`, fullPage: true });
await L.page.click('#menu-btn'); await L.page.waitForSelector('#menu a:visible');
ok((await L.page.locator('#menu a').count()) === 8, 'the MENU opens with every section');
await L.page.keyboard.press('Escape');
ok(await L.page.evaluate(() => document.getElementById('menu').hidden), 'Escape closes it');
await L.page.goto(URL + '/library?sort=popular'); await settle(L.page);
ok((await L.page.locator('.ent-list .ent-name').first().textContent()) === "Sgt. Pepper's Lonely Hearts Club Band", 'POPULAR puts the best-known thing first');
await L.page.goto(URL + '/library?tags=1'); await settle(L.page);
await L.page.click('.tagrow button:text("rock")'); await settle(L.page);
ok((await L.page.locator('.ent-list li').count()) === 4 && /rock/.test(await L.page.textContent('h1')), 'a TAG narrows the library to that genre');
await L.page.goto(URL + '/library?q=please'); await settle(L.page);
await L.page.click('.ent-list .ent'); await settle(L.page); await L.page.waitForSelector('.entity');
ok(/AI-gathered · unverified/.test(await L.page.textContent('.ent-head')) && /origin: provider:fake/.test(await L.page.textContent('#main')), 'an entity made this way says it is AI-gathered and unverified');
ok((await L.page.evaluate(async () => (await window.__ranker.api('GET', '/entities?q=revolver')).total)) === 1, 'Revolver was linked, not doubled');
ok(L.errors.length === 0, 'no page errors while building a list');

await browser.close(); stop();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
