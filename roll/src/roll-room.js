// ROLL — one Durable Object instance per game room.
//
// The room is authoritative for the dice, whose turn it is, and every
// player's scorecard. Browsers only ever *ask* for things - roll, hold a
// die, or score a category - and the server decides whether that's legal
// and what the result is. Dice are never client-provided or client-seeded.
//
// Unlike Draw Together (a secret word) or Blackjack (a hidden hole card),
// Yahtzee has no hidden information at all once dice are rolled - every
// player's dice, holds, and full scorecard are public. So `view()` is the
// same for everyone except `you`, same as Blackjack.
//
// Uses the WebSocket Hibernation API: the object may be evicted from memory
// while sockets stay open, so everything important is persisted to storage
// and restored in the constructor.

import {
  rollDie, scoreCategory, isCategory, newCategories,
  upperTotal, upperBonus, grandTotal, CATEGORY_IDS, MAX_ROLLS, DICE_COUNT,
} from './scoring.js';
import { MIN_PLAYERS, MAX_PLAYERS, MAX_NAME, TOTAL_TURNS, PLAYER_COLORS } from '../public/js/shared.js';

const ROOM_TTL_MS = 12 * 60 * 60 * 1000; // idle rooms are wiped after 12 hours

export class RollRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.room = null;
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
  }

  save() {
    if (this.room) this.ctx.storage.put('room', this.room);
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
      return Response.json({
        exists: true,
        full: this.room.players.length >= MAX_PLAYERS,
        started: this.room.status !== 'lobby',
      });
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
    if (typeof raw !== 'string' || raw.length > 4096) return;
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

  async webSocketClose(ws) { try { ws.close(1000, 'bye'); } catch {} await this.onSocketGone(ws); }
  async webSocketError(ws) { await this.onSocketGone(ws); }

  async onSocketGone(ws) {
    if (!this.room) return;
    const pid = ws.deserializeAttachment()?.pid;
    if (!pid) return;
    if (this.isConnected(pid, ws)) return; // another socket already covers them
    this.room.lastActive = Date.now();
    this.save();
    this.broadcastState(ws);
  }

  // ── Alarm: idle-room cleanup only ────────────────────────
  // Unlike Blackjack's betting/turn clocks, Roll has no forced turn timer
  // (see DECISIONS.md) - the only thing the alarm does is wipe a room
  // nobody has touched in 12 hours.

  async alarm() {
    if (!this.room) return;
    const now = Date.now();
    if (this.connectedIds().size === 0 && now - this.room.lastActive >= ROOM_TTL_MS) {
      await this.ctx.storage.deleteAll();
      this.room = null;
      return;
    }
    await this.scheduleAlarm();
  }

  async scheduleAlarm() {
    if (!this.room) return;
    await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
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

  isConnected(pid, excludeWs) { return this.connectedIds(excludeWs).has(pid); }

  // ── Sending ──────────────────────────────────────────────

  view(p) {
    const r = this.room;
    const connected = this.connectedIds();
    const rolled = r.rollsUsed > 0;
    return {
      type: 'state',
      you: p ? p.seat : null,
      host: r.players[0]?.seat ?? null,
      code: r.code,
      status: r.status,
      round: r.turnOrder.length
        ? Math.min(TOTAL_TURNS, Math.floor(r.turnsTaken / r.turnOrder.length) + 1)
        : 1,
      totalRounds: TOTAL_TURNS,
      players: r.players.map((q) => ({
        seat: q.seat,
        name: q.name,
        color: q.color,
        connected: connected.has(q.id),
        categories: q.categories,
        upperTotal: upperTotal(q.categories),
        bonus: upperBonus(q.categories),
        total: grandTotal(q.categories),
      })),
      turnOrder: r.turnOrder,
      turnSeat: r.turnOrder[r.turnIdx] ?? null,
      dice: r.dice,
      held: r.held,
      rollsUsed: r.rollsUsed,
      maxRolls: MAX_ROLLS,
      // What each category *would* score right now, for every category -
      // the client just filters to whichever are still unfilled for the
      // current turn's player. Never computed client-side.
      preview: rolled ? Object.fromEntries(CATEGORY_IDS.map((id) => [id, scoreCategory(id, r.dice)])) : null,
      winnerSeats: r.winnerSeats,
      serverNow: Date.now(),
    };
  }

  broadcastState(excludeWs) {
    for (const w of this.sockets(excludeWs)) {
      const pid = w.deserializeAttachment()?.pid;
      const p = pid && this.room.players.find((q) => q.id === pid);
      safeSend(w, JSON.stringify(this.view(p || null)));
    }
  }

  relay(obj, exceptWs) {
    const s = JSON.stringify(obj);
    for (const w of this.sockets()) {
      if (w === exceptWs) continue;
      if (w.deserializeAttachment()?.pid) safeSend(w, s);
    }
  }

  // ── Handshake ────────────────────────────────────────────

  async onHello(ws, msg) {
    const r = this.room;
    const pid = cleanId(msg.playerId);
    const name = cleanName(msg.name);
    if (!pid) return;

    let me = r.players.find((p) => p.id === pid);

    // Lost their session token? Let them take back an empty seat with the
    // same name - the reconnection path works at any game status.
    if (!me && name) {
      me = r.players.find((p) => !this.isConnected(p.id) && p.name.toLowerCase() === name.toLowerCase());
      if (me) me.id = pid;
    }

    if (!me) {
      // A brand-new player can only join while the room is still in its
      // lobby - once a game is under way there's no fair way to slot
      // someone into a scorecard that's already partway filled.
      if (r.status !== 'lobby') {
        safeSend(ws, JSON.stringify({ type: 'error', code: 'started' }));
        try { ws.close(4409, 'started'); } catch {}
        return;
      }
      if (r.players.length >= MAX_PLAYERS) {
        safeSend(ws, JSON.stringify({ type: 'error', code: 'full' }));
        try { ws.close(4409, 'full'); } catch {}
        return;
      }
      const color = pickColor(r, cleanColor(msg.color));
      me = {
        id: pid, seat: r.nextSeat++, name: name || 'Player ' + r.nextSeat,
        color, categories: newCategories(),
      };
      r.players.push(me);
      this.relay({ type: 'event', kind: 'joined', seat: me.seat, name: me.name });
    } else {
      if (name) me.name = name;
      this.relay({ type: 'event', kind: 'back', seat: me.seat, name: me.name });
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
    this.save();
    this.broadcastState();
    await this.scheduleAlarm();
  }

  // ── Ending the game ───────────────────────────────────────

  finishGame() {
    const r = this.room;
    r.status = 'finished';
    let best = -Infinity;
    for (const seat of r.turnOrder) {
      const p = r.players.find((x) => x.seat === seat);
      if (p) best = Math.max(best, grandTotal(p.categories));
    }
    r.winnerSeats = r.turnOrder.filter((seat) => {
      const p = r.players.find((x) => x.seat === seat);
      return p && grandTotal(p.categories) === best;
    });
  }
}

// ── Message handlers (`this` is the RollRoom) ───────────────

const HANDLERS = {
  async start(me) {
    const r = this.room;
    if (r.status !== 'lobby' || r.players[0]?.id !== me.id || r.players.length < MIN_PLAYERS) return;
    beginRound(r, r.players.map((p) => p.seat));
    r.status = 'playing';
    this.save();
    this.broadcastState();
  },

  async roll(me) {
    const r = this.room;
    if (r.status !== 'playing' || r.turnOrder[r.turnIdx] !== me.seat) return;
    if (r.rollsUsed >= MAX_ROLLS) return;
    for (let i = 0; i < DICE_COUNT; i++) if (!r.held[i]) r.dice[i] = rollDie();
    r.rollsUsed++;
    this.save();
    this.broadcastState();
  },

  async hold(me, msg) {
    const r = this.room;
    if (r.status !== 'playing' || r.turnOrder[r.turnIdx] !== me.seat) return;
    // Nothing to hold before the first roll, and nothing left to protect
    // a die from once the last roll is spent.
    if (r.rollsUsed < 1 || r.rollsUsed >= MAX_ROLLS) return;
    const i = Number(msg.i);
    if (!Number.isInteger(i) || i < 0 || i >= DICE_COUNT) return;
    r.held[i] = !r.held[i];
    this.save();
    this.broadcastState();
  },

  async score(me, msg) {
    const r = this.room;
    if (r.status !== 'playing' || r.turnOrder[r.turnIdx] !== me.seat) return;
    if (r.rollsUsed < 1) return; // must roll at least once before scoring
    const id = String(msg.id || '');
    if (!isCategory(id) || me.categories[id] != null) return;

    me.categories[id] = scoreCategory(id, r.dice);
    r.turnsTaken++;
    r.turnIdx = (r.turnIdx + 1) % r.turnOrder.length;
    r.dice = zeroDice();
    r.held = zeroHeld();
    r.rollsUsed = 0;

    if (r.turnsTaken >= r.turnOrder.length * TOTAL_TURNS) this.finishGame();
    this.save();
    this.broadcastState();
  },

  async again(me) {
    const r = this.room;
    if (r.status !== 'finished' || r.players.length < MIN_PLAYERS) return;
    for (const p of r.players) p.categories = newCategories();
    beginRound(r, r.players.map((p) => p.seat));
    r.status = 'playing';
    this.save();
    this.broadcastState();
  },

  async lobby(me) {
    const r = this.room;
    if (r.status !== 'finished') return;
    for (const p of r.players) p.categories = newCategories();
    beginRound(r, []);
    r.status = 'lobby';
    this.save();
    this.broadcastState();
  },

  // Host-only, lobby-only: remove someone before the game starts. Once
  // playing starts the host has no special powers over anyone's turn.
  async kick(me, msg) {
    const r = this.room;
    if (r.status !== 'lobby' || r.players[0]?.id !== me.id) return;
    const seat = Number(msg.seat);
    const target = r.players.find((p) => p.seat === seat);
    if (!target || target.id === me.id) return;
    r.players = r.players.filter((p) => p.id !== target.id);
    for (const w of this.sockets()) {
      if (w.deserializeAttachment()?.pid === target.id) {
        safeSend(w, JSON.stringify({ type: 'error', code: 'kicked' }));
        try { w.close(4403, 'kicked'); } catch {}
      }
    }
    this.relay({ type: 'event', kind: 'kicked', name: target.name });
    this.save();
    this.broadcastState();
  },

  async leave(me, msg, ws) {
    const r = this.room;
    r.players = r.players.filter((p) => p.id !== me.id);
    const leftIdx = r.turnOrder.indexOf(me.seat);
    if (leftIdx !== -1) {
      const wasCurrentTurn = leftIdx === r.turnIdx;
      r.turnOrder.splice(leftIdx, 1);
      if (leftIdx < r.turnIdx) r.turnIdx--;
      if (r.turnOrder.length && r.turnIdx >= r.turnOrder.length) r.turnIdx = 0;
      if (wasCurrentTurn) { r.dice = zeroDice(); r.held = zeroHeld(); r.rollsUsed = 0; }
    }
    if (r.players.length === 0) { r.status = 'lobby'; r.turnOrder = []; r.turnIdx = 0; }
    this.relay({ type: 'event', kind: 'left', name: me.name }, ws);
    ws.serializeAttachment({ pid: null });
    this.save();
    this.broadcastState(ws);
    try { ws.close(1000, 'left'); } catch {}
    await this.scheduleAlarm();
  },
};

// ── Helpers ─────────────────────────────────────────────────

function beginRound(room, turnOrder) {
  room.turnOrder = turnOrder;
  room.turnIdx = 0;
  room.turnsTaken = 0;
  room.dice = zeroDice();
  room.held = zeroHeld();
  room.rollsUsed = 0;
  room.winnerSeats = null;
}

function zeroDice() { return new Array(DICE_COUNT).fill(0); }
function zeroHeld() { return new Array(DICE_COUNT).fill(false); }

function pickColor(room, requested) {
  const taken = new Set(room.players.map((p) => p.color));
  if (requested && !taken.has(requested)) return requested;
  return PLAYER_COLORS.find((c) => !taken.has(c)) || PLAYER_COLORS[room.players.length % PLAYER_COLORS.length];
}

function newRoom(code) {
  return {
    code,
    createdAt: Date.now(),
    lastActive: Date.now(),
    players: [],
    nextSeat: 1,
    status: 'lobby',
    turnOrder: [],
    turnIdx: 0,
    turnsTaken: 0,
    dice: zeroDice(),
    held: zeroHeld(),
    rollsUsed: 0,
    winnerSeats: null,
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

function cleanColor(v) {
  return typeof v === 'string' && PLAYER_COLORS.includes(v) ? v : null;
}
