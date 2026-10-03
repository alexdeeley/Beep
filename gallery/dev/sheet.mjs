// Renders a contact sheet - a few pieces from every style - to look at.
//   node dev/sheet.mjs [outdir]
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || '/tmp/gallery-sheet';
fs.mkdirSync(OUT, { recursive: true });
const PORT = 8791;
const { chromium } = await import(process.env.PW || 'playwright');
const srv = spawn('node', [path.join(ROOT, 'dev/serve.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => srv.stdout.once('data', r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await (await browser.newContext({ viewport: { width: 900, height: 700 } })).newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`http://localhost:${PORT}/art`);
await page.waitForFunction(() => window.gallery);
const styles = await page.evaluate(() => import('./js/art/index.js').then((m) => m.STYLES.map((s) => s.id)));
for (const id of styles) {
  const url = await page.evaluate(async (id) => {
    const { createPiece } = await import('./js/art/index.js');
    const found = [];
    for (let i = 0; found.length < 4 && i < 5000; i++) { const p = createPiece('sheet ' + id + ' ' + i); if (p.style === id) found.push(p); }
    const H = 300, pad = 12;
    const widths = found.map((p) => Math.round(H * p.aspect));
    const c = document.createElement('canvas');
    c.width = widths.reduce((a, b) => a + b, 0) + pad * (found.length + 1); c.height = H + pad * 2;
    const x = c.getContext('2d'); x.fillStyle = '#888'; x.fillRect(0, 0, c.width, c.height);
    let ox = pad;
    found.forEach((p, i) => {
      const t = document.createElement('canvas'); t.width = widths[i]; t.height = H;
      p.draw(t.getContext('2d'), widths[i], H, 14);
      x.drawImage(t, ox, pad); ox += widths[i] + pad;
    });
    return c.toDataURL('image/png');
  }, id);
  fs.writeFileSync(path.join(OUT, `${id}.png`), Buffer.from(url.split(',')[1], 'base64'));
  console.log('wrote', id);
}
await browser.close();
srv.kill();
