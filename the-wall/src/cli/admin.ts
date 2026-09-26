#!/usr/bin/env node
import { Command } from "commander";
import { createCanvas } from "@napi-rs/canvas";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Kysely } from "kysely";
import { sql } from "kysely";
import { createDb, loadDbConfig, type Schema } from "../server/db/index.js";
import { rowToOperation, operationCount, getHeadSeq, worldBBox, getLatestSnapshot, getAllTargetedByHides } from "../server/db/store.js";
import { takeSnapshot } from "../server/snapshot.js";
import { renderOperation, type DrawContext2D } from "../shared/draw.js";
import { PALETTE, SIZES } from "../shared/palette.js";
import { tilesForBBox, bboxesIntersect } from "../shared/coords.js";
import type { Operation } from "../shared/types.js";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function allOperations(db: Kysely<Schema>): Promise<Operation[]> {
  const rows = await db.selectFrom("operations").selectAll().orderBy("seq", "asc").execute();
  return (rows as any[]).map(rowToOperation);
}

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------

async function cmdStats(): Promise<void> {
  const db = createDb(loadDbConfig());
  const [count, head, bbox, snapshot, sessions] = await Promise.all([
    operationCount(db),
    getHeadSeq(db),
    worldBBox(db),
    getLatestSnapshot(db),
    db.selectFrom("operations").select((eb) => eb.fn.count<number>("session").distinct().as("n")).executeTakeFirst(),
  ]);
  console.log(JSON.stringify({
    operations: count,
    headSeq: head,
    worldBBox: bbox ?? null,
    latestSnapshotSeq: snapshot?.seq ?? null,
    distinctSessions: Number(sessions?.n ?? 0),
  }, null, 2));
  await db.destroy();
}

// ---------------------------------------------------------------------------
// snapshot
// ---------------------------------------------------------------------------

async function cmdSnapshot(): Promise<void> {
  const db = createDb(loadDbConfig());
  const head = await getHeadSeq(db);
  await takeSnapshot(db, head);
  console.log(`[admin] snapshot taken at seq ${head}`);
  await db.destroy();
}

// ---------------------------------------------------------------------------
// hide <ids...> - moderation. Targets are earlier operation ids; the hide
// itself is tile-indexed to the union of its targets' bboxes so cached tiles
// covering the hidden content are correctly invalidated on next read.
// ---------------------------------------------------------------------------

async function cmdHide(ids: string[]): Promise<void> {
  const db = createDb(loadDbConfig());
  const rows = await db.selectFrom("operations").selectAll().where("id", "in", ids).execute();
  if (rows.length === 0) {
    console.error("[admin] none of the given ids were found");
    await db.destroy();
    process.exitCode = 1;
    return;
  }
  const found = (rows as any[]).map(rowToOperation);
  const bbox = found.reduce(
    (acc, op) => ({
      minX: Math.min(acc.minX, op.bbox.minX),
      minY: Math.min(acc.minY, op.bbox.minY),
      maxX: Math.max(acc.maxX, op.bbox.maxX),
      maxY: Math.max(acc.maxY, op.bbox.maxY),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );

  const hideId = randomUUID();
  const ts = Date.now();
  const inserted = await db
    .insertInto("operations")
    .values({
      id: hideId,
      type: "hide",
      session: "admin",
      color: 0,
      ts,
      min_x: bbox.minX,
      min_y: bbox.minY,
      max_x: bbox.maxX,
      max_y: bbox.maxY,
      payload: JSON.stringify({ targetIds: found.map((o) => o.id) }),
    })
    .returningAll()
    .executeTakeFirst();
  const seq = (inserted as any)?.seq ?? (await db.selectFrom("operations").select("seq").where("id", "=", hideId).executeTakeFirstOrThrow()).seq;

  const tiles = tilesForBBox(0, bbox);
  if (tiles.length > 0) {
    await db.insertInto("tile_index").values(tiles.map((t) => ({ seq, tx: t.tx, ty: t.ty }))).execute();
  }
  console.log(`[admin] hid ${found.length} operation(s): ${found.map((o) => o.id).join(", ")}`);
  await db.destroy();
}

// ---------------------------------------------------------------------------
// export ops <path> - the raw append-only log, verbatim.
// ---------------------------------------------------------------------------

async function cmdExportOps(outPath: string): Promise<void> {
  const db = createDb(loadDbConfig());
  const ops = await allOperations(db);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(ops));
  console.log(`[admin] exported ${ops.length} operations to ${outPath}`);
  await db.destroy();
}

// ---------------------------------------------------------------------------
// export png <path> [--bbox minX,minY,maxX,maxY] [--max-px N] - a single
// rendered frame of the current (non-hidden) wall content, reusing the exact
// shared draw code the client and tile renderer use.
// ---------------------------------------------------------------------------

async function cmdExportPng(outPath: string, opts: { bbox?: string; maxPx: string }): Promise<void> {
  const db = createDb(loadDbConfig());
  const [ops, hidden, world] = await Promise.all([allOperations(db), getAllTargetedByHides(db), worldBBox(db)]);
  const bbox = opts.bbox
    ? (() => {
        const [minX, minY, maxX, maxY] = opts.bbox!.split(",").map(Number);
        return { minX: minX!, minY: minY!, maxX: maxX!, maxY: maxY! };
      })()
    : world ?? { minX: -256, minY: -256, maxX: 256, maxY: 256 };

  const maxPx = Number(opts.maxPx) || 4096;
  const w = Math.max(bbox.maxX - bbox.minX, 1);
  const h = Math.max(bbox.maxY - bbox.minY, 1);
  const scale = Math.min(maxPx / w, maxPx / h);
  const pxW = Math.max(1, Math.round(w * scale));
  const pxH = Math.max(1, Math.round(h * scale));

  const canvas = createCanvas(pxW, pxH);
  const ctx = canvas.getContext("2d") as unknown as DrawContext2D;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, pxW, pxH);
  const tf = { toLocalX: (wx: number) => (wx - bbox.minX) * scale, toLocalY: (wy: number) => (wy - bbox.minY) * scale, scale };
  for (const op of ops) {
    if (hidden.has(op.id) || op.type === "hide") continue;
    if (!bboxesIntersect(op.bbox, bbox)) continue;
    renderOperation(ctx, op, tf, PALETTE);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, canvas.toBuffer("image/png"));
  console.log(`[admin] exported ${pxW}x${pxH} PNG to ${outPath}`);
  await db.destroy();
}

// ---------------------------------------------------------------------------
// backup <path> - the operations + snapshots tables are the entire source of
// truth (tile_index and tile_cache are pure derived caches, rebuilt on
// demand), so a backup is just those two tables as JSON: dialect-agnostic
// and restorable onto either SQLite or Postgres.
// ---------------------------------------------------------------------------

async function cmdBackup(outPath: string): Promise<void> {
  const db = createDb(loadDbConfig());
  const [ops, snapshots] = await Promise.all([
    allOperations(db),
    db.selectFrom("snapshots").select(["seq", "created_at"]).orderBy("seq", "asc").execute(),
  ]);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ version: 1, operations: ops, snapshots }));
  console.log(`[admin] backed up ${ops.length} operations, ${snapshots.length} snapshot(s) to ${outPath}`);
  await db.destroy();
}

// ---------------------------------------------------------------------------
// restore <path> - wipes operations/tile_index/tile_cache/snapshots, then
// replays the backup's operations with their ORIGINAL seq/ts preserved (a
// raw insert, not insertOperation, which would reassign both). tile_index is
// rebuilt alongside each insert from the same bbox padding rule store.ts
// uses. Postgres's serial sequence is explicitly resynced afterward since
// inserting explicit seq values doesn't advance it.
// ---------------------------------------------------------------------------

async function cmdRestore(inPath: string): Promise<void> {
  const raw = JSON.parse(fs.readFileSync(inPath, "utf8"));
  const ops: Operation[] = raw.operations;
  const snapshots: { seq: number; created_at: number }[] = raw.snapshots ?? [];
  const config = loadDbConfig();
  const db = createDb(config);

  await db.deleteFrom("tile_cache").execute();
  await db.deleteFrom("tile_index").execute();
  await db.deleteFrom("snapshots").execute();
  await db.deleteFrom("operations").execute();

  for (const op of ops) {
    if (op.seq == null || op.ts == null) throw new Error(`operation ${op.id} in backup is missing seq/ts`);
    const payload =
      op.type === "stroke"
        ? JSON.stringify({ size: op.size, points: op.points })
        : op.type === "pixels"
        ? JSON.stringify({ cell: op.cell, cells: op.cells })
        : JSON.stringify({ targetIds: op.targetIds });
    await db
      .insertInto("operations")
      .values({
        seq: op.seq,
        id: op.id,
        type: op.type,
        session: op.session,
        color: op.color,
        ts: op.ts,
        min_x: op.bbox.minX,
        min_y: op.bbox.minY,
        max_x: op.bbox.maxX,
        max_y: op.bbox.maxY,
        payload,
      })
      .execute();

    const pad = op.type === "stroke" ? (SIZES[op.size] ?? SIZES[0]!) / 2 : 0;
    const tiles = tilesForBBox(0, {
      minX: op.bbox.minX - pad,
      minY: op.bbox.minY - pad,
      maxX: op.bbox.maxX + pad,
      maxY: op.bbox.maxY + pad,
    });
    if (tiles.length > 0) {
      await db.insertInto("tile_index").values(tiles.map((t) => ({ seq: op.seq!, tx: t.tx, ty: t.ty }))).execute();
    }
  }
  for (const s of snapshots) {
    await db.insertInto("snapshots").values({ seq: s.seq, created_at: s.created_at }).execute();
  }

  if (config.databaseUrl) {
    await sql`select setval(pg_get_serial_sequence('operations', 'seq'), coalesce((select max(seq) from operations), 1))`.execute(db);
  }

  console.log(`[admin] restored ${ops.length} operations, ${snapshots.length} snapshot(s) from ${inPath}`);
  await db.destroy();
}

// ---------------------------------------------------------------------------
// timelapse - thin passthrough to the dedicated timelapse CLI, so there's one
// implementation of the rendering pipeline, not two.
// ---------------------------------------------------------------------------

function cmdTimelapse(args: string[]): void {
  const target = path.join(__dirname, "timelapse.ts");
  const result = spawnSync("npx", ["tsx", target, ...args], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
}

// ---------------------------------------------------------------------------

function isMainModule(): boolean {
  return !!process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
}

if (isMainModule()) {
  const program = new Command();
  program.name("admin");

  program.command("stats").description("summary counts and world bbox").action(cmdStats);
  program.command("snapshot").description("force a snapshot checkpoint at the current head").action(cmdSnapshot);
  program
    .command("hide <ids...>")
    .description("moderation: mark one or more operation ids hidden from rendering")
    .action(cmdHide);
  program.command("export-ops <path>").description("dump the raw operation log as JSON").action(cmdExportOps);
  program
    .command("export-png <path>")
    .description("render current wall state (or --bbox region) to a PNG")
    .option("--bbox <minX,minY,maxX,maxY>", "region to export; defaults to the whole wall")
    .option("--max-px <n>", "longest output dimension in pixels", "4096")
    .action(cmdExportPng);
  program.command("backup <path>").description("dump operations + snapshots to a restorable JSON file").action(cmdBackup);
  program.command("restore <path>").description("wipe the database and replay a backup file").action(cmdRestore);
  program
    .command("timelapse")
    .description("passthrough to the timelapse CLI (see: npm run timelapse -- --help)")
    .allowUnknownOption(true)
    .argument("[args...]")
    .action(cmdTimelapse);

  program.parseAsync(process.argv);
}
