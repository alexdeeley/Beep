import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NodeDriver } from '../server/node-driver.ts';
import { buildServices, handle, deliverDue, COOKIE } from '../server/api.ts';
import { PBKDF2_ITERATIONS, hashPin } from '../server/auth.ts';
import { b64u } from '../server/push.ts';

// real subscriber keys, as a browser would make them
async function subKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return { p256dh: b64u(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) };
}

const RECOVERY = 'correct-horse-battery-staple';

// A fake push service: records what it was sent, answers 201.
const pushLog: { url: string; headers: Record<string, string>; bytes: number }[] = [];
const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const h = Object.fromEntries(new Headers(init?.headers).entries());
  pushLog.push({ url: String(url), headers: h, bytes: (init?.body as Uint8Array).byteLength });
  if (String(url).includes('gone')) return new Response('', { status: 410 });
  return new Response('', { status: 201 });
}) as typeof fetch;

function app(recoveryKey: string | null = RECOVERY) {
  const svc = buildServices(new NodeDriver(':memory:'), { recoveryKey: recoveryKey ?? undefined, vapidSubject: 'mailto:test@example.com' }, fakeFetch);
  let cookie = '';
  const scheduled: (string | null)[] = [];
  const call = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-todo': '1', ...extra };
    if (cookie) headers.cookie = cookie;
    const res = await handle(new Request('https://todo.test/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), svc, { ip: '1.2.3.4', schedule: (n) => { scheduled.push(n); } });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.includes('Max-Age=0') ? '' : sc.split(';')[0];
    const text = await res.text();
    let data: Record<string, unknown> & { error?: string } = {};
    try { data = JSON.parse(text); } catch { data = { text } as never; }
    return { status: res.status, body: data, text, headers: res.headers };
  };
  return { svc, call, scheduled, cookie: () => cookie, setCookie: (c: string) => { cookie = c; } };
}

test('a fresh installation is locked: no PIN without the recovery key, nothing readable without a session', async () => {
  const noKey = app(null);
  const st = await noKey.call('GET', '/status');
  assert.equal(st.body.setUp, false); assert.equal(st.body.recoveryConfigured, false);
  const r = await noKey.call('POST', '/setup', { recoveryKey: 'anything', pin: '1234' });
  assert.equal(r.status, 503, 'with no recovery key configured, nobody can set a PIN');
  assert.equal((await noKey.call('GET', '/tasks')).status, 401);

  const { call } = app();
  assert.equal((await call('POST', '/setup', { recoveryKey: 'wrong', pin: '1234' })).status, 401);
  assert.equal((await call('POST', '/setup', { recoveryKey: RECOVERY, pin: '12' })).status, 400, 'a PIN is 4 to 12 digits');
  assert.equal((await call('POST', '/setup', { recoveryKey: RECOVERY, pin: 'abcd' })).status, 400);
  const ok = await call('POST', '/setup', { recoveryKey: RECOVERY, pin: '2468' });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('set-cookie')!, /HttpOnly/); assert.match(ok.headers.get('set-cookie')!, /Secure/); assert.match(ok.headers.get('set-cookie')!, /SameSite=Lax/);
  assert.equal((await call('POST', '/setup', { recoveryKey: RECOVERY, pin: '1111' })).status, 409, 'setup only runs once');
  assert.equal((await call('GET', '/status')).body.authenticated, true);
});

test('the PIN is hashed with PBKDF2 and never stored', async () => {
  const { svc, call } = app();
  await call('POST', '/setup', { recoveryKey: RECOVERY, pin: '2468' });
  const rows = svc.db.query('SELECT key, value FROM settings');
  assert.ok(!rows.some((r) => String(r.value).includes('2468')), 'the PIN digits appear nowhere in settings');
  const hash = String(rows.find((r) => r.key === 'pin_hash')!.value), salt = String(rows.find((r) => r.key === 'pin_salt')!.value);
  assert.equal((await hashPin('2468', salt)).hash, hash);
  assert.notEqual((await hashPin('2469', salt)).hash, hash);
  assert.ok(PBKDF2_ITERATIONS >= 100_000);
});

test('login, logout, idle lock, and a second browser cannot borrow a session', async () => {
  const a = app();
  await a.call('POST', '/setup', { recoveryKey: RECOVERY, pin: '2468' });
  await a.call('POST', '/logout');
  assert.equal(a.cookie(), '', 'logout clears the cookie');
  assert.equal((await a.call('GET', '/tasks')).status, 401);
  assert.equal((await a.call('POST', '/login', { pin: '0000' })).status, 401);
  assert.equal((await a.call('POST', '/login', { pin: '2468' })).status, 200);
  assert.equal((await a.call('GET', '/tasks')).status, 200);
  // another client with a made-up cookie
  const saved = a.cookie();
  a.setCookie(`${COOKIE}=not-a-real-token`);
  assert.equal((await a.call('GET', '/tasks')).status, 401, 'a guessed token is refused');
  a.setCookie(saved);
  // idle timeout: age the session past the lock timeout
  await a.call('PATCH', '/settings', { lockTimeoutMin: 1 });
  a.svc.db.query("UPDATE sessions SET last_seen_at = ?", [new Date(Date.now() - 2 * 60_000).toISOString()]);
  assert.equal((await a.call('GET', '/tasks')).status, 401, 'after the idle timeout the session is gone');
  assert.equal((await a.call('POST', '/login', { pin: '2468' })).status, 200, 'the PIN opens it again');
  // writes need the anti-CSRF header
  assert.equal((await a.call('POST', '/tasks', { title: 'x' }, { 'x-todo': '' })).status, 403);
});

test('wrong PINs are throttled with a growing lockout, shared by every address', async () => {
  const a = app();
  await a.call('POST', '/setup', { recoveryKey: RECOVERY, pin: '2468' });
  await a.call('POST', '/logout');
  for (let i = 0; i < 5; i++) assert.equal((await a.call('POST', '/login', { pin: '9999' })).status, 401);
  const locked = await a.call('POST', '/login', { pin: '2468' });
  assert.equal(locked.status, 429, 'even the right PIN waits during a lockout');
  assert.ok(Number(locked.body.retryAfterSec) >= 50 && Number(locked.body.retryAfterSec) <= 60, `first lockout is a minute (${locked.body.retryAfterSec}s)`);
  assert.equal(locked.headers.get('retry-after'), String(locked.body.retryAfterSec));
  assert.equal((await a.call('POST', '/recover', { recoveryKey: RECOVERY, pin: '1111' })).status, 429, 'recovery waits too');
  assert.ok(Number((await a.call('GET', '/status')).body.lockedForSec) > 0, 'status says it is locked');
  // let the lockout pass
  a.svc.db.query("UPDATE attempts SET at = ?", [new Date(Date.now() - 10 * 60_000).toISOString()]);
  assert.equal((await a.call('POST', '/login', { pin: '2468' })).status, 200);
});

test('recovery resets the PIN and signs every device out', async () => {
  const a = app();
  await a.call('POST', '/setup', { recoveryKey: RECOVERY, pin: '2468' });
  const first = a.cookie();
  const r = await a.call('POST', '/recover', { recoveryKey: RECOVERY, pin: '1357' });
  assert.equal(r.status, 200);
  const second = a.cookie();
  a.setCookie(first);
  assert.equal((await a.call('GET', '/tasks')).status, 401, 'the old session is dead');
  a.setCookie(second);
  assert.equal((await a.call('GET', '/tasks')).status, 200);
  await a.call('POST', '/logout');
  assert.equal((await a.call('POST', '/login', { pin: '2468' })).status, 401);
  assert.equal((await a.call('POST', '/login', { pin: '1357' })).status, 200);
  // change PIN needs the current one
  assert.equal((await a.call('POST', '/pin', { current: '0000', next: '2222' })).status, 401);
  assert.equal((await a.call('POST', '/pin', { current: '1357', next: '2222' })).status, 200);
  await a.call('POST', '/logout');
  assert.equal((await a.call('POST', '/login', { pin: '2222' })).status, 200);
});

test('tasks: create, list, search, people, update, complete, reopen, delete, export', async () => {
  const a = app();
  await a.call('POST', '/setup', { recoveryKey: RECOVERY, pin: '2468' });
  const bad = await a.call('POST', '/tasks', { title: '' });
  assert.equal(bad.status, 400); assert.match(bad.body.error!, /Title is required/);
  assert.equal((await a.call('POST', '/tasks', { title: 'x', dueDate: 'tomorrow' })).status, 400);
  assert.equal((await a.call('POST', '/tasks', { title: 'x', dueTime: '09:00' })).status, 400, 'a time needs a date');
  const t1 = await a.call('POST', '/tasks', { title: 'Call the plumber', person: 'Dave', dueDate: '2026-10-20', dueTime: '14:30', priority: 'high' });
  assert.equal(t1.status, 201); assert.equal(t1.body.status, 'todo'); assert.equal(t1.body.priority, 'high');
  const t2 = await a.call('POST', '/tasks', { title: 'Buy milk', notes: 'semi-skimmed' });
  const t3 = await a.call('POST', '/tasks', { title: 'Send Dave the photos', person: 'dave', dueDate: '2026-10-19' });
  const all = await a.call('GET', '/tasks?status=open');
  assert.deepEqual((all.body.tasks as { title: string }[]).map((t) => t.title), ['Send Dave the photos', 'Call the plumber', 'Buy milk'], 'dated first, soonest first, undated last');
  assert.equal(((await a.call('GET', '/tasks?q=milk')).body.tasks as unknown[]).length, 1);
  assert.equal(((await a.call('GET', '/tasks?q=skimmed')).body.tasks as unknown[]).length, 1, 'search covers notes');
  assert.equal(((await a.call('GET', '/tasks?person=Dave')).body.tasks as unknown[]).length, 2, 'person filter ignores case');
  const people = await a.call('GET', '/people');
  assert.equal((people.body as unknown as { person: string; open: number }[]).length, 1, 'Dave and dave are one person');
  const done = await a.call('PATCH', `/tasks/${t2.body.id}`, { status: 'done' });
  assert.equal(done.body.status, 'done'); assert.ok(done.body.completedAt);
  assert.equal(((await a.call('GET', '/tasks?status=open')).body.tasks as unknown[]).length, 2);
  assert.equal(((await a.call('GET', '/tasks?status=done')).body.tasks as unknown[]).length, 1, 'completed tasks are kept, not deleted');
  const re = await a.call('PATCH', `/tasks/${t2.body.id}`, { status: 'todo' });
  assert.equal(re.body.completedAt, null, 'reopening clears the completion time');
  assert.equal((await a.call('DELETE', `/tasks/${t3.body.id}`)).status, 200);
  assert.equal((await a.call('GET', `/tasks/${t3.body.id}`)).status, 404);
  const csv = await a.call('GET', '/export.csv');
  assert.match(csv.headers.get('content-type')!, /text\/csv/); assert.match(csv.text, /^id,title,person/); assert.match(csv.text, /Call the plumber/);
  const js = await a.call('GET', '/export.json');
  assert.equal(js.body.format, 'todo-export'); assert.equal((js.body.tasks as unknown[]).length, 2);
  // import skips what is already here
  const imp = await a.call('POST', '/import', js.body);
  assert.deepEqual(imp.body, { added: 0, skipped: 2 });
  const imp2 = await a.call('POST', '/import', { tasks: [{ title: 'Imported' }] });
  assert.deepEqual(imp2.body, { added: 1, skipped: 0 });
  assert.equal(a.scheduled.length > 0, true, 'every change re-arms the reminder schedule');
});

test('reminders: due selection, delivery once only, re-arming on edit, completion and deletion', async () => {
  const a = app();
  pushLog.length = 0;
  await a.call('POST', '/setup', { recoveryKey: RECOVERY, pin: '2468' });
  const sub = { endpoint: 'https://push.example/one', keys: await subKeys() };
  assert.equal((await a.call('POST', '/push/subscribe', { endpoint: 'http://insecure', keys: sub.keys })).status, 400);
  assert.equal((await a.call('POST', '/push/subscribe', sub)).status, 201);
  assert.equal((await a.call('POST', '/push/subscribe', { ...sub, endpoint: 'https://push.example/gone' })).status, 201);
  const past = new Date(Date.now() - 60_000).toISOString(), future = new Date(Date.now() + 3600_000).toISOString();
  const t = await a.call('POST', '/tasks', { title: 'Ring Mum', person: 'Mum', remindAt: past });
  const later = await a.call('POST', '/tasks', { title: 'Later', remindAt: future });
  assert.equal(a.scheduled[a.scheduled.length - 1], future, 'the schedule points at the next unsent reminder in the future');
  const d1 = await deliverDue(a.svc);
  assert.equal(d1.delivered, 1); assert.equal(d1.next, future);
  assert.equal(pushLog.length, 2, 'one push per device');
  assert.match(pushLog[0].headers.authorization, /^vapid t=.+, k=.+$/); assert.equal(pushLog[0].headers['content-encoding'], 'aes128gcm'); assert.ok(pushLog[0].bytes > 86);
  const d2 = await deliverDue(a.svc);
  assert.equal(d2.delivered, 0, 'running the scheduler again sends nothing twice');
  const devices = (await a.call('GET', '/push/devices')).body as unknown as { endpoint: string }[];
  assert.equal(devices.length, 1, 'a subscription the push service says is gone is dropped');
  // editing the reminder time makes it live again
  pushLog.length = 0;
  await a.call('PATCH', `/tasks/${t.body.id}`, { remindAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await deliverDue(a.svc)).delivered, 1); assert.equal(pushLog.length, 1);
  // a finished task never fires
  await a.call('PATCH', `/tasks/${later.body.id}`, { remindAt: past, status: 'done' });
  assert.equal((await deliverDue(a.svc)).delivered, 0);
  assert.equal(a.scheduled[a.scheduled.length - 1], null, 'nothing left to wake for');
  // reopened with a reminder still in the past: it fires now, once
  await a.call('PATCH', `/tasks/${later.body.id}`, { status: 'todo' });
  assert.equal((await deliverDue(a.svc)).delivered, 1);
  // deleting a task with a pending reminder clears the schedule
  const t4 = await a.call('POST', '/tasks', { title: 'Soon', remindAt: future });
  assert.equal(a.scheduled[a.scheduled.length - 1], future);
  await a.call('DELETE', `/tasks/${t4.body.id}`);
  assert.equal(a.scheduled[a.scheduled.length - 1], null);
  // notifications off: the reminder is marked handled, nothing is pushed
  pushLog.length = 0;
  await a.call('PATCH', '/settings', { notificationsEnabled: false });
  await a.call('POST', '/tasks', { title: 'Quiet', remindAt: past });
  assert.equal((await deliverDue(a.svc)).delivered, 1); assert.equal(pushLog.length, 0);
  const rem = await a.call('GET', '/reminders');
  assert.equal((rem.body.recent as { result: string }[])[0].result, 'notifications off');
  assert.ok(!JSON.stringify(pushLog).includes('Ring Mum'), 'push bodies are encrypted: the title never travels in clear');
});

test('settings validate their values', async () => {
  const a = app();
  await a.call('POST', '/setup', { recoveryKey: RECOVERY, pin: '2468' });
  assert.equal((await a.call('PATCH', '/settings', { lockTimeoutMin: 7 })).status, 400);
  assert.equal((await a.call('PATCH', '/settings', { defaultReminderTime: '25:00' })).status, 400);
  assert.equal((await a.call('PATCH', '/settings', { timezone: 'Mars/Olympus' })).status, 400);
  const ok = await a.call('PATCH', '/settings', { lockTimeoutMin: 60, defaultReminderTime: '08:30', timezone: 'Europe/London' });
  assert.equal(ok.status, 200); assert.equal(ok.body.lockTimeoutMin, 60); assert.equal(ok.body.defaultReminderTime, '08:30'); assert.equal(ok.body.timezone, 'Europe/London');
});
