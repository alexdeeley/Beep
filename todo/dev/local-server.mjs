// Local server: the same API as the Worker, on node:sqlite, plus the built
// app from ./public with the SPA fallback. Data persists in dev/todo.sqlite
// (RANKER-style: set TODO_DB=:memory: for a throwaway database). Reminders
// are delivered by a timer that stands in for the Durable Object alarm.
//   PORT=8930 TODO_RECOVERY_KEY=some-long-secret node --no-warnings dev/local-server.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeDriver } from '../server/node-driver.ts';
import { buildServices, handle, deliverDue } from '../server/api.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8930);
const svc = buildServices(new NodeDriver(process.env.TODO_DB || path.join(ROOT, 'dev', 'todo.sqlite')), { recoveryKey: process.env.TODO_RECOVERY_KEY, vapidSubject: process.env.VAPID_SUBJECT || 'mailto:dev@example.com', environment: 'local' });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.map': 'application/json' };

// the alarm stand-in: wake at the next reminder time
let timer = null;
function schedule(nextIso) {
  clearTimeout(timer); timer = null;
  if (!nextIso) return;
  timer = setTimeout(async () => { const r = await deliverDue(svc); schedule(r.next); }, Math.max(250, Date.parse(nextIso) - Date.now()));
}
deliverDue(svc).then((r) => schedule(r.next));

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : null;
    const request = new Request(url, { method: req.method, headers: req.headers, body: body && req.method !== 'GET' && req.method !== 'HEAD' ? body : undefined });
    const out = await handle(request, svc, { ip: req.socket.remoteAddress || 'local', schedule });
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
    return;
  }
  let file = path.join(PUB, path.normalize(url.pathname));
  if (!file.startsWith(PUB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUB, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`todo at http://127.0.0.1:${PORT}/ ${process.env.TODO_RECOVERY_KEY ? '(recovery key set)' : '(NO RECOVERY KEY: setup is impossible until TODO_RECOVERY_KEY is set)'}`));
