// Local server: the real Worker and Table code running in plain Node, with
// no Cloudflare account. Serves ./public, the HTTP API and THE GAME's socket.
//
//   node dev/local-server.mjs          -> http://localhost:8787
//
// The game is kept in a JSON file (STATE_FILE) so it survives restarts, like
// the Durable Object's storage does in production.

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Table } from '../server/table.ts';
import worker, { originAllowed } from '../server/worker.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8787);
const QUIET = process.env.QUIET === '1';
const STATE_FILE = process.env.STATE_FILE ? path.resolve(process.env.STATE_FILE) : path.join(ROOT, '.soliteam-state.json');
const TIMESCALE = Number(process.env.TIMESCALE || 1);     // tests: a faster reset ceremony

const table = new Table({
  load: async () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return null; } },
  save: async (s) => fs.writeFileSync(STATE_FILE, JSON.stringify(s)),
  gameOffset: Number(process.env.GAME_OFFSET) || 0,
  moveOffset: Number(process.env.MOVE_OFFSET) || 0,
  timescale: TIMESCALE,
  log: QUIET ? undefined : (event, detail) => console.log(JSON.stringify({ soliteam: event, ...detail })),
});
setInterval(() => table.tick(), 5000 / TIMESCALE);

const env = {
  ENVIRONMENT: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  TABLE: {
    idFromName: (n) => n,
    get: () => ({
      async fetch(input) {
        const url = new URL(input instanceof Request ? input.url : input);
        if (url.pathname === '/table') { const s = table.snapshot(); return Response.json({ game: s.game, moves: s.moves, players: s.players, resetting: s.resetting, state: s.state }); }
        return Response.json({ error: 'not_found' }, { status: 404 });
      },
    }),
  },
};

// ── Minimal RFC 6455 WebSocket ───────────────────────────────

class ServerSocket {
  constructor(sock, onText, onClose) {
    this.sock = sock; this.readyState = 1;
    this.buf = Buffer.alloc(0); this.frag = [];
    sock.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.parse(onText); });
    const done = () => { if (this.readyState !== 3) { this.readyState = 3; onClose(this); } };
    sock.on('close', done); sock.on('error', done);
  }
  parse(onText) {
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      const mask = masked ? b.subarray(off, off + 4) : null;
      if (masked) off += 4;
      if (b.length < off + len) return;
      const payload = Buffer.from(b.subarray(off, off + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + len);
      if (op === 8) { this.close(1000); return; }
      if (op === 9) { this.frame(10, payload); continue; }
      if (op === 1 || op === 0) {
        this.frag.push(payload);
        if (fin) { const text = Buffer.concat(this.frag).toString('utf8'); this.frag = []; onText(this, text); }
      }
    }
  }
  frame(op, data) {
    if (this.readyState !== 1) return;
    const len = data.length;
    const head = len < 126 ? Buffer.from([0x80 | op, len])
      : len < 65536 ? Buffer.from([0x80 | op, 126, len >> 8, len & 255])
      : (() => { const h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2); return h; })();
    this.sock.write(Buffer.concat([head, data]));
  }
  send(s) { if (this.readyState !== 1) throw new Error('closed'); this.frame(1, Buffer.from(String(s), 'utf8')); }
  close(code = 1000) {
    if (this.readyState !== 1) return;
    const p = Buffer.alloc(2); p.writeUInt16BE(code);
    this.frame(8, p);
    this.readyState = 2;
    setTimeout(() => this.sock.destroy(), 50);
  }
}

// ── HTTP ─────────────────────────────────────────────────────

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.map': 'application/json',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/health' || url.pathname.startsWith('/api/')) {
    const r = await worker.fetch(new Request(url, { method: req.method, headers: req.headers }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  if (url.pathname === '/dev/stats') {                       // local only
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(table.stats()));
    return;
  }
  if (url.pathname === '/dev/set' && req.method === 'POST') {   // local only: swap in a whole table (the tests use it)
    const chunks = []; for await (const c of req) chunks.push(c);
    await table.replace(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    return;
  }
  let file = path.join(PUBLIC, decodeURIComponent(url.pathname));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

server.on('upgrade', async (req, socket) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const refuse = (code, text) => { socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`); socket.destroy(); };
  if (url.pathname !== '/api/ws') return refuse(404, 'Not Found');
  if (!originAllowed(req.headers.origin || null, req.headers.host, env)) return refuse(403, 'Forbidden');
  const key = req.headers['sec-websocket-key'];
  if (!key) return refuse(400, 'Bad Request');
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  let handle = null;
  const ws = new ServerSocket(socket, (_s, text) => { if (handle) void table.receive(handle, text); }, () => { if (handle) table.detach(handle); });
  handle = await table.attach({ send: (d) => ws.send(d), close: (c) => ws.close(c) });
});

table.whenReady().then(() => server.listen(PORT, () => console.log(`SOLITEAM  http://localhost:${PORT}   (game ${table.game}, ${table.moves} moves so far, state in ${path.relative(ROOT, STATE_FILE)})`)));
