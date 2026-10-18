// Tasks: validation, storage, queries, and the reminder bookkeeping that
// keeps a reminder from firing twice or after its task was finished.
import type { SqlDriver, Row } from './driver.ts';
import { one } from './driver.ts';
import { now, newId } from './db.ts';

export class ValidationError extends Error { status = 400; }
const fail = (m: string): never => { throw new ValidationError(m); };

export type Priority = 'low' | 'normal' | 'high';
export type Status = 'todo' | 'doing' | 'done';
export interface Task {
  id: string; title: string; person: string; notes: string;
  dueDate: string | null; dueTime: string | null; remindAt: string | null; reminderSentAt: string | null;
  priority: Priority; status: Status; createdAt: string; updatedAt: string; completedAt: string | null;
}
export interface TaskInput { title?: unknown; person?: unknown; notes?: unknown; dueDate?: unknown; dueTime?: unknown; remindAt?: unknown; priority?: unknown; status?: unknown }

const str = (v: unknown, field: string, max: number, required = false): string => {
  if (v == null) { if (required) fail(`${field} is required`); return ''; }
  if (typeof v !== 'string') fail(`${field} must be text`);
  const s = (v as string).trim();
  if (required && !s) fail(`${field} is required`);
  if (s.length > max) fail(`${field} is too long (max ${max} characters)`);
  return s;
};
const dateStr = (v: unknown, field: string): string | null => { if (v == null || v === '') return null; const s = String(v); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s + 'T00:00:00Z'))) fail(`${field} must be a date like 2026-10-18`); return s; };
const timeStr = (v: unknown, field: string): string | null => { if (v == null || v === '') return null; const s = String(v); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) fail(`${field} must be a time like 14:30`); return s; };
const instant = (v: unknown, field: string): string | null => { if (v == null || v === '') return null; const t = Date.parse(String(v)); if (Number.isNaN(t)) fail(`${field} must be a date and time`); return new Date(t).toISOString(); };

export function taskInput(raw: unknown, partial = false): Partial<Task> {
  if (!raw || typeof raw !== 'object') fail('expected an object');
  const r = raw as TaskInput;
  const out: Partial<Task> = {};
  if (!partial || r.title !== undefined) out.title = str(r.title, 'Title', 300, true);
  if (r.person !== undefined) out.person = str(r.person, 'Person', 120);
  if (r.notes !== undefined) out.notes = str(r.notes, 'Notes', 5000);
  if (r.dueDate !== undefined) out.dueDate = dateStr(r.dueDate, 'Due date');
  if (r.dueTime !== undefined) out.dueTime = timeStr(r.dueTime, 'Due time');
  if (r.remindAt !== undefined) out.remindAt = instant(r.remindAt, 'Reminder');
  if (r.priority !== undefined) { const pr = r.priority; if (pr !== 'low' && pr !== 'normal' && pr !== 'high') fail('Priority must be low, normal or high'); out.priority = pr as Priority; }
  if (r.status !== undefined) { const st = r.status; if (st !== 'todo' && st !== 'doing' && st !== 'done') fail('Status must be todo, doing or done'); out.status = st as Status; }
  if (out.dueTime && !out.dueDate && !partial) fail('A due time needs a due date');
  return out;
}

export class TaskService {
  private db: SqlDriver;
  constructor(db: SqlDriver) { this.db = db; }

  private row(r: Row): Task {
    const s = (k: string) => (r[k] == null ? null : String(r[k]));
    return { id: String(r.id), title: String(r.title), person: String(r.person), notes: String(r.notes), dueDate: s('due_date'), dueTime: s('due_time'), remindAt: s('remind_at'), reminderSentAt: s('reminder_sent_at'), priority: r.priority as Priority, status: r.status as Status, createdAt: String(r.created_at), updatedAt: String(r.updated_at), completedAt: s('completed_at') };
  }

  get(id: string): Task { const r = one(this.db.query('SELECT * FROM tasks WHERE id = ?', [id])); if (!r) throw new NotFound('No such task'); return this.row(r); }

  list(opts: { status?: Status | 'open'; q?: string; person?: string; updatedSince?: string } = {}): Task[] {
    const where: string[] = [], params: unknown[] = [];
    if (opts.status === 'open') where.push("status <> 'done'"); else if (opts.status) { where.push('status = ?'); params.push(opts.status); }
    if (opts.person) { where.push('person = ? COLLATE NOCASE'); params.push(opts.person); }
    if (opts.q) { where.push('(title LIKE ? OR person LIKE ? OR notes LIKE ?)'); const like = `%${opts.q.replace(/[%_]/g, (c) => '\\' + c)}%`; params.push(like, like, like); }
    if (opts.updatedSince) { where.push('updated_at > ?'); params.push(opts.updatedSince); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    return this.db.query(`SELECT * FROM tasks ${w} ORDER BY (due_date IS NULL), due_date, (due_time IS NULL), due_time, CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, created_at DESC`, params).map((r) => this.row(r));
  }

  create(raw: unknown): Task {
    const t = taskInput(raw);
    const id = newId('task'), ts = now();
    this.db.query('INSERT INTO tasks (id, title, person, notes, due_date, due_time, remind_at, priority, status, created_at, updated_at, completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, t.title, t.person ?? '', t.notes ?? '', t.dueDate ?? null, t.dueTime && t.dueDate ? t.dueTime : null, t.remindAt ?? null, t.priority ?? 'normal', t.status ?? 'todo', ts, ts, t.status === 'done' ? ts : null]);
    return this.get(id);
  }

  update(id: string, raw: unknown): Task {
    const cur = this.get(id);
    const p = taskInput(raw, true);
    const next: Task = { ...cur, ...p } as Task;
    if (next.dueTime && !next.dueDate) next.dueTime = null;
    // a changed reminder time is a new reminder: it may fire again
    if (p.remindAt !== undefined && p.remindAt !== cur.remindAt) next.reminderSentAt = null;
    if (p.status !== undefined && p.status !== cur.status) next.completedAt = p.status === 'done' ? now() : null;
    this.db.query('UPDATE tasks SET title=?, person=?, notes=?, due_date=?, due_time=?, remind_at=?, reminder_sent_at=?, priority=?, status=?, updated_at=?, completed_at=? WHERE id=?',
      [next.title, next.person, next.notes, next.dueDate, next.dueTime, next.remindAt, next.reminderSentAt, next.priority, next.status, now(), next.completedAt, id]);
    return this.get(id);
  }

  remove(id: string): void { this.get(id); this.db.query('DELETE FROM tasks WHERE id = ?', [id]); }

  people(): { person: string; open: number; total: number }[] {
    return this.db.query("SELECT person, SUM(status <> 'done') AS open, COUNT(*) AS total FROM tasks WHERE person <> '' GROUP BY person COLLATE NOCASE ORDER BY open DESC, person COLLATE NOCASE").map((r) => ({ person: String(r.person), open: Number(r.open), total: Number(r.total) }));
  }
  count(): { open: number; done: number } { const r = one(this.db.query("SELECT SUM(status <> 'done') AS open, SUM(status = 'done') AS done FROM tasks")); return { open: Number(r?.open ?? 0), done: Number(r?.done ?? 0) }; }

  // ── reminders ──
  // Due now: a reminder time has passed, nothing has been sent for it, and the task is not finished.
  due(atIso = now()): Task[] { return this.db.query("SELECT * FROM tasks WHERE remind_at IS NOT NULL AND remind_at <= ? AND reminder_sent_at IS NULL AND status <> 'done' ORDER BY remind_at", [atIso]).map((r) => this.row(r)); }
  // The next instant the scheduler must wake for, or null.
  nextReminderAt(afterIso = now()): string | null { const r = one(this.db.query("SELECT MIN(remind_at) AS t FROM tasks WHERE remind_at IS NOT NULL AND remind_at > ? AND reminder_sent_at IS NULL AND status <> 'done'", [afterIso])); return r?.t ? String(r.t) : null; }
  upcomingReminders(limit = 50): Task[] { return this.db.query("SELECT * FROM tasks WHERE remind_at IS NOT NULL AND reminder_sent_at IS NULL AND status <> 'done' ORDER BY remind_at LIMIT ?", [limit]).map((r) => this.row(r)); }
  markSent(id: string, remindAt: string, result: string): void {
    this.db.transaction(() => {
      this.db.query('UPDATE tasks SET reminder_sent_at = ? WHERE id = ? AND remind_at = ? AND reminder_sent_at IS NULL', [now(), id, remindAt]);
      this.db.query('INSERT OR IGNORE INTO deliveries (task_id, remind_at, sent_at, result) VALUES (?,?,?,?)', [id, remindAt, now(), result]);
    });
  }
  deliveries(limit = 30): { taskId: string; remindAt: string; sentAt: string; result: string }[] { return this.db.query('SELECT * FROM deliveries ORDER BY sent_at DESC LIMIT ?', [limit]).map((r) => ({ taskId: String(r.task_id), remindAt: String(r.remind_at), sentAt: String(r.sent_at), result: String(r.result) })); }
}

export class NotFound extends Error { status = 404; }

export function toCsv(tasks: Task[]): string {
  const cols: (keyof Task)[] = ['id', 'title', 'person', 'notes', 'dueDate', 'dueTime', 'remindAt', 'priority', 'status', 'createdAt', 'updatedAt', 'completedAt'];
  const cell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [cols.join(','), ...tasks.map((t) => cols.map((c) => cell(t[c])).join(','))].join('\r\n') + '\r\n';
}
