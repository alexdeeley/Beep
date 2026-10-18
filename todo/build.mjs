// Builds the browser side into ./public: app.js (from client/main.ts),
// sw.js (the service worker, from client/sw.ts), styles, index.html with
// hashed asset links, the manifest and the icons.
//   node build.mjs          readable build
//   node build.mjs --prod   minified
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, 'public');
const prod = process.argv.includes('--prod');
fs.mkdirSync(OUT, { recursive: true });
await esbuild.build({ entryPoints: [path.join(ROOT, 'client/main.ts')], bundle: true, format: 'esm', target: ['es2022'], outfile: path.join(OUT, 'app.js'), minify: prod, sourcemap: prod ? false : 'inline', logLevel: 'warning' });
await esbuild.build({ entryPoints: [path.join(ROOT, 'client/sw.ts')], bundle: true, format: 'iife', target: ['es2022'], outfile: path.join(OUT, 'sw.js'), minify: prod, logLevel: 'warning' });
for (const f of ['styles.css', 'manifest.webmanifest']) fs.copyFileSync(path.join(ROOT, 'client', f), path.join(OUT, f));
for (const f of fs.readdirSync(path.join(ROOT, 'client/icons'))) fs.copyFileSync(path.join(ROOT, 'client/icons', f), path.join(OUT, f));
const hash = (f) => createHash('sha1').update(fs.readFileSync(path.join(OUT, f))).digest('hex').slice(0, 8);
const html = fs.readFileSync(path.join(ROOT, 'client/index.html'), 'utf8').replace('"/styles.css"', `"/styles.css?v=${hash('styles.css')}"`).replace('"/app.js"', `"/app.js?v=${hash('app.js')}"`);
fs.writeFileSync(path.join(OUT, 'index.html'), html);
// the service worker caches the shell by these exact URLs
const sw = fs.readFileSync(path.join(OUT, 'sw.js'), 'utf8').replace(/["']__ASSETS__["']/, JSON.stringify(['/', `/styles.css?v=${hash('styles.css')}`, `/app.js?v=${hash('app.js')}`, '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'])).replace('__BUILD__', hash('app.js') + hash('styles.css'));
fs.writeFileSync(path.join(OUT, 'sw.js'), sw);
console.log(`built ${prod ? 'production' : 'development'} client -> public/`);
