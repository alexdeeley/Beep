// SqlDriver over node:sqlite, for tests and the local dev server.
import { DatabaseSync } from 'node:sqlite';
import type { SqlDriver, Row } from './driver.ts';

export class NodeDriver implements SqlDriver {
  readonly db: DatabaseSync;
  private depth = 0;
  constructor(file = ':memory:') { this.db = new DatabaseSync(file); this.db.exec('PRAGMA foreign_keys = ON'); }
  query(sql: string, params: unknown[] = []): Row[] {
    const st = this.db.prepare(sql);
    const clean = params.map((p) => (p === undefined ? null : p)) as never[];
    if (/^\s*(select|with|pragma)/i.test(sql)) return st.all(...clean) as Row[];
    st.run(...clean);
    return [];
  }
  transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn();           // nested: join the outer transaction
    this.db.exec('BEGIN');
    this.depth++;
    try { const out = fn(); this.db.exec('COMMIT'); return out; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
    finally { this.depth--; }
  }
}
