import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { createDb } from "../../src/server/db/index.js";
import { InlineMigrationProvider } from "../../src/server/db/migrations.js";
import { Migrator } from "kysely";
import { insertOperation } from "../../src/server/db/store.js";
import { run, explodeForGranularity, buildTimeline } from "../../src/cli/timelapse.js";
import { PALETTE } from "../../src/shared/palette.js";
import type { StrokeOp } from "../../src/shared/types.js";

const tmpFiles: string[] = [];
afterEach(() => {
  for (const f of tmpFiles.splice(0)) fs.rmSync(f, { force: true, recursive: true });
});

function strokeAt(id: string, x: number, y: number): StrokeOp {
  return {
    id,
    type: "stroke",
    session: "s",
    color: 0,
    size: 0,
    points: [{ x, y, p: 0.5 }],
    bbox: { minX: x, minY: y, maxX: x + 1, maxY: y + 1 },
  } as StrokeOp;
}

describe("buildTimeline - time compression", () => {
  it("never assigns more events to a frame than the cap, even for a simultaneous burst", () => {
    const events = Array.from({ length: 50 }, (_, i) => ({ op: strokeAt(`op-${i}`, i, 0), ts: 1000 }));
    const timeline = buildTimeline(events, 10, 4);
    for (const frame of timeline) expect(frame.length).toBeLessThanOrEqual(4);
    expect(timeline.flat().length).toBe(50);
  });

  it("keeps a burst after a long idle gap spread across several frames rather than collapsed onto one", () => {
    const before = Array.from({ length: 5 }, (_, i) => ({ op: strokeAt(`b${i}`, i, 0), ts: i * 5 }));
    const after = Array.from({ length: 20 }, (_, i) => ({ op: strokeAt(`a${i}`, i, 0), ts: 1_000_000 + i * 5 }));
    const timeline = buildTimeline([...before, ...after], 200, 50);
    const afterFrames = new Set<number>();
    timeline.forEach((frame, idx) => {
      if (frame.some((e) => e.op.id.startsWith("a"))) afterFrames.add(idx);
    });
    // A naive scheme could cram all 20 post-gap events onto the single frame nearest the end;
    // the min-gap floor and per-frame cap together should spread them across more than one.
    expect(afterFrames.size).toBeGreaterThan(1);
  });

  it("preserves every event exactly once, across all frames combined", () => {
    const events = Array.from({ length: 23 }, (_, i) => ({ op: strokeAt(`op-${i}`, i, 0), ts: i * 137 }));
    const timeline = buildTimeline(events, 15, 3);
    const ids = timeline.flat().map((e) => e.op.id);
    expect(new Set(ids).size).toBe(23);
  });
});

describe("explodeForGranularity", () => {
  it("op granularity yields exactly one event per operation, no prefixLength", () => {
    const ops = [strokeAt("a", 0, 0), strokeAt("b", 1, 0)];
    const events = explodeForGranularity(ops, "op");
    expect(events.length).toBe(2);
    expect(events.every((e) => e.prefixLength === undefined)).toBe(true);
  });

  it("point granularity explodes a multi-point stroke into one event per point", () => {
    const op = strokeAt("a", 0, 0);
    op.points = [{ x: 0, y: 0, p: 0.5 }, { x: 1, y: 0, p: 0.5 }, { x: 2, y: 0, p: 0.5 }];
    const events = explodeForGranularity([op], "point");
    expect(events.length).toBe(3);
    expect(events.map((e) => e.prefixLength)).toEqual([1, 2, 3]);
  });
});

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Decodes a PNG and stride-samples pixels for a close colour match - a cheap "is this colour present" check. */
async function pngContainsColorNear(png: Buffer, hex: string): Promise<boolean> {
  const [tr, tg, tb] = hexToRgb(hex);
  const img = await loadImage(png);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img as any, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  const tol = 30;
  for (let i = 0; i < data.length; i += 4 * 37) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!, a = data[i + 3]!;
    if (a < 200) continue;
    if (Math.abs(r - tr) <= tol && Math.abs(g - tg) <= tol && Math.abs(b - tb) <= tol) return true;
  }
  return false;
}

describe("timelapse ordering and final-frame fidelity", () => {
  it("draws the earlier operation before the later one, and the final frame contains both", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "timelapse-out-"));
    const dbPath = path.join(outDir, "wall.db");
    const outFile = path.join(outDir, "out.mp4");
    tmpFiles.push(outDir);

    const db = createDb({ sqlitePath: dbPath });
    const migrator = new Migrator({ db, provider: new InlineMigrationProvider("sqlite") });
    await migrator.migrateToLatest();

    // A red line, then (strictly later) a blue circle - mirrors the acceptance-test
    // spec's "the timelapse puts the red line before the blue circle".
    const red: StrokeOp = {
      id: "11111111-1111-1111-1111-111111111111",
      type: "stroke",
      session: "s",
      color: 2, // PALETTE[2] = red
      size: 2,
      points: [{ x: -50, y: 0, p: 0.5 }, { x: 50, y: 0, p: 0.5 }],
      bbox: { minX: -50, minY: -5, maxX: 50, maxY: 5 },
    };
    await insertOperation(db, red);
    await new Promise((r) => setTimeout(r, 30));
    const blue: StrokeOp = {
      id: "22222222-2222-2222-2222-222222222222",
      type: "stroke",
      session: "s",
      color: 6, // PALETTE[6] = blue
      size: 2,
      points: Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return { x: Math.cos(a) * 30, y: 40 + Math.sin(a) * 30, p: 0.5 };
      }),
      bbox: { minX: -30, minY: 10, maxX: 30, maxY: 70 },
    };
    await insertOperation(db, blue);
    await db.destroy();

    const prevPath = process.env.SQLITE_PATH;
    const prevUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    process.env.SQLITE_PATH = dbPath;
    try {
      await run({
        from: "0",
        to: "",
        mode: "region",
        bbox: "-80,-40,80,90",
        duration: 2,
        fps: 6,
        granularity: "op",
        out: outFile,
      });
    } finally {
      if (prevPath === undefined) delete process.env.SQLITE_PATH;
      else process.env.SQLITE_PATH = prevPath;
      if (prevUrl !== undefined) process.env.DATABASE_URL = prevUrl;
    }

    expect(fs.existsSync(outFile)).toBe(true);
    expect(fs.statSync(outFile).size).toBeGreaterThan(0);

    const firstFramePath = path.join(outDir, "first.png");
    const lastFramePath = path.join(outDir, "last.png");
    const quiet: { stdio: ["ignore", "ignore", "ignore"] } = { stdio: ["ignore", "ignore", "ignore"] };
    execFileSync("ffmpeg", ["-y", "-i", outFile, "-vf", "select=eq(n\\,0)", "-vframes", "1", firstFramePath], quiet);
    execFileSync("ffmpeg", ["-y", "-sseof", "-0.3", "-i", outFile, "-vframes", "1", lastFramePath], quiet);

    const firstPng = fs.readFileSync(firstFramePath);
    const lastPng = fs.readFileSync(lastFramePath);

    // Frame 0 (ops allocated across the timeline by activity) shows the red stroke
    // but not yet the blue one, confirming ordering rather than both appearing at once.
    expect(await pngContainsColorNear(firstPng, PALETTE[2]!)).toBe(true);
    expect(await pngContainsColorNear(firstPng, PALETTE[6]!)).toBe(false);

    // The final frame is "the wall": it must contain both.
    expect(await pngContainsColorNear(lastPng, PALETTE[2]!)).toBe(true);
    expect(await pngContainsColorNear(lastPng, PALETTE[6]!)).toBe(true);
  }, 30_000);
});
