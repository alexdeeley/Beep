// The one seam between the services and SQLite. Two implementations:
// the Durable Object's storage.sql in production (server/worker.ts) and
// node:sqlite for tests and the local dev server (dev/local-server.mjs).
// Services never see which one they are on.

export type Row = Record<string, unknown>;

export interface SqlDriver {
  // Runs a statement and returns its rows (empty for writes).
  query(sql: string, params?: unknown[]): Row[];
  // Runs several statements in one transaction.
  transaction<T>(fn: () => T): T;
}

export function one<T extends Row = Row>(rows: Row[]): T | null {
  return (rows[0] as T) ?? null;
}
