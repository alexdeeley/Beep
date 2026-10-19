// The HTTP API on web-standard Request/Response, shared by the Worker and
// the local Node server. Every route except setup/login/recover/status
// needs a valid session cookie. Writes also need the x-todo header, which
// a cross-site form cannot send.
import type { SqlDriver } from './driver.ts';
import { migrate, getSetting, setSetting, now, newId } from './db.ts';
import { AuthService, AuthError, LOCK_CHOICES, hashPin } from './auth.ts';
import { TaskService, ValidationError, NotFound, toCsv } from './tasks.ts';
import type { Task } from './tasks.ts';
import { ensureVapid, sendPush } from './push.ts';
import type { PushSub, Vapid } from './push.ts';

export const VERSION = '1.0.0';
export const COOKIE = 'todo_session';

export interface Env { recoveryKey?: string; vapidSubject?: string; environment?: string }
export interface Services { db: SqlDriver; auth: AuthService; tasks: TaskService; env: Env; fetcher: typeof fetch }

export function buildServices(db: SqlDriver, env: Env, fetcher: typeof fetch = fetch): Services {
  migrate(db);
  return { db, auth: new AuthService(db, env.recoveryKey), tasks: new TaskService(db), env, fetcher };
}

class HttpError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
const json = (data: unknown, status = 200, headers: Record<string, string> = {}): Response => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const err = (message: string, status: number, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response => json({ error: message, ...extra }, status, headers);

const cookieToken = (req: Request): string | null => { const m = (req.headers.get('cookie') ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`)); return m ? m[1] : null; };
const setCookie = (req: Request, token: string | null): Record<string, string> => {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return { 'set-cookie': token ? `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}${secure}` : `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}` };
};

export interface HandleOptions { ip?: string; schedule?: (nextIso: string | null) => void | Promise<void> }

export async function handle(request: Request, svc: Services, opts: HandleOptions = {}): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();
  const token = cookieToken(request);
  const label = (request.headers.get('user-agent') ?? '').replace(/\(.*?\)/g, '').trim().slice(0, 60) || 'device';
  try {
    const body = async () => { try { return await request.json() as Record<string, unknown>; } catch { throw new HttpError(400, 'The request body must be JSON'); } };
    const write = method !== 'GET' && method !== 'HEAD';
    if (write) {
      if (request.headers.get('x-todo') !== '1') throw new HttpError(403, 'Missing the x-todo header');
      if (!rateLimit(opts.ip ?? 'local')) throw new HttpError(429, 'Too many requests; slow down');
    }
    const reschedule = async () => { if (opts.schedule) await opts.schedule(svc.tasks.nextReminderAt()); };

    // ── open routes ──
    if (path === '/health') {
      // a self-test of the one primitive the lock depends on, so a broken
      // runtime shows here instead of as a mystery 500 at setup
      let pbkdf2 = 'ok';
      try { await hashPin('0000'); } catch (e) { pbkdf2 = `${(e as Error).name}: ${(e as Error).message}`; }
      return json({ ok: pbkdf2 === 'ok', version: VERSION, pbkdf2 });
    }
    if (path === '/status') {
      const s = await svc.auth.session(token);
      return json({ version: VERSION, setUp: svc.auth.isSetUp(), recoveryConfigured: svc.auth.hasRecoveryKey(), authenticated: !!s, lockedForSec: svc.auth.lockedForSec(), lockTimeoutMin: svc.auth.lockTimeoutMin(), vapidPublicKey: (await ensureVapid(svc.db)).publicKey });
    }
    if (path === '/setup' && method === 'POST') { const b = await body(); const t = await svc.auth.setup(b.recoveryKey, b.pin, label); return json({ ok: true }, 200, setCookie(request, t)); }
    if (path === '/login' && method === 'POST') { const b = await body(); const t = await svc.auth.login(b.pin, label); return json({ ok: true }, 200, setCookie(request, t)); }
    if (path === '/recover' && method === 'POST') { const b = await body(); const t = await svc.auth.recover(b.recoveryKey, b.pin, label); return json({ ok: true }, 200, setCookie(request, t)); }
    if (path === '/logout' && method === 'POST') { await svc.auth.logout(token); return json({ ok: true }, 200, setCookie(request, null)); }

    // ── everything below needs a session ──
    const session = await svc.auth.session(token);
    if (!session) throw new HttpError(401, 'Locked. Enter your PIN.');
    let g: RegExpMatchArray | null;
    const m = (re: RegExp) => path.match(re);

    if (path === '/tasks' && method === 'GET') {
      const st = url.searchParams.get('status');
      return json({ now: now(), tasks: svc.tasks.list({ status: st === 'open' || st === 'todo' || st === 'doing' || st === 'done' ? st : undefined, q: url.searchParams.get('q') || undefined, person: url.searchParams.get('person') || undefined, updatedSince: url.searchParams.get('since') || undefined }) });
    }
    if (path === '/tasks' && method === 'POST') { const t = svc.tasks.create(await body()); await reschedule(); return json(t, 201); }
    if ((g = m(/^\/tasks\/([^/]+)$/))) {
      if (method === 'GET') return json(svc.tasks.get(g[1]));
      if (method === 'PATCH') { const t = svc.tasks.update(g[1], await body()); await reschedule(); return json(t); }
      if (method === 'DELETE') { svc.tasks.remove(g[1]); await reschedule(); return json({ ok: true }); }
    }
    if (path === '/people') return json(svc.tasks.people());
    if (path === '/reminders') return json({ now: now(), upcoming: svc.tasks.upcomingReminders(), recent: svc.tasks.deliveries(), next: svc.tasks.nextReminderAt() });
    if (path === '/export.json') return new Response(JSON.stringify({ format: 'todo-export', version: 1, exportedAt: now(), tasks: svc.tasks.list() }, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="todo-${now().slice(0, 10)}.json"`, 'cache-control': 'no-store' } });
    if (path === '/export.csv') return new Response(toCsv(svc.tasks.list()), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="todo-${now().slice(0, 10)}.csv"`, 'cache-control': 'no-store' } });
    if (path === '/import' && method === 'POST') {
      const b = await body();
      const list = Array.isArray(b.tasks) ? b.tasks : [];
      let added = 0, skipped = 0;
      svc.db.transaction(() => {
        for (const raw of list as Record<string, unknown>[]) {
          const existing = typeof raw.id === 'string' ? svc.db.query('SELECT id FROM tasks WHERE id = ?', [raw.id]) : [];
          if (existing.length) { skipped++; continue; }
          svc.tasks.create(raw); added++;
        }
      });
      await reschedule();
      return json({ added, skipped });
    }

    if (path === '/settings' && method === 'GET') return json(settings(svc));
    if (path === '/settings' && method === 'PATCH') {
      const b = await body();
      if (b.lockTimeoutMin !== undefined) { const n = Number(b.lockTimeoutMin); if (!(LOCK_CHOICES as readonly number[]).includes(n)) throw new ValidationError('Lock timeout must be one of ' + LOCK_CHOICES.join(', ') + ' minutes'); setSetting(svc.db, 'lock_timeout_min', String(n)); }
      if (b.defaultReminderTime !== undefined) { const s = String(b.defaultReminderTime ?? ''); if (s && !/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw new ValidationError('Default reminder time must look like 09:00'); setSetting(svc.db, 'default_reminder_time', s); }
      if (b.notificationsEnabled !== undefined) setSetting(svc.db, 'notifications_enabled', b.notificationsEnabled ? '1' : '0');
      if (b.timezone !== undefined) { const tz = String(b.timezone).slice(0, 64); try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { throw new ValidationError('Unknown time zone'); } setSetting(svc.db, 'timezone', tz); }
      return json(settings(svc));
    }
    if (path === '/pin' && method === 'POST') { const b = await body(); await svc.auth.changePin(token, b.current, b.next); return json({ ok: true }); }
    if (path === '/sessions' && method === 'GET') return json(svc.auth.sessions().map((s) => ({ ...s, current: s.id === session.id })));
    if (path === '/sessions/others' && method === 'DELETE') { svc.db.query('DELETE FROM sessions WHERE id <> ?', [session.id]); return json({ ok: true }); }

    // ── push subscriptions ──
    if (path === '/push/subscribe' && method === 'POST') {
      const b = await body();
      const keys = (b.keys ?? {}) as Record<string, unknown>;
      if (typeof b.endpoint !== 'string' || !/^https:\/\//.test(b.endpoint) || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') throw new ValidationError('That is not a push subscription');
      svc.db.query('INSERT INTO push_subs (id, endpoint, p256dh, auth, label, created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label, failures = 0', [newId('sub'), b.endpoint, keys.p256dh, keys.auth, typeof b.label === 'string' ? b.label.slice(0, 80) : label, now()]);
      setSetting(svc.db, 'notifications_enabled', '1');
      await reschedule();
      return json({ ok: true, devices: pushDevices(svc) }, 201);
    }
    if (path === '/push/subscribe' && method === 'DELETE') { const b = await body(); svc.db.query('DELETE FROM push_subs WHERE endpoint = ?', [String(b.endpoint ?? '')]); return json({ ok: true, devices: pushDevices(svc) }); }
    if (path === '/push/devices' && method === 'GET') return json(pushDevices(svc));
    if (path === '/push/test' && method === 'POST') {
      const r = await broadcast(svc, { title: 'To-do: notifications work', body: 'This is a test from your to-do list.', url: '/' });
      return json(r);
    }
    if (path === '/push/deliver' && method === 'POST') return json(await deliverDue(svc));   // used by the local dev server's timer

    throw new HttpError(404, 'Not found');
  } catch (e) {
    if (e instanceof AuthError) return err(e.message, e.status, e.retryAfterSec ? { retryAfterSec: e.retryAfterSec } : {}, e.retryAfterSec ? { 'retry-after': String(e.retryAfterSec) } : {});
    if (e instanceof ValidationError || e instanceof NotFound || e instanceof HttpError) return err(e.message, (e as { status: number }).status);
    console.error(e);
    return err('Something went wrong on the server', 500, { detail: (e as Error)?.name || 'Error' });
  }
}

function settings(svc: Services) {
  return {
    lockTimeoutMin: svc.auth.lockTimeoutMin(), lockChoices: LOCK_CHOICES, defaultReminderTime: getSetting(svc.db, 'default_reminder_time') ?? '09:00',
    notificationsEnabled: getSetting(svc.db, 'notifications_enabled') !== '0', timezone: getSetting(svc.db, 'timezone') ?? '', pinChangedAt: getSetting(svc.db, 'pin_changed_at'),
    recoveryConfigured: svc.auth.hasRecoveryKey(), devices: pushDevices(svc), counts: svc.tasks.count(),
  };
}
const pushDevices = (svc: Services) => svc.db.query('SELECT endpoint, label, created_at, last_ok_at, failures FROM push_subs ORDER BY created_at').map((r) => ({ endpoint: String(r.endpoint), label: String(r.label), createdAt: String(r.created_at), lastOkAt: r.last_ok_at ? String(r.last_ok_at) : null, failures: Number(r.failures) }));

async function broadcast(svc: Services, payload: { title: string; body: string; url: string; tag?: string }): Promise<{ sent: number; failed: number; removed: number }> {
  const subs = svc.db.query('SELECT * FROM push_subs');
  if (!subs.length) return { sent: 0, failed: 0, removed: 0 };
  const vapid: Vapid = await ensureVapid(svc.db);
  let sent = 0, failed = 0, removed = 0;
  for (const s of subs) {
    const sub: PushSub = { endpoint: String(s.endpoint), p256dh: String(s.p256dh), auth: String(s.auth) };
    const r = await sendPush(sub, JSON.stringify(payload), vapid, svc.env.vapidSubject ?? 'mailto:admin@deeley.org', 24 * 3600, svc.fetcher);
    if (r.ok) { sent++; svc.db.query('UPDATE push_subs SET last_ok_at = ?, failures = 0 WHERE endpoint = ?', [now(), sub.endpoint]); }
    else if (r.gone) { removed++; svc.db.query('DELETE FROM push_subs WHERE endpoint = ?', [sub.endpoint]); }
    else { failed++; svc.db.query('UPDATE push_subs SET failures = failures + 1 WHERE endpoint = ?', [sub.endpoint]); if (Number(s.failures) + 1 >= 20) svc.db.query('DELETE FROM push_subs WHERE endpoint = ?', [sub.endpoint]); }
  }
  return { sent, failed, removed };
}

// Send every reminder that is due. Each task's reminder is marked sent
// before the next is attempted, so a retry can never double up.
export async function deliverDue(svc: Services): Promise<{ delivered: number; next: string | null }> {
  const enabled = getSetting(svc.db, 'notifications_enabled') !== '0';
  let delivered = 0;
  for (const t of svc.tasks.due()) {
    const remindAt = t.remindAt!;
    let result = 'notifications off';
    if (enabled) { const r = await broadcast(svc, { title: t.title, body: reminderBody(t), url: `/task/${t.id}`, tag: `task-${t.id}` }); result = `sent ${r.sent}, failed ${r.failed}, removed ${r.removed}`; }
    svc.tasks.markSent(t.id, remindAt, result);
    delivered++;
  }
  return { delivered, next: svc.tasks.nextReminderAt() };
}
const reminderBody = (t: Task): string => [t.person ? `For ${t.person}` : '', t.dueDate ? `Due ${t.dueDate}${t.dueTime ? ' ' + t.dueTime : ''}` : '', t.priority === 'high' ? 'High priority' : ''].filter(Boolean).join(' · ') || 'Reminder';

// Light in-memory rate limit on writes: 240 a minute per address.
const recent = new Map<string, number[]>();
function rateLimit(ip: string): boolean {
  const t = Date.now();
  const list = (recent.get(ip) ?? []).filter((x) => t - x < 60_000);
  if (list.length >= 240) return false;
  list.push(t); recent.set(ip, list);
  return true;
}
