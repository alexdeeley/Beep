// BLACKJACK — one Durable Object instance per table.
//
// The table is authoritative for the shoe, every hand, every chip stack,
// and the turn clock. Browsers only ever *ask* for things. There is no
// per-player secret here the way Draw Together hides the word: everyone at
// a real blackjack table sees every hand, so one broadcast state serves
// every client (only the dealer's hole card is hidden, and it's hidden
// identically for everybody until the dealer's turn).
//
// Uses the WebSocket Hibernation API: the object may be evicted from memory
// while sockets stay open, so everything important is persisted to storage
// and restored in the constructor.

import { createShoe, handValue, isBlackjack, dealerShouldHit, needsReshuffle } from './cards.js';
import { MAX_SEATS, MAX_NAME, STARTING_CHIPS, MIN_BET, MAX_BET, BETTING_SECONDS, TURN_SECONDS, REVEAL_MS, NUM_DECKS } from '../public/js/shared.js';

const ROOM_TTL_MS = 12 * 60 * 60 * 1000; // idle tables are wiped after 12 hours
const DEALER_CARD_DELAY_MS = 900;        // pacing between the dealer's own hits

export class TableRoom {
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
      const full = this.room.players.length >= MAX_SEATS &&
        this.room.players.every((p) => this.isConnected(p.id));
      return Response.json({ exists: true, full });
    }

    if (action === 'leaderboard') {
      if (!this.room) return Response.json({ exists: false });
      const rows = this.room.players.map((p) => ({ name: p.name, seat: p.seat, ...p.stats, chips: p.chips }));
      return Response.json({ exists: true, code: this.room.code, rows });
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

  // ── Alarm: the whole game clock ──────────────────────────
  // One alarm drives betting deadlines, turn deadlines, the dealer's own
  // pacing, the reveal pause, and idle-table cleanup - whichever the
  // current phase calls for.

  async alarm() {
    const r = this.room;
    if (!r) return;
    const now = Date.now();

    if (this.connectedIds().size === 0 && now - r.lastActive >= ROOM_TTL_MS) {
      await this.ctx.storage.deleteAll();
      this.room = null;
      return;
    }

    if (r.phase === 'lobby' || !r.deadlineAt || now < r.deadlineAt - 50) {
      await this.scheduleAlarm();
      return;
    }

    if (r.phase === 'betting') { await this.finishBetting(); return; }
    if (r.phase === 'playing') { await this.autoAdvanceTurn(); return; }
    if (r.phase === 'dealer') { await this.dealerStep(); return; }
    if (r.phase === 'reveal') { await this.startBetting(); return; }

    await this.scheduleAlarm();
  }

  async scheduleAlarm() {
    if (!this.room) return;
    let when = Date.now() + ROOM_TTL_MS;
    if (this.room.deadlineAt) when = Math.min(when, this.room.deadlineAt);
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
  // No per-player secrets (the dealer's hole card is hidden identically
  // for everyone), so every client gets the same state except `you`.

  view(p) {
    const r = this.room;
    const connected = this.connectedIds();
    return {
      type: 'state',
      you: p ? p.seat : null,
      host: r.players[0]?.seat ?? null,
      code: r.code,
      phase: r.phase,
      round: r.round,
      players: r.players.map((q) => ({
        seat: q.seat, name: q.name, chips: q.chips, connected: connected.has(q.id), stats: q.stats,
      })),
      dealer: {
        cards: r.dealer.holeHidden ? r.dealer.cards.slice(0, 1) : r.dealer.cards,
        holeHidden: r.dealer.holeHidden,
        total: r.dealer.holeHidden ? null : handValue(r.dealer.cards),
      },
      bets: r.bets,
      hands: r.hands,
      turnOrder: r.turnOrder,
      turnSeat: r.turnOrder[r.turnIdx] ?? null,
      turnHandIdx: r.turnHandIdx,
      deadlineAt: r.deadlineAt,
      serverNow: Date.now(),
      lastResults: r.lastResults,
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
      if (r.players.length >= MAX_SEATS) {
        safeSend(ws, JSON.stringify({ type: 'error', code: 'full' }));
        try { ws.close(4409, 'full'); } catch {}
        return;
      }
      me = {
        id: pid, seat: r.nextSeat++, name: name || 'Player ' + r.nextSeat, chips: STARTING_CHIPS,
        stats: newStats(),
      };
      r.players.push(me);
      this.relay({ type: 'event', kind: 'joined', seat: me.seat });
    } else {
      if (name) me.name = name;
      this.relay({ type: 'event', kind: 'back', seat: me.seat });
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

  // ── Dealing a fresh shoe / a single card ─────────────────

  ensureShoe() {
    const r = this.room;
    if (!r.shoe.length || needsReshuffle(r.shoe, NUM_DECKS)) r.shoe = createShoe(NUM_DECKS);
  }

  drawCard() {
    const r = this.room;
    if (!r.shoe.length) r.shoe = createShoe(NUM_DECKS);
    return r.shoe.pop();
  }

  // ── Betting phase ─────────────────────────────────────────

  async startBetting() {
    const r = this.room;
    if (r.players.length === 0) {
      r.phase = 'lobby'; r.deadlineAt = null;
      this.save(); this.broadcastState();
      return;
    }
    r.phase = 'betting';
    r.round += 1;
    r.bets = {};
    r.hands = {};
    r.dealer = { cards: [], holeHidden: true };
    r.turnOrder = [];
    r.turnIdx = 0;
    r.turnHandIdx = 0;
    r.lastResults = null;
    r.deadlineAt = Date.now() + BETTING_SECONDS * 1000;
    this.save();
    this.broadcastState();
    await this.scheduleAlarm();
  }

  async finishBetting() {
    const r = this.room;
    this.ensureShoe();
    r.turnOrder = r.players.filter((p) => r.bets[p.seat] != null).map((p) => p.seat);

    if (!r.turnOrder.length) { await this.startBetting(); return; } // nobody bet - try again

    for (const seat of r.turnOrder) {
      r.hands[seat] = [{ cards: [this.drawCard(), this.drawCard()], bet: r.bets[seat], status: 'active', doubled: false, fromSplit: false, result: null, payout: 0 }];
    }
    r.dealer.cards = [this.drawCard(), this.drawCard()];

    if (isBlackjack(r.dealer.cards)) {
      r.dealer.holeHidden = false;
      for (const seat of r.turnOrder) {
        const hand = r.hands[seat][0];
        hand.status = isBlackjack(hand.cards) ? 'push' : 'lose';
      }
      await this.resolveReveal();
      return;
    }

    // Naturals settle immediately - the dealer already doesn't have one, so
    // a player's blackjack is a guaranteed win regardless of anything else.
    for (const seat of r.turnOrder) {
      const hand = r.hands[seat][0];
      if (isBlackjack(hand.cards)) hand.status = 'blackjack';
    }

    r.phase = 'playing';
    r.turnIdx = 0;
    r.turnHandIdx = 0;
    this.advancePastResolvedHands();
    if (r.phase === 'playing') this.startTurnClock();
    this.save();
    this.broadcastState();
    await this.scheduleAlarm();
  }

  // ── Turn phase ────────────────────────────────────────────

  startTurnClock() {
    this.room.deadlineAt = Date.now() + TURN_SECONDS * 1000;
  }

  currentHand() {
    const r = this.room;
    const seat = r.turnOrder[r.turnIdx];
    if (seat == null) return null;
    return { seat, hand: r.hands[seat]?.[r.turnHandIdx] };
  }

  // Skips over hands that never need a player decision (already blackjack,
  // or split aces which only ever get one card) until it finds one that
  // does, or moves to the dealer once nobody is left.
  advancePastResolvedHands() {
    const r = this.room;
    while (r.turnIdx < r.turnOrder.length) {
      const seat = r.turnOrder[r.turnIdx];
      const hands = r.hands[seat];
      if (r.turnHandIdx >= hands.length) { r.turnIdx++; r.turnHandIdx = 0; continue; }
      const hand = hands[r.turnHandIdx];
      if (hand.status === 'active') return;
      r.turnHandIdx++;
    }
    this.enterDealerPhase();
  }

  async autoAdvanceTurn() {
    const cur = this.currentHand();
    if (cur?.hand?.status === 'active') cur.hand.status = 'stand';
    this.room.turnHandIdx++;
    this.advancePastResolvedHands();
    if (this.room.phase === 'playing') this.startTurnClock();
    this.save();
    this.broadcastState();
    await this.scheduleAlarm();
  }

  enterDealerPhase() {
    const r = this.room;
    r.phase = 'dealer';
    r.dealer.holeHidden = false;
    r.deadlineAt = Date.now() + DEALER_CARD_DELAY_MS;
  }

  async dealerStep() {
    const r = this.room;
    // If every player already busted, the dealer doesn't need to draw at
    // all - just reveal and settle.
    const anyoneLeft = r.turnOrder.some((seat) => r.hands[seat].some((h) => h.status !== 'bust'));
    if (anyoneLeft && dealerShouldHit(r.dealer.cards)) {
      r.dealer.cards.push(this.drawCard());
      r.deadlineAt = Date.now() + DEALER_CARD_DELAY_MS;
      this.save();
      this.broadcastState();
      await this.scheduleAlarm();
      return;
    }
    await this.resolveReveal();
  }

  // ── Resolution ────────────────────────────────────────────

  async resolveReveal() {
    const r = this.room;
    const dv = handValue(r.dealer.cards);
    const results = [];

    for (const seat of r.turnOrder) {
      const p = r.players.find((x) => x.seat === seat);
      if (!p) continue;
      for (const hand of r.hands[seat]) {
        if (!hand.result) {
          if (hand.status === 'blackjack') { hand.result = 'blackjack'; hand.payout = Math.round(hand.bet * 2.5); }
          else if (hand.status === 'push') { hand.result = 'push'; hand.payout = hand.bet; }
          else if (hand.status === 'bust') { hand.result = 'lose'; hand.payout = 0; }
          else if (dv.bust) { hand.result = 'win'; hand.payout = hand.bet * 2; }
          else {
            const hv = handValue(hand.cards);
            if (hv.total > dv.total) { hand.result = 'win'; hand.payout = hand.bet * 2; }
            else if (hv.total < dv.total) { hand.result = 'lose'; hand.payout = 0; }
            else { hand.result = 'push'; hand.payout = hand.bet; }
          }
        }
        p.chips += hand.payout;
        updateStats(p.stats, hand.result);
      }
      p.stats.biggestBankroll = Math.max(p.stats.biggestBankroll, p.chips);
      if (p.chips <= 0) p.chips = STARTING_CHIPS; // house restocks a busted-out player so the table keeps going
      results.push({ seat, name: p.name, hands: r.hands[seat].map((h) => ({ result: h.result, payout: h.payout, total: handValue(h.cards).total })) });
    }

    r.lastResults = { dealer: { cards: r.dealer.cards, total: dv.total, bust: dv.bust }, players: results };
    r.phase = 'reveal';
    r.deadlineAt = Date.now() + REVEAL_MS;
    this.save();
    this.broadcastState();
    await this.scheduleAlarm();
  }
}

// ── Message handlers (`this` is the TableRoom) ──────────────

const HANDLERS = {
  async start(me) {
    const r = this.room;
    if (r.phase !== 'lobby' || r.players[0]?.id !== me.id) return;
    await this.startBetting();
  },

  async bet(me, msg) {
    const r = this.room;
    if (r.phase !== 'betting' || r.bets[me.seat] != null) return;
    const amount = Math.floor(Number(msg.amount));
    if (!Number.isFinite(amount) || amount < MIN_BET || amount > Math.min(MAX_BET, me.chips)) return;
    me.chips -= amount;
    r.bets[me.seat] = amount;
    const seated = r.players.filter((p) => this.isConnected(p.id));
    if (seated.length && seated.every((p) => r.bets[p.seat] != null)) {
      await this.finishBetting();
    } else {
      this.save();
      this.broadcastState();
      await this.scheduleAlarm();
    }
  },

  async action(me, msg) {
    const r = this.room;
    if (r.phase !== 'playing' || r.turnOrder[r.turnIdx] !== me.seat) return;
    const hand = r.hands[me.seat]?.[r.turnHandIdx];
    if (!hand || hand.status !== 'active') return;
    const type = msg.action; // NOT msg.type - that field already routed us here

    if (type === 'hit') {
      hand.cards.push(this.drawCard());
      const hv = handValue(hand.cards);
      if (hv.bust) hand.status = 'bust';
      else if (hv.total === 21) hand.status = 'stand';
      else { this.startTurnClock(); this.save(); this.broadcastState(); await this.scheduleAlarm(); return; }
    } else if (type === 'stand') {
      hand.status = 'stand';
    } else if (type === 'double') {
      if (hand.cards.length !== 2 || hand.doubled || hand.fromSplit || me.chips < hand.bet) return;
      me.chips -= hand.bet;
      hand.bet *= 2;
      hand.doubled = true;
      hand.cards.push(this.drawCard());
      hand.status = handValue(hand.cards).bust ? 'bust' : 'stand';
    } else if (type === 'split') {
      const hands = r.hands[me.seat];
      if (hands.length !== 1 || hand.cards.length !== 2 || hand.fromSplit) return;
      if (hand.cards[0].rank !== hand.cards[1].rank) return;
      if (me.chips < hand.bet) return;
      me.chips -= hand.bet;
      const [c0, c1] = hand.cards;
      const isAces = c0.rank === 'A';
      const handA = { cards: [c0, this.drawCard()], bet: hand.bet, status: 'active', doubled: false, fromSplit: true, result: null, payout: 0 };
      const handB = { cards: [c1, this.drawCard()], bet: hand.bet, status: 'active', doubled: false, fromSplit: true, result: null, payout: 0 };
      // Split aces get exactly one card each, no further action - standard rule.
      if (isAces) { handA.status = 'stand'; handB.status = 'stand'; }
      r.hands[me.seat] = [handA, handB];
      this.advancePastResolvedHands();
      if (r.phase === 'playing') this.startTurnClock();
      this.save();
      this.broadcastState();
      await this.scheduleAlarm();
      return;
    } else {
      return;
    }

    r.turnHandIdx++;
    this.advancePastResolvedHands();
    if (r.phase === 'playing') this.startTurnClock();
    this.save();
    this.broadcastState();
    await this.scheduleAlarm();
  },

  async leave(me, msg, ws) {
    const r = this.room;
    r.players = r.players.filter((p) => p.id !== me.id);
    delete r.bets[me.seat];
    delete r.hands[me.seat];
    r.turnOrder = r.turnOrder.filter((s) => s !== me.seat);
    if (r.players.length === 0) { r.phase = 'lobby'; r.deadlineAt = null; }
    this.relay({ type: 'event', kind: 'left', name: me.name }, ws);
    ws.serializeAttachment({ pid: null });
    this.save();
    this.broadcastState(ws);
    try { ws.close(1000, 'left'); } catch {}
    await this.scheduleAlarm();
  },
};

// ── Helpers ─────────────────────────────────────────────────

function newStats() {
  return { handsPlayed: 0, handsWon: 0, pushes: 0, blackjacks: 0, currentStreak: 0, bestStreak: 0, biggestBankroll: STARTING_CHIPS };
}

function updateStats(stats, result) {
  stats.handsPlayed++;
  if (result === 'win' || result === 'blackjack') {
    stats.handsWon++;
    if (result === 'blackjack') stats.blackjacks++;
    stats.currentStreak++;
    stats.bestStreak = Math.max(stats.bestStreak, stats.currentStreak);
  } else if (result === 'lose') {
    stats.currentStreak = 0;
  } else if (result === 'push') {
    stats.pushes++;
    // A push doesn't break a streak - it's neither a win nor a loss.
  }
}

function newRoom(code) {
  return {
    code,
    createdAt: Date.now(),
    lastActive: Date.now(),
    players: [],
    nextSeat: 1,
    phase: 'lobby',
    round: 0,
    shoe: [],
    dealer: { cards: [], holeHidden: true },
    bets: {},
    hands: {},
    turnOrder: [],
    turnIdx: 0,
    turnHandIdx: 0,
    deadlineAt: null,
    lastResults: null,
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
