import { Migrator } from "kysely";
import { createDb, loadDbConfig } from "./index.js";
import { InlineMigrationProvider } from "./migrations.js";

export async function migrateToLatest(): Promise<void> {
  const config = loadDbConfig();
  const db = createDb(config);
  const dialect = config.databaseUrl ? "postgres" : "sqlite";
  const migrator = new Migrator({ db, provider: new InlineMigrationProvider(dialect) });
  const { error, results } = await migrator.migrateToLatest();
  for (const r of results ?? []) {
    console.log(`[migrate] ${r.status}: ${r.migrationName}`);
  }
  if (error) {
    console.error("[migrate] failed:", error);
    await db.destroy();
    process.exit(1);
  }
  await db.destroy();
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  migrateToLatest();
}
