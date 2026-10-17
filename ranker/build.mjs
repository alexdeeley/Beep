// Builds the browser side into ./public: app.js, styles.css and index.html.
//   node build.mjs          readable build with source maps
//   node build.mjs --prod   minified
import esbuild from 'esbuild';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, 'public');
const prod = process.argv.includes('--prod');
fs.mkdirSync(OUT, { recursive: true });
await esbuild.build({
  entryPoints: [path.join(ROOT, 'client/main.ts')],
  bundle: true, format: 'esm', target: ['es2022'], outfile: path.join(OUT, 'app.js'),
  minify: prod, sourcemap: prod ? false : 'inline', logLevel: 'warning',
});
fs.copyFileSync(path.join(ROOT, 'client/styles.css'), path.join(OUT, 'styles.css'));
// Cache-bust the stylesheet and script links with a hash of their contents,
// so a redeploy is never hidden behind a browser's cached copy.
const hash = (f) => createHash('sha1').update(fs.readFileSync(path.join(OUT, f))).digest('hex').slice(0, 8);
fs.writeFileSync(path.join(OUT, 'index.html'), fs.readFileSync(path.join(ROOT, 'client/index.html'), 'utf8').replace('"/styles.css"', `"/styles.css?v=${hash('styles.css')}"`).replace('"/app.js"', `"/app.js?v=${hash('app.js')}"`));
console.log(`built ${prod ? 'production' : 'development'} client -> public/`);
