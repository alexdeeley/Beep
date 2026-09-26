import { Kysely, PostgresDialect, SqliteDialect } from "kysely";
import Database from "better-sqlite3";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import type { Database as Schema } from "./schema.js";

export interface DbConfig {
  /** If set, connects to Postgres. Otherwise falls back to a local SQLite file. */
  databaseUrl?: string;
  sqlitePath?: string;
}

export function loadDbConfig(env: NodeJS.ProcessEnv = process.env): DbConfig {
  return {
    databaseUrl: env.DATABASE_URL,
    sqlitePath: env.SQLITE_PATH ?? "./data/wall.db",
  };
}

export function createDb(config: DbConfig): Kysely<Schema> {
  if (config.databaseUrl) {
    const pool = new pg.Pool({ connectionString: config.databaseUrl });
    return new Kysely<Schema>({ dialect: new PostgresDialect({ pool }) });
  }
  const sqlitePath = config.sqlitePath ?? "./data/wall.db";
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  const sqlite = new Database(sqlitePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return new Kysely<Schema>({ dialect: new SqliteDialect({ database: sqlite }) });
}

export type { Schema };
