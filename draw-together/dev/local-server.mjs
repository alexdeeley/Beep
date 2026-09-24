// Zero-dependency local server that runs the real Worker + Durable Object code
// in plain Node (no Cloudflare account, no npm install).
//
//   node dev/local-server.mjs            → http://localhost:8787
//
// It emulates just enough of the Workers runtime: static assets, a Durable
// Object namespace, storage, alarms, and hibernatable WebSockets.
// For the real thing use `npx wrangler dev` (see README).

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8787);

const { default: worker } = await import(path.join(ROOT, 'src/worker.js'));
const { GameRoom } = await import(path.join(ROOT, 'src/game-room.js'));

// ── Durable Object emulation ─────────────────────────────────

class Storage {
  constructor(owner) { this.m = new Map(); this.owner = owner; this.alarmT = null; }
  async get(k) {
    if (Array.isArray(k)) { const r = new Map(); for (const x of k) if (this.m.has(x)) r.set(x, structuredClone(this.m.get(x))); return r; }
    return this.m.has(k) ? structuredClone(this.m.get(k)) : undefined;
  }
  async put(k, v) { this.m.set(k, structuredClone(v)); }
  async delete(k) { for (const x of [].concat(k)) this.m.delete(x); }
  async deleteAll() { this.m.clear(); }
  async setAlarm(t) {
    clearTimeout(this.alarmT);
    this.alarmT = setTimeout(() => this.owner.instance.alarm(), Math.max(0, t - Date.now()));
  }
}

class Ctx {
  constructor(owner) { this.sockets = new Set(); this.storage = new Storage(owner); }
  acceptWebSocket(ws) { this.sockets.add(ws); }
  getWebSockets() { return [...this.sockets]; }
  blockConcurrencyWhile(fn) { this.ready = Promise.resolve(fn()); return this.ready; }
  setWebSocketAutoResponse() {}
}

const objects = new Map();
function getObject(name) {
  if (!objects.has(name)) {
    const holder = {};
    holder.ctx = new Ctx(holder);
    holder.instance = new GameRoom(holder.ctx, {});
    objects.set(name, holder);
  }
  return objects.get(name);
}

const env = {
  ROOMS: {
    idFromName: (n) => n,
    get: (id) => ({
      fetch: async (input, init) => {
        const h = getObject(id);
        await h.ctx.ready;
        const req = input instanceof Request ? input : new Request(input, init);
        return h.instance.fetch(req);
      },
    }),
  },
};

// ── Minimal RFC 6455 WebSocket ───────────────────────────────

class ServerSocket {
  constructor(sock, onText, onClose) {
    this.sock = sock; this.readyState = 1; this.att = null;
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
  serializeAttachment(v) { this.att = structuredClone(v); }
  deserializeAttachment() { return this.att; }
}

// ── HTTP ─────────────────────────────────────────────────────

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await worker.fetch(new Request(url, { method: req.method, headers: req.headers, body }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  let file = path.join(PUBLIC, decodeURIComponent(url.pathname));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
  if (url.pathname === '/' ) file = path.join(PUBLIC, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
});

server.on('upgrade', async (req, sock) => {
  const m = /^\/api\/rooms\/([A-Za-z0-9]+)\/ws$/.exec(new URL(req.url, 'http://x').pathname);
  if (!m) { sock.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const h = getObject(m[1].toUpperCase());
  await h.ctx.ready;
  const ws = new ServerSocket(sock,
    (w, text) => h.instance.webSocketMessage(w, text).catch((e) => console.error(e)),
    (w) => { h.ctx.sockets.delete(w); h.instance.webSocketClose(w, 1006, '', false).catch((e) => console.error(e)); });
  h.instance.acceptSocket(ws);
});

server.listen(PORT, () => console.log(`Draw Together (local) → http://localhost:${PORT}`));
