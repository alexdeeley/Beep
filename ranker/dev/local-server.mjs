// Local server: the same API as the Worker, on node:sqlite, plus the built
// client from ./public with the SPA fallback. Data persists in
// dev/ranker.sqlite (set RANKER_DB=:memory: for a throwaway database).
//   PORT=8890 EDIT_KEY=secret node --no-warnings dev/local-server.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeDriver } from '../server/db/node-driver.ts';
import { buildServices, handle } from '../server/api.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8890);
const svc = buildServices(new NodeDriver(process.env.RANKER_DB || path.join(ROOT, 'dev', 'ranker.sqlite')), 'local');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.map': 'application/json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : null;
    const request = new Request(url, { method: req.method, headers: req.headers, body: body && req.method !== 'GET' && req.method !== 'HEAD' ? body : undefined });
    const out = await handle(request, svc, { editKey: process.env.EDIT_KEY || undefined, ip: req.socket.remoteAddress || 'local' });
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
    return;
  }
  let file = path.join(PUB, path.normalize(url.pathname));
  if (!file.startsWith(PUB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUB, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`ranker at http://127.0.0.1:${PORT}/ ${process.env.EDIT_KEY ? '(locked)' : '(open: no EDIT_KEY)'}`));
