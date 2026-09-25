// DRAW TOGETHER — one Durable Object instance per game room.
//
// The room is authoritative for players, roles, the secret word, the timer,
// scoring, and the drawing. Browsers only ever *ask* for things.
//
// Uses the WebSocket Hibernation API: the object may be evicted from memory
// while sockets stay open, so everything important is persisted to storage
// and restored in the constructor.

import { WORDS, pickWord, checkGuess, wordShape } from './words.js';
import {
  COORD_MAX, TOOLS, PALETTE, TIMER_OPTIONS, ROUND_OPTIONS, DIFFICULTIES, CATEGORIES,
  MAX_PLAYERS, MAX_POINTS_PER_MSG, MAX_NAME, WORD_SWAPS, ASPECT_MIN, ASPECT_MAX,
} from '../public/js/shared.js';

const ROOM_TTL_MS = 12 * 60 * 60 * 1000;   // idle rooms are wiped after 12 hours
const MAX_OPS_PER_ROUND = 4000;
const MAX_INTS_PER_STROKE = 40000;
const MAX_GUESS_LEN = 40;
const COLORS = new Set(PALETTE.map((p) => p.hex));
const CAT_IDS = new Set(CATEGORIES.map((c) => c.id));

const DEFAULT_SETTINGS = { timer: 60, rounds: 10, categories: ['everything'], difficulty: 'mixed' };

export class GameRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.room = null;     // persisted game state (without drawing ops)
    this.ops = [];        // completed drawing operations for the current round
    this.active = null;   // stroke currently being drawn (memory only)
    this.guessTimes = new Map();
    // Let clients keep sockets alive without waking the object.
    try {
      if (globalThis.WebSocketRequestResponsePair) {
        ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
      }
    } catch { /* not available locally */ }
    ctx.blockConcurrencyWhile(() => this.load());
  }

  // ── Persistence ──────────────────────────────────────────

  async load() {
    this.room = (await this.ctx.storage.get('room')) || null;
    if (this.room && !this.room.gallery) this.room.gallery = []; // rooms from before the gallery existed
    this.ops = [];
    if (this.room && this.room.opKeys.length) {
      const keys = this.room.opKeys.map((n) => 'op:' + n);
      for (let i = 0; i < keys.length; i += 128) {
        const got = await this.ctx.storage.get(keys.slice(i, i + 128));
        for (const k of keys.slice(i, i + 128)) { const op = got.get(k); if (op) this.ops.push(op); }
      }
    }
  }

  save() {
    if (this.room) this.ctx.storage.put('room', this.room);
  }

  // Deletes the current round's stroke ops from storage - only correct for
  // an abandoned, unfinished round (leaving mid-drawing) that never made it
  // into the gallery. A round that finished normally is archived into
  // r.gallery first (see endRound), so the transition into the next round
  // must NOT delete storage - see resetActiveOps.
  async wipeOps() {
    const keys = (this.room?.opKeys || []).map((n) => 'op:' + n);
    for (let i = 0; i < keys.length; i += 128) await this.ctx.storage.delete(keys.slice(i, i + 128));
    this.ops = [];
    this.active = null;
    if (this.room) this.room.opKeys = [];
  }

  // Clears the working set for a new round without touching storage, so
  // already-completed drawings (archived by endRound) stay available for
  // the gallery.
  resetActiveOps() {
    this.ops = [];
    this.active = null;
    if (this.room) this.room.opKeys = [];
  }

  pushOp(op) {
    const n = ++this.room.opSeq;
    op.n = n;
    this.ops.push(op);
    this.room.opKeys.push(n);
    this.ctx.storage.put('op:' + n, op);
    this.save();
  }

  // ── HTTP entry points (called by the Worker) ─────────────

  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.split('/').pop();

    if (action === 'init' && request.method === 'POST') {
      const { code } = await request.json();
      if (this.room) return new Response('taken', { status: 409 });
      this.room = newRoom(code);
      this.save();
      await this.scheduleAlarm();
      return Response.json({ code });
    }

    if (action === 'exists') {
      if (!this.room) return Response.json({ exists: false });
      const full = this.room.players.length >= MAX_PLAYERS &&
        this.room.players.every((p) => this.isConnected(p.id));
      return Response.json({ exists: true, full });
    }

    if (action === 'gallery') {
      if (!this.room) return Response.json({ exists: false });
      const entries = [];
      for (const g of this.room.gallery) {
        const keys = g.opKeys.map((n) => 'op:' + n);
        const ops = [];
        for (let i = 0; i < keys.length; i += 128) {
          const got = await this.ctx.storage.get(keys.slice(i, i + 128));
          for (const k of keys.slice(i, i + 128)) { const op = got.get(k); if (op) ops.push(op); }
        }
        entries.push({
          round: g.round, drawerName: g.drawerName, word: g.word, emoji: g.emoji, aspect: g.aspect, ops,
        });
      }
      return Response.json({ exists: true, code: this.room.code, entries });
    }

    if (action === 'ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426 });
      }
      const pair = new WebSocketPair();
      this.acceptSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    return new Response('Not found', { status: 404 });
  }

  acceptSocket(ws) {
    this.ctx.acceptWebSocket(ws);
    ws.serializeAttachment({ pid: null });
  }

  // ── WebSocket events (hibernation API) ───────────────────

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 65536) return;
    if (raw === 'ping') { safeSend(ws, 'pong'); return; }
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;

    if (!this.room) {
      safeSend(ws, JSON.stringify({ type: 'error', code: 'notfound' }));
      try { ws.close(4404, 'notfound'); } catch {}
      return;
    }

    if (msg.type === 'hello') return this.onHello(ws, msg);

    const pid = ws.deserializeAttachment()?.pid;
    const me = pid && this.room.players.find((p) => p.id === pid);
    if (!me) return; // must say hello first
    this.room.lastActive = Date.now();

    const handler = HANDLERS[msg.type];
    if (handler) await handler.call(this, me, msg, ws);
  }

  async webSocketClose(ws) {
    try { ws.close(1000, 'bye'); } catch {}
    await this.onSocketGone(ws);
  }

  async webSocketError(ws) {
    await this.onSocketGone(ws);
  }

  async onSocketGone(ws) {
    if (!this.room) return;
    const pid = ws.deserializeAttachment()?.pid;
    if (!pid) return;
    // Another socket may already have taken over for this player.
    if (this.isConnected(pid, ws)) return;
    // An abandoned stroke is finished so the drawing stays consistent.
    if (this.active && this.room.drawerSeat === this.seatOf(pid)) this.finishActive();
    this.room.lastActive = Date.now();
    this.syncPause(ws);
    this.save();
    this.broadcastState(ws);
    await this.scheduleAlarm(ws);
  }

  // ── Alarm: round timer + idle cleanup ────────────────────

  async alarm() {
    if (!this.room) return;
    const now = Date.now();
    const t = this.room.timer;
    if (this.room.phase === 'drawing' && t.running && now >= t.endsAt - 50) {
      await this.endRound('timeout');
      return;
    }
    if (this.connectedIds().size === 0 && now - this.room.lastActive >= ROOM_TTL_MS) {
      await this.ctx.storage.deleteAll();
      this.room = null;
      this.ops = [];
      this.active = null;
      return;
    }
    await this.scheduleAlarm();
  }

  async scheduleAlarm(excludeWs) {
    if (!this.room) return;
    const t = this.room.timer;
    let when = Date.now() + ROOM_TTL_MS;
    if (this.room.phase === 'drawing' && t.running) when = Math.min(when, t.endsAt);
    await this.ctx.storage.setAlarm(when);
  }

  // ── Connection bookkeeping ───────────────────────────────

  sockets(excludeWs) {
    return this.ctx.getWebSockets().filter((w) => w !== excludeWs && w.readyState !== 3 && w.readyState !== 2);
  }

  connectedIds(excludeWs) {
    const ids = new Set();
    for (const w of this.sockets(excludeWs)) {
      const pid = w.deserializeAttachment()?.pid;
      if (pid) ids.add(pid);
    }
    return ids;
  }

  isConnected(pid, excludeWs) {
    return this.connectedIds(excludeWs).has(pid);
  }

  seatOf(pid) {
    return this.room.players.find((p) => p.id === pid)?.seat;
  }

  // Pause the round timer while anyone is missing, resume when everyone is back.
  syncPause(excludeWs) {
    const r = this.room;
    if (r.phase !== 'drawing' || !r.settings.timer) return;
    const everyone = r.players.every((p) => this.isConnected(p.id, excludeWs));
    const t = r.timer;
    if (t.running && !everyone) {
      t.remaining = Math.max(0, t.endsAt - Date.now());
      t.running = false;
      t.endsAt = null;
    } else if (!t.running && everyone && t.remaining > 0) {
      t.endsAt = Date.now() + t.remaining;
      t.running = true;
    }
  }

  // ── Sending ──────────────────────────────────────────────

  view(p, excludeWs) {
    const r = this.room;
    const connected = this.connectedIds(excludeWs);
    const isDrawer = p.seat === r.drawerSeat;
    const showWord = isDrawer && (r.phase === 'choosing' || r.phase === 'drawing');
    return {
      type: 'state',
      you: p.seat,
      host: r.players[0]?.seat ?? null,
      code: r.code,
      phase: r.phase,
      round: r.round,
      rounds: r.settings.rounds,
      drawerSeat: r.drawerSeat,
      players: r.players.map((q) => ({
        seat: q.seat, name: q.name, score: q.score, connected: connected.has(q.id),
      })),
      settings: r.settings,
      // The secret word only ever goes to the drawer. Guessers get just
      // its shape (letter count and word breaks) once drawing starts.
      word: showWord ? { w: WORDS[r.wordIndex].w, e: WORDS[r.wordIndex].e } : null,
      wordShape: !isDrawer && r.phase === 'drawing' ? wordShape(WORDS[r.wordIndex].w) : null,
      swapsLeft: isDrawer ? r.swapsLeft : 0,
      aspect: r.aspect,
      timer: { ...r.timer, duration: r.settings.timer * 1000 },
      serverNow: Date.now(),
      guesses: r.guesses,
      result: r.result,
      drawings: r.drawings,
    };
  }

  broadcastState(excludeWs) {
    for (const w of this.sockets(excludeWs)) {
      const pid = w.deserializeAttachment()?.pid;
      const p = pid && this.room.players.find((q) => q.id === pid);
      if (p) safeSend(w, JSON.stringify(this.view(p, excludeWs)));
    }
  }

  // Send a message to every identified socket except `exceptWs`.
  relay(obj, exceptWs) {
    const s = JSON.stringify(obj);
    for (const w of this.sockets()) {
      if (w === exceptWs) continue;
      if (w.deserializeAttachment()?.pid) safeSend(w, s);
    }
  }

  sendBoard(ws) {
    safeSend(ws, JSON.stringify({
      type: 'board', round: this.room.round, ops: this.ops, active: this.active,
    }));
  }

  // ── Handshake ────────────────────────────────────────────

  async onHello(ws, msg) {
    const r = this.room;
    const pid = cleanId(msg.playerId);
    const name = cleanName(msg.name);
    if (!pid) return;

    let me = r.players.find((p) => p.id === pid);

    // Lost their session token? Let them take back an empty seat with the same name.
    if (!me && name) {
      me = r.players.find((p) => !this.isConnected(p.id) &&
        p.name.toLowerCase() === name.toLowerCase());
      if (me) me.id = pid;
    }

    if (!me) {
      if (r.players.length >= MAX_PLAYERS || r.phase !== 'lobby') {
        safeSend(ws, JSON.stringify({ type: 'error', code: 'full' }));
        try { ws.close(4409, 'full'); } catch {}
        return;
      }
      me = { id: pid, seat: r.nextSeat++, name: name || 'Player ' + r.nextSeat, score: 0 };
      r.players.push(me);
      this.relay({ type: 'event', kind: 'joined', seat: me.seat });
    } else {
      if (name) me.name = name;
      this.relay({ type: 'event', kind: 'back', seat: me.seat });
    }

    // Replace any older socket for the same player (no duplicate players).
    for (const w of this.sockets(ws)) {
      if (w.deserializeAttachment()?.pid === pid) {
        safeSend(w, JSON.stringify({ type: 'error', code: 'replaced' }));
        try { w.close(4000, 'replaced'); } catch {}
      }
    }
    ws.serializeAttachment({ pid });

    r.lastActive = Date.now();
    this.syncPause();
    this.save();
    this.sendBoard(ws);
    this.broadcastState();
    await this.scheduleAlarm();
  }

  // ── Round flow ───────────────────────────────────────────

  async startRound() {
    const r = this.room;
    this.resetActiveOps();
    const seats = r.players.map((p) => p.seat);
    r.drawerSeat = seats[(r.round - 1) % seats.length];
    this.chooseWord();
    r.swapsLeft = WORD_SWAPS;
    r.phase = 'choosing';
    r.guesses = [];
    r.result = null;
    r.timer = { running: false, endsAt: null, remaining: r.settings.timer * 1000 };
    this.save();
    this.relay({ type: 'board', round: r.round, ops: [], active: null });
    this.broadcastState();
    await this.scheduleAlarm();
  }

  chooseWord() {
    const r = this.room;
    const { index, reset } = pickWord(r.settings, r.used);
    if (reset) r.used = [];
    r.used.push(index);
    r.wordIndex = index;
  }

  async endRound(reason, winner) {
    const r = this.room;
    if (r.phase !== 'drawing') return;
    this.finishActive();
    const entry = WORDS[r.wordIndex];
    let points = 0;
    if (reason === 'correct') {
      points = 3;
      if (r.settings.timer) {
        const left = r.timer.running ? r.timer.endsAt - Date.now() : r.timer.remaining;
        if (left > 40000) points += 2;
        else if (left > 20000) points += 1;
      }
      winner.score += points;
    }
    r.timer = { running: false, endsAt: null, remaining: 0 };
    r.phase = 'reveal';
    r.drawings += 1;
    r.result = {
      reason,
      word: entry.w,
      emoji: entry.e,
      winnerSeat: winner ? winner.seat : null,
      drawerSeat: r.drawerSeat,
      points,
    };
    // Archive the finished drawing (ops stay in storage - see
    // resetActiveOps) so it can be viewed/exported from the gallery even
    // after the next round starts or the game ends.
    const drawerP = r.players.find((p) => p.seat === r.drawerSeat);
    r.gallery.push({
      round: r.round,
      drawerSeat: r.drawerSeat,
      drawerName: drawerP?.name || 'Someone',
      word: entry.w,
      emoji: entry.e,
      aspect: r.aspect,
      opKeys: r.opKeys.slice(),
    });
    this.save();
    this.broadcastState();
    await this.scheduleAlarm();
  }

  finishActive() {
    if (!this.active) return;
    const op = this.active;
    this.active = null;
    this.pushOp(op);
    this.relay({ type: 'strokeEnd', id: op.id });
  }

  resetToLobby() {
    const r = this.room;
    r.phase = 'lobby';
    r.round = 0;
    r.drawerSeat = null;
    r.result = null;
    r.guesses = [];
    r.drawings = 0;
    r.timer = { running: false, endsAt: null, remaining: 0 };
    for (const p of r.players) p.score = 0;
  }
}

// ── Message handlers (`this` is the GameRoom) ───────────────

const HANDLERS = {
  async settings(me, msg) {
    const r = this.room;
    if (r.phase !== 'lobby' || r.players[0]?.id !== me.id) return;
    const s = msg.settings || {};
    const next = { ...r.settings };
    if (TIMER_OPTIONS.includes(s.timer)) next.timer = s.timer;
    if (ROUND_OPTIONS.includes(s.rounds)) next.rounds = s.rounds;
    if (DIFFICULTIES.includes(s.difficulty)) next.difficulty = s.difficulty;
    if (Array.isArray(s.categories)) {
      let cats = [...new Set(s.categories.filter((c) => CAT_IDS.has(c)))];
      if (!cats.length || cats.includes('everything')) cats = ['everything'];
      next.categories = cats;
    }
    r.settings = next;
    this.save();
    this.broadcastState();
  },

  async start(me) {
    const r = this.room;
    if (r.phase !== 'lobby' || r.players[0]?.id !== me.id || r.players.length < 2) return;
    for (const p of r.players) p.score = 0;
    r.round = 1;
    r.drawings = 0;
    r.gallery = [];
    // Keep every player's turn count equal: round the chosen length to
    // the nearest whole number of turns each, never zero.
    const n = r.players.length;
    r.settings.rounds = Math.max(n, Math.round(r.settings.rounds / n) * n);
    await this.startRound();
  },

  async swap(me) {
    const r = this.room;
    if (r.phase !== 'choosing' || me.seat !== r.drawerSeat || r.swapsLeft <= 0) return;
    r.swapsLeft -= 1;
    this.chooseWord();
    this.save();
    this.broadcastState();
  },

  async ready(me, msg) {
    const r = this.room;
    if (r.phase !== 'choosing' || me.seat !== r.drawerSeat) return;
    const a = Number(msg.aspect);
    r.aspect = Number.isFinite(a) ? Math.min(ASPECT_MAX, Math.max(ASPECT_MIN, a)) : 1;
    r.phase = 'drawing';
    const ms = r.settings.timer * 1000;
    r.timer = ms ? { running: true, endsAt: Date.now() + ms, remaining: ms } : { running: false, endsAt: null, remaining: 0 };
    this.syncPause();
    this.save();
    this.broadcastState();
    await this.scheduleAlarm();
  },

  async strokeStart(me, msg, ws) {
    const r = this.room;
    if (r.phase !== 'drawing' || me.seat !== r.drawerSeat) return;
    const tool = TOOLS[msg.tool] ? msg.tool : null;
    const id = cleanId(msg.id);
    if (!tool || !id) return;
    if (!TOOLS[tool].sizes.includes(msg.size)) return;
    const color = tool === 'eraser' ? '#ffffff' : (COLORS.has(msg.color) ? msg.color : null);
    if (!color) return;
    if (this.ops.length >= MAX_OPS_PER_ROUND) return;
    if (this.active) this.finishActive();
    const pts = cleanPoints(msg.pts);
    if (!pts || pts.length < 2) return;
    this.active = { id, type: 'stroke', tool, color, size: msg.size, pts };
    this.relay({ type: 'strokeStart', id, tool, color, size: msg.size, pts }, ws);
  },

  async strokePoints(me, msg, ws) {
    const a = this.active;
    if (!a || a.id !== msg.id || me.seat !== this.room.drawerSeat) return;
    const pts = cleanPoints(msg.pts);
    if (!pts || a.pts.length + pts.length > MAX_INTS_PER_STROKE) return;
    for (const v of pts) a.pts.push(v);
    this.relay({ type: 'strokePoints', id: a.id, pts }, ws);
  },

  async strokeEnd(me, msg, ws) {
    const a = this.active;
    if (!a || a.id !== msg.id || me.seat !== this.room.drawerSeat) return;
    this.active = null;
    this.pushOp(a);
    this.relay({ type: 'strokeEnd', id: a.id }, ws);
  },

  async undo(me) {
    const r = this.room;
    if (r.phase !== 'drawing' || me.seat !== r.drawerSeat || this.active) return;
    const op = this.ops.pop();
    if (!op) return;
    r.opKeys = r.opKeys.filter((n) => n !== op.n);
    this.ctx.storage.delete('op:' + op.n);
    this.save();
    this.relay({ type: 'undo', id: op.id });
  },

  async clear(me, msg) {
    const r = this.room;
    if (r.phase !== 'drawing' || me.seat !== r.drawerSeat) return;
    const id = cleanId(msg.id);
    if (!id) return;
    if (this.active) this.finishActive();
    // Clear is itself an operation, so Undo can bring the drawing back.
    this.pushOp({ id, type: 'clear' });
    this.relay({ type: 'clear', id });
  },

  async guess(me, msg) {
    const r = this.room;
    if (r.phase !== 'drawing' || me.seat === r.drawerSeat) return;
    const text = String(msg.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_GUESS_LEN);
    if (!text) return;
    const now = Date.now();
    const last = this.guessTimes.get(me.id) || 0;
    if (now - last < 350) return; // gentle rate limit
    this.guessTimes.set(me.id, now);

    const verdict = checkGuess(text, WORDS[r.wordIndex]);
    const g = { seat: me.seat, text: verdict === 'correct' ? WORDS[r.wordIndex].w : text, verdict, t: now };
    r.guesses = [...r.guesses, g].slice(-12);
    if (verdict === 'correct') {
      await this.endRound('correct', me);
    } else {
      this.save();
      this.relay({ type: 'guess', guess: g });
    }
  },

  async giveup(me) {
    const r = this.room;
    if (r.phase !== 'drawing' || me.seat === r.drawerSeat) return;
    await this.endRound('gaveup');
  },

  async next(me) {
    const r = this.room;
    if (r.phase !== 'reveal') return;
    if (r.round >= r.settings.rounds) {
      r.phase = 'over';
      this.resetActiveOps();
      this.save();
      this.broadcastState();
      return;
    }
    r.round += 1;
    await this.startRound();
  },

  async again(me) {
    const r = this.room;
    if (r.phase !== 'over' || r.players.length < 2) return;
    for (const p of r.players) p.score = 0;
    r.round = 1;
    r.drawings = 0;
    r.gallery = [];
    const n = r.players.length;
    r.settings.rounds = Math.max(n, Math.round(r.settings.rounds / n) * n);
    await this.startRound();
  },

  async lobby(me) {
    const r = this.room;
    if (r.phase !== 'over') return;
    this.resetToLobby();
    this.save();
    this.broadcastState();
  },

  async leave(me, msg, ws) {
    const r = this.room;
    r.players = r.players.filter((p) => p.id !== me.id);
    if (r.phase !== 'lobby') {
      await this.wipeOps();
      this.resetToLobby();
    }
    this.relay({ type: 'event', kind: 'left', name: me.name }, ws);
    ws.serializeAttachment({ pid: null });
    this.save();
    this.broadcastState(ws);
    try { ws.close(1000, 'left'); } catch {}
    await this.scheduleAlarm(ws);
  },
};

// ── Helpers ─────────────────────────────────────────────────

function newRoom(code) {
  return {
    code,
    createdAt: Date.now(),
    lastActive: Date.now(),
    players: [],
    nextSeat: 1,
    settings: { ...DEFAULT_SETTINGS },
    phase: 'lobby',
    round: 0,
    drawerSeat: null,
    wordIndex: null,
    used: [],
    swapsLeft: 0,
    aspect: 1,
    timer: { running: false, endsAt: null, remaining: 0 },
    guesses: [],
    result: null,
    drawings: 0,
    opSeq: 0,
    opKeys: [],
    gallery: [],
  };
}

function safeSend(ws, data) {
  try { ws.send(data); } catch { /* socket already gone */ }
}

function cleanId(v) {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{4,40}$/.test(v) ? v : null;
}

function cleanName(v) {
  return String(v || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

function cleanPoints(p) {
  if (!Array.isArray(p) || p.length % 2 || p.length > MAX_POINTS_PER_MSG * 2) return null;
  for (const v of p) if (!Number.isInteger(v) || v < 0 || v > COORD_MAX) return null;
  return p;
}
