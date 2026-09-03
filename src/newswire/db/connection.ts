import Database from "better-sqlite3";
import { runMigrations } from "./migrate.js";

/**
 * Opens (creating if absent) the local SQLite file at `path`, applies
 * pragmas suited to a single-writer batch process, and runs any pending
 * migrations. Callers are responsible for closing the returned handle
 * (see runNewswireCycle.ts's try/finally) so the WAL is checkpointed
 * cleanly before the file is uploaded back to R2.
 */
export function openStoryDb(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

/**
 * Closes the handle after checkpointing WAL back into the main file, so
 * the single uploaded file (not a -wal/-shm sidecar) is self-contained.
 */
export function closeStoryDb(db: Database.Database): void {
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
}
