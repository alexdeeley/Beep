import type Database from "better-sqlite3";
import { migrations } from "./schema.js";

/**
 * Applies any pending migrations in order, tracked in schema_migrations so
 * this is safe to call at the top of every run (fresh DB, or an existing
 * one downloaded from R2 that's already at some earlier version).
 */
export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db.prepare("SELECT id FROM schema_migrations").all().map((row) => (row as { id: string }).id)
  );

  const insertMigration = db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)");

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    const apply = db.transaction(() => {
      db.exec(migration.sql);
      insertMigration.run(migration.id, new Date().toISOString());
    });
    apply();
  }
}
