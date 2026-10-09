// Gather the static site from the repository root into ./dist.
//
// Everything in the root is site content unless it is listed here. The list
// mirrors the GitHub Pages workflow, plus the apps that are deployed to their
// own subdomains (they have their own wrangler config each) and this folder.
import { cpSync, rmSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(import.meta.url), '..');
const root = resolve(here, '..');
const out = join(here, 'dist');

const SKIP = new Set([
  '.git', '.github', '.claude', 'node_modules', '_site',
  'src', 'tests', 'samples', 'templates', 'runs',
  'package.json', 'package-lock.json', 'tsconfig.json', 'vitest.config.ts',
  '.env', '.env.example', '.env.local', '.gitignore', 'README.md', 'CNAME',
  'site', 'arkanoid-duel', 'soliteam', 'draw-together', 'gallery',
]);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

let files = 0, bytes = 0;
// Copy entry by entry (copying the root as a whole is refused, since dist is inside it).
for (const name of readdirSync(root)) {
  if (SKIP.has(name)) continue;
  cpSync(join(root, name), join(out, name), {
    recursive: true,
    filter: (src) => {
      const rel = relative(root, src);
      if (rel.split(sep).includes('node_modules')) return false;
      if (statSync(src).isFile()) { files++; bytes += statSync(src).size; }
      return true;
    },
  });
}
console.log(`site: ${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MB -> ${relative(process.cwd(), out) || '.'}`);
if (!readdirSync(out).includes('index.html')) { console.error('no index.html in the site!'); process.exit(1); }
