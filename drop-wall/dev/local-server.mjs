// Local stand-in for the Worker: serves ./public and an in-memory /api/scores
// with exactly the same rules (src/scores.js). node dev/local-server.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanKey, cleanName, cleanScore, insert, lowerIsBetter } from '../src/scores.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PORT = Number(process.env.PORT || 8880);
const boards = new Map();
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const send = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/scores') {
    if (req.method === 'GET') {
      const key = cleanKey(url.searchParams.get('key'));
      return key ? send(res, 200, { key, lower: lowerIsBetter(key), entries: boards.get(key) || [] }) : send(res, 400, { error: 'bad key' });
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let b; try { b = JSON.parse(body); } catch { return send(res, 400, { error: 'bad json' }); }
      const key = cleanKey(b?.key); if (!key) return send(res, 400, { error: 'bad key' });
      const score = cleanScore(key, b?.score); if (score === null) return send(res, 400, { error: 'bad score' });
      const { entries, rank } = insert(boards.get(key) || [], key, { name: cleanName(b?.name), score, t: Date.now() });
      if (rank) boards.set(key, entries);
      send(res, 200, { ok: true, rank, entries });
    });
    return;
  }
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(ROOT, path.normalize(p));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`drop wall at http://127.0.0.1:${PORT}/`));
