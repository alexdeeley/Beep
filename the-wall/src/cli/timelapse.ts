#!/usr/bin/env node
import { Command } from "commander";
import { createCanvas } from "@napi-rs/canvas";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Kysely } from "kysely";
import { createDb, loadDbConfig, type Schema } from "../server/db/index.js";
import { renderOperation, type DrawContext2D } from "../shared/draw.js";
import { PALETTE } from "../shared/palette.js";
import { bboxesIntersect } from "../shared/coords.js";
import type { Operation, BBox, StrokeOp, PixelsOp } from "../shared/types.js";

export interface Options {
  from: string;
  to: string;
  mode: "full" | "region";
  bbox?: string;
  duration: number;
  fps: number;
  granularity: "op" | "point";
  out: string;
}

// ---------------------------------------------------------------------------
// Fetch the raw operation log (never screen captures) for the requested range.
// ---------------------------------------------------------------------------

async function fetchOps(db: Kysely<Schema>, from: string, to: string): Promise<Operation[]> {
  let q = db.selectFrom("operations").selectAll().orderBy("seq", "asc");
  const fromSeq = Number(from);
  const toSeq = Number(to);
  if (from && !Number.isNaN(fromSeq)) q = q.where("seq", ">=", fromSeq);
  else if (from) q = q.where("ts", ">=", Date.parse(from));
  if (to && !Number.isNaN(toSeq)) q = q.where("seq", "<=", toSeq);
  else if (to) q = q.where("ts", "<=", Date.parse(to));

  const rows = await q.execute();
  return (rows as any[]).map((row) => {
    const payload = JSON.parse(row.payload);
    const base = {
      id: row.id,
      seq: row.seq,
      ts: row.ts,
      session: row.session,
      color: row.color,
      bbox: { minX: row.min_x, minY: row.min_y, maxX: row.max_x, maxY: row.max_y },
    };
    if (row.type === "stroke") return { ...base, type: "stroke", size: payload.size, points: payload.points } as StrokeOp;
    if (row.type === "pixels") return { ...base, type: "pixels", cell: payload.cell, cells: payload.cells } as PixelsOp;
    return { ...base, type: "hide", targetIds: payload.targetIds } as Operation;
  });
}

async function fetchHiddenIds(db: Kysely<Schema>): Promise<Set<string>> {
  const rows = await db.selectFrom("operations").select(["payload"]).where("type", "=", "hide").execute();
  const hidden = new Set<string>();
  for (const r of rows as any[]) {
    try {
      const payload = JSON.parse(r.payload);
      for (const id of payload.targetIds ?? []) hidden.add(id);
    } catch {
      /* ignore */
    }
  }
  return hidden;
}

// ---------------------------------------------------------------------------
// Time compression: allocate frames by activity, not by operation count.
// A minimum per-step "distance" stretches a dense burst of near-simultaneous
// operations across several frames instead of popping them in at once; a
// capped maximum "distance" collapses a long idle gap down to a beat instead
// of it eating a proportional share of the video. `opsPerFrameCap` is the
// second half of that: even a burst that already has enough compressed
// distance between its members is additionally forced to spread out if more
// than the cap would land in one frame.
// ---------------------------------------------------------------------------

interface RevealEvent {
  op: Operation;
  ts: number;
  prefixLength?: number; // point/cell granularity only: reveal only the first N points/cells of this op
}

export function explodeForGranularity(ops: Operation[], granularity: "op" | "point"): RevealEvent[] {
  if (granularity === "op") return ops.map((op) => ({ op, ts: op.ts ?? 0 }));
  const events: RevealEvent[] = [];
  for (const op of ops) {
    const count = op.type === "stroke" ? op.points.length : op.type === "pixels" ? op.cells.length : 1;
    if (count <= 1) {
      events.push({ op, ts: op.ts ?? 0 });
      continue;
    }
    for (let k = 1; k <= count; k++) events.push({ op, ts: op.ts ?? 0, prefixLength: k });
  }
  return events;
}

/**
 * Returns one array of events per frame. `totalFrames` is a target, not a
 * hard cap: the per-frame cap always wins, so a burst with more events than
 * `totalFrames * opsPerFrameCap` can hold pushes the timeline longer rather
 * than silently violating the cap. The caller renders however many frames
 * come back, which only ever exceeds `totalFrames` for a pathologically
 * dense burst - the ordinary case returns exactly `totalFrames`.
 */
export function buildTimeline(events: RevealEvent[], totalFrames: number, opsPerFrameCap: number): RevealEvent[][] {
  if (events.length === 0) return Array.from({ length: totalFrames }, () => []);

  const MIN_GAP_MS = 15;
  const MAX_GAP_MS = 4000;
  const compressed = [0];
  for (let i = 1; i < events.length; i++) {
    const real = events[i]!.ts - events[i - 1]!.ts;
    compressed.push(compressed[i - 1]! + Math.min(Math.max(real, MIN_GAP_MS), MAX_GAP_MS));
  }
  const total = compressed[compressed.length - 1] || 1;

  const frames: RevealEvent[][] = [[]];
  let frameIdx = 0;
  let countThisFrame = 0;
  for (let i = 0; i < events.length; i++) {
    const target = Math.min(totalFrames - 1, Math.floor((compressed[i]! / total) * (totalFrames - 1)));
    if (target > frameIdx) {
      frameIdx = target;
      while (frames.length <= frameIdx) frames.push([]);
      countThisFrame = 0;
    }
    if (countThisFrame >= opsPerFrameCap) {
      frameIdx++;
      frames.push([]);
      countThisFrame = 0;
    }
    frames[frameIdx]!.push(events[i]!);
    countThisFrame++;
  }
  while (frames.length < totalFrames) frames.push([]);
  return frames;
}

function truncateOp(op: Operation, prefixLength: number): Operation {
  if (op.type === "stroke") return { ...op, points: op.points.slice(0, prefixLength) };
  if (op.type === "pixels") return { ...op, cells: op.cells.slice(0, prefixLength) };
  return op;
}

// ---------------------------------------------------------------------------
// Camera: "full" eases to contain the growing artwork; "region" is fixed.
// ---------------------------------------------------------------------------

interface Cam {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function padBBox(b: BBox, padFrac = 0.12): Cam {
  const w = Math.max(b.maxX - b.minX, 20);
  const h = Math.max(b.maxY - b.minY, 20);
  const px = w * padFrac + 20;
  const py = h * padFrac + 20;
  return { minX: b.minX - px, minY: b.minY - py, maxX: b.maxX + px, maxY: b.maxY + py };
}

function lerpCam(a: Cam, b: Cam, t: number): Cam {
  return {
    minX: a.minX + (b.minX - a.minX) * t,
    minY: a.minY + (b.minY - a.minY) * t,
    maxX: a.maxX + (b.maxX - a.maxX) * t,
    maxY: a.maxY + (b.maxY - a.maxY) * t,
  };
}

// ---------------------------------------------------------------------------

const WIDTH = 1280;
const HEIGHT = 720;

export async function run(opts: Options): Promise<void> {
  const db = createDb(loadDbConfig());
  const [ops, hidden] = await Promise.all([fetchOps(db, opts.from, opts.to), fetchHiddenIds(db)]);
  const visibleOps = ops.filter((op) => !hidden.has(op.id));

  const totalFrames = Math.max(1, Math.round(opts.duration * opts.fps));
  const OPS_PER_FRAME_CAP = 6;
  const events = explodeForGranularity(visibleOps, opts.granularity);
  const timeline = buildTimeline(events, totalFrames, OPS_PER_FRAME_CAP);
  const frameCount = timeline.length;
  if (frameCount > totalFrames) {
    console.log(`[timelapse] stretching to ${frameCount} frames (${(frameCount / opts.fps).toFixed(1)}s) - a burst exceeded the per-frame cap at the requested duration`);
  }

  let regionCam: Cam | null = null;
  if (opts.mode === "region") {
    if (!opts.bbox) throw new Error("--mode region requires --bbox minX,minY,maxX,maxY");
    const [minX, minY, maxX, maxY] = opts.bbox.split(",").map(Number);
    regionCam = { minX: minX!, minY: minY!, maxX: maxX!, maxY: maxY! };
  }

  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  const ffmpeg = spawn("ffmpeg", [
    "-y",
    "-f", "image2pipe",
    "-framerate", String(opts.fps),
    "-i", "-",
    "-pix_fmt", "yuv420p",
    "-vf", `scale=${WIDTH}:${HEIGHT}`,
    opts.out,
  ]);
  ffmpeg.stderr.on("data", () => {}); // ffmpeg logs progress to stderr; suppressed for a quiet CLI

  const revealed = new Map<string, Operation>(); // opId -> current (possibly truncated) state
  const revealedOrder: string[] = [];
  let cumulativeBBox: BBox | null = null;
  let cam: Cam = regionCam ?? { minX: -400, minY: -300, maxX: 400, maxY: 300 };

  for (let f = 0; f < frameCount; f++) {
    for (const ev of timeline[f]!) {
      const op = ev.prefixLength != null ? truncateOp(ev.op, ev.prefixLength) : ev.op;
      if (!revealed.has(op.id)) revealedOrder.push(op.id);
      revealed.set(op.id, op);
      if (!cumulativeBBox) cumulativeBBox = { ...op.bbox };
      else {
        cumulativeBBox = {
          minX: Math.min(cumulativeBBox.minX, op.bbox.minX),
          minY: Math.min(cumulativeBBox.minY, op.bbox.minY),
          maxX: Math.max(cumulativeBBox.maxX, op.bbox.maxX),
          maxY: Math.max(cumulativeBBox.maxY, op.bbox.maxY),
        };
      }
    }

    if (opts.mode === "full" && cumulativeBBox) {
      const target = padBBox(cumulativeBBox);
      cam = lerpCam(cam, target, 0.12); // ease toward the target framing rather than snapping
    }

    const canvas = createCanvas(WIDTH, HEIGHT);
    const ctx = canvas.getContext("2d") as unknown as DrawContext2D;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const camW = Math.max(cam.maxX - cam.minX, 1);
    const camH = Math.max(cam.maxY - cam.minY, 1);
    const scale = Math.min(WIDTH / camW, HEIGHT / camH);
    const offX = (WIDTH - camW * scale) / 2 - cam.minX * scale;
    const offY = (HEIGHT - camH * scale) / 2 - cam.minY * scale;
    const tf = { toLocalX: (wx: number) => wx * scale + offX, toLocalY: (wy: number) => wy * scale + offY, scale };

    const viewBBox: BBox = { minX: cam.minX, minY: cam.minY, maxX: cam.maxX, maxY: cam.maxY };
    for (const id of revealedOrder) {
      const op = revealed.get(id)!;
      if (!bboxesIntersect(op.bbox, viewBBox)) continue;
      renderOperation(ctx, op, tf, PALETTE);
    }

    const png = canvas.toBuffer("image/png");
    await new Promise<void>((resolve, reject) => {
      ffmpeg.stdin.write(png, (err) => (err ? reject(err) : resolve()));
    });
  }

  ffmpeg.stdin.end();
  await new Promise<void>((resolve, reject) => {
    ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });

  await db.destroy();
  console.log(`[timelapse] wrote ${opts.out} (${frameCount} frames, ${visibleOps.length} operations)`);
}

function isMainModule(): boolean {
  return !!process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
}

if (isMainModule()) {
  const program = new Command();
  program
    .name("timelapse")
    .option("--from <seqOrDate>", "start of range (seq number or ISO date)", "0")
    .option("--to <seqOrDate>", "end of range (seq number or ISO date)", "")
    .option("--mode <mode>", "full | region", "full")
    .option("--bbox <minX,minY,maxX,maxY>", "fixed camera bbox, required for --mode region")
    .option("--duration <seconds>", "target video length in seconds", (v) => Number(v), 20)
    .option("--fps <fps>", "frames per second", (v) => Number(v), 24)
    .option("--granularity <g>", "op | point", "op")
    .option("--out <path>", "output video path", "./timelapse.mp4")
    .action(async (opts) => {
      await run(opts as Options);
    });

  program.parseAsync(process.argv);
}
