// Builds the browser side into ./public: app.js, styles.css and index.html.
//   node build.mjs          readable build with source maps
//   node build.mjs --prod   minified
import esbuild from 'esbuild';
import fs from 'node:fs';
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
fs.copyFileSync(path.join(ROOT, 'client/index.html'), path.join(OUT, 'index.html'));
console.log(`built ${prod ? 'production' : 'development'} client -> public/`);
