// Local server: the static site from ./public plus the real visitor's-book
// code (src/worker.js, src/book.js) running on an in-memory SQLite database,
// so the whole thing works with no Cloudflare account.   node dev/serve.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8788);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

// A stand-in for the Durable Object namespace: one instance, in-memory SQLite.
const { default: worker, VisitorBook } = await import(path.join(ROOT, 'src/worker.js'));
const db = new DatabaseSync(':memory:');
const sql = {
  exec(query, ...params) {
    const st = db.prepare(query);
    if (/^\s*(select|with)\b/i.test(query) || /\breturning\b/i.test(query)) { const rows = st.all(...params); return { toArray: () => rows }; }
    st.run(...params);
    return { toArray: () => [] };
  },
};
const env = { ADMIN_KEY: process.env.ADMIN_KEY || 'local-admin' };
const instance = new VisitorBook({ storage: { sql } }, env);
env.BOOK = { idFromName: (n) => n, get: () => ({ fetch: (req) => instance.fetch(req) }) };

http.createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (pathname.startsWith('/api/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request('http://localhost' + req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const out = await worker.fetch(request, env);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
    return;
  }
  // Like Cloudflare's asset serving: "/art" finds art.html, "/" finds index.html.
  let rel = pathname.endsWith('/') ? pathname + 'index.html' : pathname;
  let file = path.join(PUBLIC, rel);
  if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`gallery on http://localhost:${PORT}`));
