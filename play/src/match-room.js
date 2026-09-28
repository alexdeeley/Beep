// PLAY.DEELY.ORG — one Durable Object instance per match (a room that
// plays through several mini-game rounds together).
//
// The room is authoritative for everything: whose turn it is, every game's
// hidden state (only Big Blast has one - the dangerous button), every
// timer, and the score. Browsers only ever *ask* for things - the actual
// per-game rules live in ./games/*.js as small, isolated modules; this
// file only knows the generic *shape* every game shares (createState /
// handleAction / tick / isOver / getResult / view / nextAlarmAt), never
// the specifics of any one game. See DECISIONS.md.
//
// Uses the WebSocket Hibernation API: the object may be evicted from memory
// while sockets stay open, so everything important is persisted to storage
// and restored in the constructor.

import { GAMES, pickNextGame } from './games/index.js';
import {
  MIN_PLAYERS, MAX_PLAYERS, MAX_NAME, PLAYER_COLORS, GAME_REGISTRY,
  MATCH_LENGTHS, DEFAULT_MATCH_LENGTH, POINTS_FIRST, POINTS_SECOND,
} from '../public/js/shared.js';

const ROOM_TTL_MS = 12 * 60 * 60 * 1000; // idle rooms are wiped after 12 hours
const INTRO_MS = 1200;   // "GET READY" / "NEXT GAME" beat before a round begins
const RESULT_MS = 2600;  // "ROUND COMPLETE" beat showing who won this round and why

export class MatchRoom {
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

  // ── Alarm: the whole match clock ─────────────────────────
  // One alarm drives the intro beat, the result beat, idle-room cleanup,
  // and - via each game module's own nextAlarmAt() - every in-game timer
  // (a bomb's fuse, a rope's next pass, a reveal pause, and so on).

  async alarm() {
    const r = this.room;
    if (!r) return;
    const now = Date.now();

    if (this.connectedIds().size === 0 && now - r.lastActive >= ROOM_TTL_MS) {
      await this.ctx.storage.deleteAll();
      this.room = null;
      return;
    }

    if (r.status === 'playing' && r.gameState) {
      // A round can resolve purely from a timer (a fuse expiring, a reveal
      // pause ending) with no player action to piggyback the save/broadcast
      // on - do it here, or clients are stuck showing the pre-resolution
      // state forever (see DECISIONS.md).
      this.afterGameUpdate();
      this.save();
      this.broadcastState();
    } else if (r.deadlineAt != null && now >= r.deadlineAt - 30) {
      if (r.status === 'intro') this.beginPlaying();
      else if (r.status === 'result') await this.advanceAfterResult();
      this.save();
      this.broadcastState();
    }

    await this.scheduleAlarm();
  }

  async scheduleAlarm() {
    if (!this.room) return;
    const r = this.room;
    let when = Date.now() + ROOM_TTL_MS;
    if (r.status === 'playing' && r.gameState) {
      const mod = GAMES[r.currentGameId];
      const t = mod?.nextAlarmAt(r.gameState);
      if (t != null) when = Math.min(when, t);
    } else if (r.deadlineAt != null) {
      when = Math.min(when, r.deadlineAt);
    }
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

  isConnected(pid, excludeWs) { return this.connectedIds(excludeWs).has(pid); }

  // ── Sending ──────────────────────────────────────────────

  view(p) {
    const r = this.room;
    const connected = this.connectedIds();
    const mod = r.currentGameId ? GAMES[r.currentGameId] : null;
    return {
      type: 'state',
      you: p ? p.seat : null,
      host: r.players[0]?.seat ?? null,
      code: r.code,
      status: r.status,
      round: r.round,
      matchLength: r.matchLength,
      players: r.players.map((q) => ({
        seat: q.seat, name: q.name, color: q.color, ready: q.ready,
        connected: connected.has(q.id), score: q.score, wins: q.wins,
      })),
      currentGameId: r.currentGameId,
      gameState: r.gameState && mod ? mod.view(r.gameState) : null,
      lastResult: r.lastResult,
      finalWinners: r.finalWinners,
      highScoreCandidates: r.highScoreCandidates || [],
      leaderboardTop: r.leaderboardTop || null,
      deadlineAt: r.deadlineAt,
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

    if (!me && name) {
      me = r.players.find((p) => !this.isConnected(p.id) && p.name.toLowerCase() === name.toLowerCase());
      if (me) me.id = pid;
    }

    if (!me) {
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
      me = { id: pid, seat: r.nextSeat++, name: name || 'Player ' + r.nextSeat, color, ready: false, score: 0, wins: 0, gamesPlayed: 0, highScoreSubmitted: false };
      r.players.push(me);
      this.relay({ type: 'event', kind: 'joined', seat: me.seat, name: me.name });
    } else {
      if (name) me.name = name;
      this.relay({ type: 'event', kind: 'back', seat: me.seat, name: me.name });
    }

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

  // ── Match flow ────────────────────────────────────────────

  maybeAutoStart() {
    const r = this.room;
    if (r.status !== 'lobby') return;
    if (r.players.length < MIN_PLAYERS) return;
    if (!r.players.every((p) => p.ready)) return;
    this.beginIntro();
  }

  beginIntro() {
    const r = this.room;
    const seats = r.players.map((p) => p.seat);
    const g = pickNextGame(GAME_REGISTRY, seats.length, r.recentCategories, Math.random);
    r.currentGameId = g.id;
    r.recentCategories = [...r.recentCategories, g.category].slice(-3);
    r.round += 1;
    r.status = 'intro';
    r.deadlineAt = Date.now() + INTRO_MS;
    r.gameState = null;
    r.lastResult = null;
  }

  beginPlaying() {
    const r = this.room;
    const seats = r.players.map((p) => p.seat);
    const mod = GAMES[r.currentGameId];
    r.gameState = mod.createState(seats, Math.random);
    r.status = 'playing';
    r.deadlineAt = null;
  }

  // Called after every game action AND every alarm tick while playing -
  // some games (Color Panic) can resolve the instant everyone's answered,
  // well before their own deadline.
  afterGameUpdate() {
    const r = this.room;
    const mod = GAMES[r.currentGameId];
    mod.tick(r.gameState, Date.now(), Math.random);
    if (mod.isOver(r.gameState)) this.finishRound();
  }

  finishRound() {
    const r = this.room;
    const mod = GAMES[r.currentGameId];
    const { tiers, note } = mod.getResult(r.gameState);
    const totalPlayers = r.players.length;
    const points = {};
    tiers.forEach((tier, idx) => {
      const pts = pointsForTier(idx, totalPlayers);
      for (const seat of tier) points[seat] = pts;
    });
    for (const p of r.players) {
      p.score += points[p.seat] || 0;
      p.gamesPlayed += 1;
      if (tiers[0]?.includes(p.seat)) p.wins += 1;
    }
    r.lastResult = { gameId: r.currentGameId, tiers, note, points };
    r.status = 'result';
    r.deadlineAt = Date.now() + RESULT_MS;
    r.gameState = null;
  }

  async advanceAfterResult() {
    const r = this.room;
    if (r.round >= r.matchLength) await this.finishMatch();
    else this.beginIntro();
  }

  async finishMatch() {
    const r = this.room;
    const best = Math.max(...r.players.map((p) => p.score));
    r.finalWinners = r.players.filter((p) => p.score === best).map((p) => p.seat);
    r.status = 'matchover';
    r.deadlineAt = null;
    await this.refreshLeaderboard();
  }

  // Checks each player's final score against the shared Leaderboard DO and
  // records who's eligible to enter their name (view() exposes this so the
  // client only ever shows the prompt to a player the server has actually
  // confirmed qualifies - the client never decides this for itself).
  async refreshLeaderboard() {
    const r = this.room;
    const stub = this.leaderboardStub();
    try {
      const top = await (await stub.fetch('https://leaderboard/top')).json();
      r.leaderboardTop = top.entries;
      const candidates = [];
      for (const p of r.players) {
        if (p.highScoreSubmitted) continue;
        const check = await (await stub.fetch('https://leaderboard/check', {
          method: 'POST', body: JSON.stringify({ score: p.score }),
        })).json();
        if (check.qualifies) candidates.push(p.seat);
      }
      r.highScoreCandidates = candidates;
    } catch {
      // The leaderboard is a nice-to-have, never a reason a match can't end.
      r.leaderboardTop = r.leaderboardTop || [];
      r.highScoreCandidates = [];
    }
  }

  leaderboardStub() {
    return this.env.LEADERBOARD.get(this.env.LEADERBOARD.idFromName('global'));
  }

  // A player leaving mid-round is treated as an immediate forfeit: pulled
  // out of whatever the active game's own seat list is, generically (every
  // game module names its live-player array `seats`, and the handful of
  // other per-game fields that can reference a departed seat - `turnIdx`,
  // `holder` - are patched the same way regardless of which game is
  // running, rather than writing five bespoke leave handlers).
  removeFromActiveGame(seat) {
    const r = this.room;
    if (r.status !== 'playing' || !r.gameState) return;
    const gs = r.gameState;
    if (Array.isArray(gs.seats)) gs.seats = gs.seats.filter((s) => s !== seat);
    if (typeof gs.turnIdx === 'number' && gs.turnIdx >= gs.seats.length) gs.turnIdx = 0;
    if (gs.holder === seat) gs.holder = gs.seats[0];
    this.afterGameUpdate();
  }
}

function pointsForTier(tierIdx, totalPlayers) {
  if (tierIdx === 0) return POINTS_FIRST;
  if (totalPlayers > 2 && tierIdx === 1) return POINTS_SECOND;
  return 0;
}

// ── Message handlers (`this` is the MatchRoom) ──────────────

const HANDLERS = {
  async ready(me, msg) {
    const r = this.room;
    if (r.status !== 'lobby') return;
    me.ready = !!msg.ready;
    this.maybeAutoStart();
    this.save();
    this.broadcastState();
    await this.scheduleAlarm();
  },

  async setName(me, msg) {
    const r = this.room;
    if (r.status !== 'lobby') return;
    const name = cleanName(msg.name);
    if (name) me.name = name;
    this.save();
    this.broadcastState();
  },

  async gameAction(me, msg) {
    const r = this.room;
    if (r.status !== 'playing' || !r.gameState) return;
    const mod = GAMES[r.currentGameId];
    mod.handleAction(r.gameState, me.seat, msg.payload || {}, Date.now(), Math.random);
    this.afterGameUpdate();
    this.save();
    this.broadcastState();
    await this.scheduleAlarm();
  },

  async again(me) {
    const r = this.room;
    if (r.status !== 'matchover') return;
    for (const p of r.players) { p.score = 0; p.wins = 0; p.gamesPlayed = 0; p.ready = false; p.highScoreSubmitted = false; }
    r.round = 0;
    r.recentCategories = [];
    r.currentGameId = null;
    r.gameState = null;
    r.lastResult = null;
    r.finalWinners = null;
    r.highScoreCandidates = [];
    r.leaderboardTop = null;
    r.status = 'lobby';
    this.save();
    this.broadcastState();
  },

  // Matchover-only: a player the server has already confirmed qualifies
  // (see refreshLeaderboard()) submits a display name to attach to their
  // already-authoritative score. The client never gets to supply the score
  // itself - only ever the name.
  async submitHighScore(me, msg) {
    const r = this.room;
    if (r.status !== 'matchover') return;
    if (me.highScoreSubmitted || !r.highScoreCandidates?.includes(me.seat)) return;
    const name = cleanName(msg.name) || me.name;
    if (!name) return;
    try {
      const res = await this.leaderboardStub().fetch('https://leaderboard/submit', {
        method: 'POST', body: JSON.stringify({ name, score: me.score }),
      });
      if (!res.ok) return;
      const { entries } = await res.json();
      me.highScoreSubmitted = true;
      r.highScoreCandidates = r.highScoreCandidates.filter((s) => s !== me.seat);
      r.leaderboardTop = entries;
      this.save();
      this.broadcastState();
    } catch { /* leaderboard unreachable - the player's match result is unaffected */ }
  },

  // Host-only, lobby-only: remove someone before the match starts.
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
    this.removeFromActiveGame(me.seat);
    r.players = r.players.filter((p) => p.id !== me.id);
    if (r.players.length === 0) {
      r.status = 'lobby'; r.round = 0; r.currentGameId = null; r.gameState = null;
      r.lastResult = null; r.finalWinners = null; r.recentCategories = [];
      r.highScoreCandidates = []; r.leaderboardTop = null;
    } else if (r.status === 'lobby') {
      this.maybeAutoStart();
    }
    this.relay({ type: 'event', kind: 'left', name: me.name }, ws);
    ws.serializeAttachment({ pid: null });
    this.save();
    this.broadcastState(ws);
    try { ws.close(1000, 'left'); } catch {}
    await this.scheduleAlarm();
  },
};

// ── Helpers ─────────────────────────────────────────────────

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
    matchLength: MATCH_LENGTHS[DEFAULT_MATCH_LENGTH],
    round: 0,
    recentCategories: [],
    currentGameId: null,
    gameState: null,
    lastResult: null,
    finalWinners: null,
    highScoreCandidates: [],
    leaderboardTop: null,
    deadlineAt: null,
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
