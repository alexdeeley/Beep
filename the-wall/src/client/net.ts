import { getSessionId } from "./session.js";
import { OfflineQueue } from "./offline-queue.js";
import type { WallStore } from "./store.js";
import type { ClientMsg, ServerMsg, Operation, BBox } from "../shared/types.js";

export type ConnectionStatus = "connecting" | "online" | "offline";

/**
 * The realtime link to the server: connects, re-connects with backoff,
 * resumes from `lastSeq` on every (re)connect, and queues committed ops in
 * IndexedDB whenever the socket isn't open so nothing drawn offline is
 * lost. Failure is deliberately silent at this layer - the wall keeps
 * working locally regardless of connection state.
 */
export class WallNet {
  private ws: WebSocket | null = null;
  private backoffMs = 500;
  private readonly maxBackoffMs = 8000;
  private status: ConnectionStatus = "connecting";
  private pendingCommits = new Map<string, Operation>();
  private queue = new OfflineQueue();
  private currentViewport: BBox | null = null;
  private reconnectTimer: number | null = null;

  constructor(
    private store: WallStore,
    private onStatusChange: (s: ConnectionStatus) => void = () => {}
  ) {
    this.connect();
    window.addEventListener("online", () => this.connect());
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  private setStatus(s: ConnectionStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.onStatusChange(s);
  }

  private connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.setStatus("connecting");
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.backoffMs = 500;
      this.setStatus("online");
      this.send({
        type: "hello",
        sessionId: getSessionId(),
        lastSeq: this.store.headSeq,
        viewport: this.currentViewport ?? undefined,
      });
      void this.flushQueue();
    });
    ws.addEventListener("message", (ev) => this.handleMessage(ev.data as string));
    ws.addEventListener("close", () => this.scheduleReconnect());
    ws.addEventListener("error", () => {
      try {
        ws.close();
      } catch {
        /* already closing */
      }
    });
  }

  private scheduleReconnect(): void {
    this.setStatus("offline");
    if (this.reconnectTimer != null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.backoffMs + Math.random() * 200);
    this.backoffMs = Math.min(this.backoffMs * 1.7, this.maxBackoffMs);
  }

  private send(msg: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Called whenever the visible world region changes - controls which broadcasts this client receives. */
  updateViewport(bbox: BBox): void {
    this.currentViewport = bbox;
    this.send({ type: "viewport", bbox });
  }

  /** An in-progress stroke chunk - never persisted, just relayed live to other viewers. */
  sendChunk(op: Operation): void {
    this.send({ type: "op", op, final: false });
  }

  /** The authoritative commit. Queued locally until acked; retried on every reconnect. */
  async commitOp(op: Operation): Promise<void> {
    this.pendingCommits.set(op.id, op);
    await this.queue.enqueue(op);
    this.send({ type: "op", op, final: true });
  }

  private async flushQueue(): Promise<void> {
    const queued = await this.queue.all();
    for (const op of queued) {
      this.pendingCommits.set(op.id, op);
      this.send({ type: "op", op, final: true });
    }
  }

  private handleMessage(raw: string): void {
    let msg: ServerMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "ops") {
      for (const op of msg.ops) this.store.addCommitted(op);
      return;
    }

    if (msg.type === "ack") {
      const op = this.pendingCommits.get(msg.id);
      if (op) {
        this.pendingCommits.delete(msg.id);
        this.store.addCommitted({ ...op, seq: msg.seq } as Operation);
        void this.queue.remove(msg.id);
        if (this.store.localPending?.id === msg.id) this.store.localPending = null;
      }
      return;
    }

    if (msg.type === "live") {
      if (this.store.knownIds.has(msg.id)) return;
      if (msg.done) {
        this.store.liveStrokes.delete(msg.id);
        return;
      }
      this.store.liveStrokes.set(msg.id, {
        session: msg.session,
        color: msg.color,
        size: msg.size,
        points: msg.points,
      });
      return;
    }

    if (msg.type === "error" && msg.code === "resync-required") {
      this.store.resetAllTileCaches();
      return;
    }
  }
}
