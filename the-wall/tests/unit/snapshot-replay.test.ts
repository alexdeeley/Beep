import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDb } from "../../src/server/db/index.js";
import { InlineMigrationProvider } from "../../src/server/db/migrations.js";
import { Migrator } from "kysely";
import { insertOperation } from "../../src/server/db/store.js";
import { getOrRenderTile } from "../../src/server/tiles.js";
import { takeSnapshot } from "../../src/server/snapshot.js";
import type { StrokeOp } from "../../src/shared/types.js";

function makeStroke(id: string, seed: number): StrokeOp {
  const x = (seed * 37) % 400;
  const y = (seed * 53) % 400;
  return {
    id,
    type: "stroke",
    session: "s",
    color: seed % 9,
    size: seed % 4,
    points: [
      { x, y, p: 0.5 },
      { x: x + 20, y: y + 10, p: 0.5 },
    ],
    bbox: { minX: x, minY: y, maxX: x + 20, maxY: y + 10 },
  };
}

async function freshDb() {
  const file = path.join(os.tmpdir(), `wall-test-${Math.random().toString(36).slice(2)}.db`);
  const db = createDb({ sqlitePath: file });
  const migrator = new Migrator({ db, provider: new InlineMigrationProvider("sqlite") });
  await migrator.migrateToLatest();
  return { db, file };
}

describe("snapshot does not change what gets rendered", () => {
  it("rendering with a snapshot taken partway through equals rendering the same ops with no snapshot at all", async () => {
    const a = await freshDb();
    const b = await freshDb();
    try {
      const ids = Array.from({ length: 40 }, (_, i) => `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`);

      // Wall A: insert half, take a snapshot (forces a full re-render/cache of every touched tile), then insert the rest.
      for (let i = 0; i < 20; i++) await insertOperation(a.db, makeStroke(ids[i]!, i));
      await takeSnapshot(a.db, 20);
      for (let i = 20; i < 40; i++) await insertOperation(a.db, makeStroke(ids[i]!, i));

      // Wall B: the identical 40 operations, inserted back-to-back, no snapshot ever taken.
      for (let i = 0; i < 40; i++) await insertOperation(b.db, makeStroke(ids[i]!, i));

      const tileA = await getOrRenderTile(a.db, { level: 0, tx: 0, ty: 0 });
      const tileB = await getOrRenderTile(b.db, { level: 0, tx: 0, ty: 0 });

      expect(tileA.seq).toBe(tileB.seq);
      expect(Buffer.compare(tileA.png, tileB.png)).toBe(0);
    } finally {
      await a.db.destroy();
      await b.db.destroy();
      fs.rmSync(a.file, { force: true });
      fs.rmSync(b.file, { force: true });
    }
  });
});
