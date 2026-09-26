import type { WebSocket, WebSocketServer } from "ws";
import type { IncomingMessage } from "node:http";
import type { Kysely } from "kysely";
import type { Schema } from "./db/index.js";
import { insertOperation, getOpsSince, getHeadSeq } from "./db/store.js";
import { warmTiles } from "./tiles.js";
import { shouldSnapshot, takeSnapshot } from "./snapshot.js";
import { validateOperation } from "../shared/validate.js";
import { tilesForBBox, bboxesIntersect, type TileIndex } from "../shared/coords.js";
import { MAX_MESSAGE_BYTES } from "../shared/types.js";
import type { ClientMsg, ServerMsg, Operation, PointSample } from "../shared/types.js";
import { TokenBucket, PER_CONNECTION_BUCKET, IpBucketRegistry, hashIp } from "./ratelimit.js";

/** A client is far enough behind that resending ops one at a time isn't worth it - tell it to refetch tiles instead. */
const BACKFILL_CAP = 5000;
/** Padding (world units) added around a subscribed viewport so scrolling a little doesn't immediately drop coverage. */
const SUBSCRIBE_PAD = 256;

interface ClientConn {
  socket: WebSocket;
  sessionId: string | null;
  subscribedTiles: Set<string>; // "tx,ty" at level 0
  bucket: TokenBucket;
  ipHash: string;
}

function tileSetKey(tx: number, ty: number): string {
  return `${tx},${ty}`;
}

function send(socket: WebSocket, msg: ServerMsg): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
}

export interface WallServer {
  headSeq: number;
  clients: Set<ClientConn>;
}

export function attachWebSocketServer(
  wss: WebSocketServer,
  db: Kysely<Schema>,
  initialHeadSeq: number
): WallServer {
  const state: WallServer = { headSeq: initialHeadSeq, clients: new Set() };
  const ipBuckets = new IpBucketRegistry();
  setInterval(() => ipBuckets.prune(), 60_000).unref();

  function tilesTouchedBy(op: Operation): TileIndex[] {
    return tilesForBBox(0, op.bbox);
  }

  function broadcast(op: Operation, exclude?: ClientConn): void {
    const touched = tilesTouchedBy(op);
    const keys = touched.map((t) => tileSetKey(t.tx, t.ty));
    for (const client of state.clients) {
      if (client === exclude) continue;
      if (client.subscribedTiles.size === 0) continue; // hasn't told us a viewport yet
      if (!keys.some((k) => client.subscribedTiles.has(k))) continue;
      send(client.socket, { type: "ops", ops: [op] });
    }
  }

  function broadcastLive(
    id: string,
    session: string,
    color: number,
    size: number,
    points: PointSample[],
    bbox: Operation["bbox"],
    done: boolean,
    exclude?: ClientConn
  ): void {
    const touched = tilesForBBox(0, bbox);
    const keys = touched.map((t) => tileSetKey(t.tx, t.ty));
    for (const client of state.clients) {
      if (client === exclude) continue;
      if (client.subscribedTiles.size === 0) continue;
      if (!keys.some((k) => client.subscribedTiles.has(k))) continue;
      send(client.socket, { type: "live", id, session, color, size, points, done });
    }
  }

  wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
    const forwardedFor = req.headers["x-forwarded-for"];
    const rawIp =
      (typeof forwardedFor === "string" ? forwardedFor.split(",")[0]?.trim() : undefined) ||
      req.socket.remoteAddress ||
      "unknown";
    const client: ClientConn = {
      socket,
      sessionId: null,
      subscribedTiles: new Set(),
      bucket: new TokenBucket(PER_CONNECTION_BUCKET.capacity, PER_CONNECTION_BUCKET.refillPerSecond),
      ipHash: hashIp(rawIp),
    };
    state.clients.add(client);

    socket.on("message", async (raw: Buffer, isBinary: boolean) => {
      if (isBinary || raw.length > MAX_MESSAGE_BYTES) return; // drop silently: oversized or unexpected binary frame
      if (!client.bucket.take() || !ipBuckets.take(client.ipHash)) return; // rate-limited: drop silently

      let msg: ClientMsg;
      try {
        msg = JSON.parse(raw.toString("utf8"));
      } catch {
        return; // malformed JSON: drop silently
      }
      if (!msg || typeof msg !== "object" || typeof (msg as { type?: unknown }).type !== "string") return;

      if (msg.type === "hello") {
        client.sessionId = typeof msg.sessionId === "string" ? msg.sessionId.slice(0, 128) : null;
        if (msg.viewport) {
          for (const t of tilesForBBox(0, msg.viewport)) client.subscribedTiles.add(tileSetKey(t.tx, t.ty));
        }
        send(socket, { type: "welcome", headSeq: state.headSeq });
        const lastSeq = typeof msg.lastSeq === "number" ? msg.lastSeq : 0;
        if (lastSeq < state.headSeq) {
          if (state.headSeq - lastSeq > BACKFILL_CAP) {
            send(socket, { type: "error", code: "resync-required" });
          } else {
            const ops = await getOpsSince(db, lastSeq);
            const relevant =
              client.subscribedTiles.size === 0
                ? ops
                : ops.filter((op) => tilesTouchedBy(op).some((t) => client.subscribedTiles.has(tileSetKey(t.tx, t.ty))));
            if (relevant.length > 0) send(socket, { type: "ops", ops: relevant });
          }
        }
        return;
      }

      if (msg.type === "viewport") {
        if (!msg.bbox) return;
        const padded = {
          minX: msg.bbox.minX - SUBSCRIBE_PAD,
          minY: msg.bbox.minY - SUBSCRIBE_PAD,
          maxX: msg.bbox.maxX + SUBSCRIBE_PAD,
          maxY: msg.bbox.maxY + SUBSCRIBE_PAD,
        };
        client.subscribedTiles = new Set(tilesForBBox(0, padded).map((t) => tileSetKey(t.tx, t.ty)));
        return;
      }

      if (msg.type === "op") {
        if (!client.sessionId) return; // must hello first
        const result = validateOperation(msg.op);
        if (!result.ok) return; // invalid: drop silently, never trust the client

        if (msg.final === false) {
          if (result.op.type !== "stroke") return; // only strokes have a meaningful in-progress phase
          broadcastLive(
            result.op.id,
            result.op.session,
            result.op.color,
            result.op.size,
            result.op.points,
            result.op.bbox,
            false,
            client
          );
          return;
        }

        const committed = await insertOperation(db, result.op);
        if (committed.seq && committed.seq > state.headSeq) state.headSeq = committed.seq;
        send(socket, { type: "ack", id: committed.id, seq: committed.seq! });
        broadcast(committed, client);
        if (committed.type === "stroke") {
          broadcastLive(committed.id, committed.session, committed.color, committed.size, committed.points, committed.bbox, true, client);
        }
        void warmTiles(db, tilesTouchedBy(committed));
        if (shouldSnapshot(committed.seq!)) void takeSnapshot(db, committed.seq!);
        return;
      }
    });

    socket.on("close", () => {
      state.clients.delete(client);
    });
    socket.on("error", () => {
      state.clients.delete(client);
    });
  });

  return state;
}

export async function bootHeadSeq(db: Kysely<Schema>): Promise<number> {
  return getHeadSeq(db);
}
