// A small, dependency-free lint. TypeScript (npm run typecheck) already catches
// type errors and unused code; this catches the things it doesn't.
//
//   - shared/ must stay pure and deterministic: no Math.random, Date.now, DOM or Node APIs
//     (the server and the tests both rely on it replaying identically)
//   - no leftover console.log / debugger in shipped code
//   - no secrets-shaped strings, no tabs, no trailing whitespace, no TODO/FIXME left behind
//   - every .ts file under shared/ server/ client/ uses only erasable syntax (no enums, namespaces,
//     parameter properties) so Node can run it straight from source in the tests

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);

const files = ['shared', 'server', 'client'].flatMap(walk).filter((f) => /\.(ts|css|html|mjs)$/.test(f))
  .concat(walk('dev').filter((f) => f.endsWith('.mjs') && !f.endsWith('lint.mjs')), ['build.mjs']);

const rules = [
  { name: 'console.log in shipped code', re: /\bconsole\.log\(/, only: /^(shared|server|client)\// },
  { name: 'debugger statement', re: /\bdebugger\b/ },
  { name: 'non-deterministic call in shared/', re: /\bMath\.random\(|\bDate\.now\(|\bperformance\.now\(|\bdocument\.|\bwindow\./, only: /^shared\// },
  { name: 'enum / namespace (not erasable)', re: /^\s*(export\s+)?(const\s+)?(enum|namespace)\s/, only: /\.ts$/ },
  { name: 'constructor parameter property (not erasable)', re: /constructor\s*\([^)]*\b(public|private|protected|readonly)\s+\w+/, only: /\.ts$/ },
  { name: 'looks like a secret', re: /\b(cfut_|sk-[A-Za-z0-9]{20}|ghp_[A-Za-z0-9]{20}|AKIA[0-9A-Z]{16})/ },
  { name: 'TODO/FIXME left in', re: /\b(TODO|FIXME|XXX)\b/ },
  { name: 'tab character', re: /\t/ },
  { name: 'trailing whitespace', re: /[ ]+$/ },
];

for (const f of files) {
  const rel = f.split(path.sep).join('/');
  const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const r of rules) {
      if (r.only && !r.only.test(rel)) continue;
      if (r.re.test(line)) problems.push(`${rel}:${i + 1}  ${r.name}\n      ${line.trim().slice(0, 100)}`);
    }
  });
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} problem(s) in ${files.length} files`);
  process.exit(1);
}
console.log(`lint: ${files.length} files clean`);
