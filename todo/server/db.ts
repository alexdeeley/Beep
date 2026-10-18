// Schema and settings for the to-do vault. One SQLite database holds
// everything: settings (PIN hash, lock timeout, VAPID keys…), sessions,
// tasks, push subscriptions and the PIN-attempt log.
import type { SqlDriver } from './driver.ts';
import { one } from './driver.ts';

const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,                 -- sha-256 of the cookie token
        label TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        person TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        due_date TEXT,                        -- YYYY-MM-DD in the owner's time zone
        due_time TEXT,                        -- HH:MM, only with a due_date
        remind_at TEXT,                       -- UTC ISO instant
        reminder_sent_at TEXT,                -- set once the push for this remind_at has gone out
        priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
        status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX idx_tasks_status ON tasks(status);
      CREATE INDEX idx_tasks_due ON tasks(due_date);
      CREATE INDEX idx_tasks_remind ON tasks(remind_at);
      CREATE TABLE push_subs (
        id TEXT PRIMARY KEY,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        last_ok_at TEXT,
        failures INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, ok INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'pin');
      CREATE TABLE deliveries (task_id TEXT NOT NULL, remind_at TEXT NOT NULL, sent_at TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY (task_id, remind_at));
    `,
  },
];

export function migrate(db: SqlDriver): void {
  db.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(db.query('SELECT version FROM schema_migrations').map((r) => Number(r.version)));
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.transaction(() => {
      for (const stmt of m.sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').split(';').map((s) => s.trim()).filter(Boolean)) db.query(stmt);
      db.query('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [m.version, new Date().toISOString()]);
    });
  }
}

export const getSetting = (db: SqlDriver, key: string): string | null => { const r = one(db.query('SELECT value FROM settings WHERE key = ?', [key])); return r ? String(r.value) : null; };
export const setSetting = (db: SqlDriver, key: string, value: string): void => { db.query('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]); };
export const delSetting = (db: SqlDriver, key: string): void => { db.query('DELETE FROM settings WHERE key = ?', [key]); };

export const now = (): string => new Date().toISOString();

export function newId(prefix: string): string {
  const b = new Uint8Array(12); crypto.getRandomValues(b);
  return prefix + '_' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
