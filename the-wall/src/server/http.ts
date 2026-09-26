import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import type { Kysely } from "kysely";
import type { Schema } from "./db/index.js";
import { getOpsForTile0Since, getOpsSince, recentActivityBBox, worldBBox } from "./db/store.js";
import { getOrRenderTile } from "./tiles.js";

const CLIENT_DIST = path.resolve(process.cwd(), "dist-client");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon",
};

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (!fs.existsSync(CLIENT_DIST)) return false;
  const urlPath = (req.url ?? "/").split("?")[0]!;
  let filePath = path.join(CLIENT_DIST, urlPath === "/" ? "index.html" : urlPath);
  if (!filePath.startsWith(CLIENT_DIST)) return false; // path traversal guard
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(CLIENT_DIST, "index.html"); // SPA fallback
  }
  if (!fs.existsSync(filePath)) return false;
  const ext = path.extname(filePath);
  res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

export function createHttpServer(db: Kysely<Schema>): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");

      const tileMatch = url.pathname.match(/^\/api\/tiles\/(-?\d+)\/(-?\d+)\/(-?\d+)\.png$/);
      if (tileMatch) {
        const level = Number(tileMatch[1]);
        const tx = Number(tileMatch[2]);
        const ty = Number(tileMatch[3]);
        const tile = await getOrRenderTile(db, { level, tx, ty });
        res.writeHead(200, {
          "content-type": "image/png",
          "cache-control": "no-cache",
          "x-tile-seq": String(tile.seq),
        });
        res.end(tile.png);
        return;
      }

      if (url.pathname === "/api/ops") {
        const since = Number(url.searchParams.get("since") ?? "0") || 0;
        const tileParam = url.searchParams.get("tile"); // "level/tx/ty", level must be 0
        if (tileParam) {
          const m = tileParam.match(/^0\/(-?\d+)\/(-?\d+)$/);
          if (!m) {
            res.writeHead(400).end();
            return;
          }
          const ops = await getOpsForTile0Since(db, Number(m[1]), Number(m[2]), since);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ops }));
          return;
        }
        const ops = await getOpsSince(db, since, 5000);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ops }));
        return;
      }

      if (url.pathname === "/api/activity") {
        const bbox = (await recentActivityBBox(db, 24 * 60 * 60 * 1000)) ?? (await worldBBox(db)) ?? null;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ bbox }));
        return;
      }

      if (url.pathname === "/api/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (serveStatic(req, res)) return;

      res.writeHead(404).end();
    } catch (err) {
      console.error("[http] error", err);
      res.writeHead(500).end();
    }
  });
}
