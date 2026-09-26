import { WebSocketServer } from "ws";
import { createDb, loadDbConfig } from "./db/index.js";
import { migrateToLatest } from "./db/migrate.js";
import { createHttpServer } from "./http.js";
import { attachWebSocketServer, bootHeadSeq } from "./ws.js";

async function main() {
  await migrateToLatest();

  const db = createDb(loadDbConfig());
  const headSeq = await bootHeadSeq(db);

  const server = createHttpServer(db);
  const wss = new WebSocketServer({ server, path: "/ws" });
  attachWebSocketServer(wss, db, headSeq);

  const port = Number(process.env.PORT ?? 8787);
  server.listen(port, () => {
    console.log(`[the-wall] listening on :${port} (headSeq=${headSeq})`);
  });

  const shutdown = async () => {
    console.log("[the-wall] shutting down");
    server.close();
    await db.destroy();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[the-wall] fatal", err);
  process.exit(1);
});
