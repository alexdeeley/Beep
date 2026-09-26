#!/usr/bin/env node
import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";

/**
 * Scripted concurrent-client load test. Not a unit test - it talks to a real,
 * already-running server (`npm run dev:server` or the built one) over real
 * WebSocket connections and reports actually-measured numbers: connect time,
 * ack latency percentiles, throughput, and how many ops never got acked.
 *
 * All simulated clients run in this one process, so they all share one real
 * source IP - the server's per-IP-hash rate limit bucket (see ratelimit.ts)
 * therefore applies across the WHOLE load test, not per simulated client.
 * That's a real, useful thing to measure (many users behind one NAT/proxy is
 * a realistic scenario), not a test artifact to work around.
 */

const NUM_CLIENTS = Number(process.env.LOAD_CLIENTS ?? 500);
const OPS_PER_CLIENT = Number(process.env.LOAD_OPS_PER_CLIENT ?? 5);
const WS_URL = process.env.LOAD_WS_URL ?? "ws://localhost:8787/ws";
const HTTP_URL = process.env.LOAD_HTTP_URL ?? "http://localhost:8787";

interface ClientResult {
  connectMs: number;
  ackLatencies: number[];
  unacked: number;
  connectFailed: boolean;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

async function runClient(index: number): Promise<ClientResult> {
  const result: ClientResult = { connectMs: 0, ackLatencies: [], unacked: 0, connectFailed: false };
  const connectStart = Date.now();
  const ws = new WebSocket(WS_URL);
  const pending = new Map<string, number>();

  try {
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        result.connectMs = Date.now() - connectStart;
        ws.send(JSON.stringify({ type: "hello", sessionId: `load-${index}`, lastSeq: 0 }));
        resolve();
      };
      ws.once("open", onOpen);
      ws.once("error", reject);
    });
  } catch {
    result.connectFailed = true;
    return result;
  }

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "ack" && pending.has(msg.id)) {
        result.ackLatencies.push(Date.now() - pending.get(msg.id)!);
        pending.delete(msg.id);
      }
    } catch {
      /* ignore malformed frames */
    }
  });

  for (let i = 0; i < OPS_PER_CLIENT; i++) {
    const id = randomUUID();
    const x = (index % 200) * 12 - 1200;
    const y = Math.floor(index / 200) * 12 - 200;
    const op = {
      id,
      type: "stroke" as const,
      session: `load-${index}`,
      color: index % 9,
      size: 0,
      points: [
        { x, y, p: 0.5 },
        { x: x + 6, y: y + 3, p: 0.5 },
      ],
      bbox: { minX: x, minY: y, maxX: x + 6, maxY: y + 3 },
    };
    pending.set(id, Date.now());
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "op", op, final: true }));
    await new Promise((r) => setTimeout(r, 20 + Math.random() * 30));
  }

  await new Promise((r) => setTimeout(r, 3000)); // let lagging acks arrive
  result.unacked = pending.size;
  ws.close();
  return result;
}

async function main(): Promise<void> {
  console.log(`[load-test] ${NUM_CLIENTS} clients x ${OPS_PER_CLIENT} ops each -> ${WS_URL}`);

  const before: number = await fetch(`${HTTP_URL}/api/ops?since=0`)
    .then((r) => r.json())
    .then((d: { ops: unknown[] }) => d.ops.length);

  const start = Date.now();
  const results = await Promise.all(Array.from({ length: NUM_CLIENTS }, (_, i) => runClient(i)));
  const durationMs = Date.now() - start;

  const after: number = await fetch(`${HTTP_URL}/api/ops?since=0`)
    .then((r) => r.json())
    .then((d: { ops: unknown[] }) => d.ops.length);

  const connected = results.filter((r) => !r.connectFailed);
  const allLatencies = connected.flatMap((r) => r.ackLatencies);
  const totalUnacked = connected.reduce((a, r) => a + r.unacked, 0);
  const totalSent = connected.length * OPS_PER_CLIENT;
  const connectFailures = results.length - connected.length;

  const report = {
    clients: NUM_CLIENTS,
    connectFailures,
    opsPerClient: OPS_PER_CLIENT,
    totalOpsSent: totalSent,
    opsCommittedServerSide: after - before,
    unackedClientSide: totalUnacked,
    durationMs,
    throughputOpsPerSec: Number(((after - before) / (durationMs / 1000)).toFixed(1)),
    connectMsP50: percentile(connected.map((r) => r.connectMs), 50),
    connectMsP95: percentile(connected.map((r) => r.connectMs), 95),
    ackLatencyMsP50: percentile(allLatencies, 50),
    ackLatencyMsP95: percentile(allLatencies, 95),
    ackLatencyMsP99: percentile(allLatencies, 99),
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error("[load-test] fatal", err);
  process.exit(1);
});
