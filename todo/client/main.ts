// The app. No framework: functions that return DOM, a tiny router, an API
// client with an offline outbox, a lock screen, and the pages.
import type { Task, Priority, Status } from '../server/tasks.ts';

// ── DOM helpers ──
type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown>;
function h(tag: string, attrs: Attrs | null = null, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'value' && 'value' in el) (el as HTMLInputElement).value = String(v);
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden' || k === 'required' || k === 'autofocus') { if (v) el.setAttribute(k, ''); }
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}
const add = (el: HTMLElement, ...c: Child[]): void => append(el, c);
const fill = (el: HTMLElement, ...c: Child[]): void => { el.replaceChildren(); append(el, c); };
function append(el: HTMLElement, children: Child[]): void { for (const c of children) { if (c == null || c === false) continue; if (Array.isArray(c)) append(el, c); else if (c instanceof Node) el.appendChild(c); else el.appendChild(document.createTextNode(String(c))); } }
const $ = (id: string) => document.getElementById(id)!;
function toast(text: string): void { const t = h('div', { class: 'toast' }, text); $('toasts').appendChild(t); setTimeout(() => t.classList.add('out'), 3500); setTimeout(() => t.remove(), 4000); }
const field = (label: string, control: HTMLElement, help?: string, id?: string): HTMLElement => { const cid = id ?? control.id ?? (control.id = 'f_' + Math.random().toString(36).slice(2, 8)); control.id = cid; return h('div', { class: 'field' }, h('label', { for: cid }, label), control, help ? h('div', { class: 'help' }, help) : null); };

// ── routing ──
type Page = (params: string[], q: URLSearchParams) => Promise<Node> | Node;
const routes: { re: RegExp; page: Page }[] = [];
const route = (re: RegExp, page: Page) => routes.push({ re, page });
function navigate(path: string, replace = false): void { if (replace) history.replaceState(null, '', path); else history.pushState(null, '', path); void render(); }
const link = (href: string, attrs: Attrs | null, ...children: Child[]) => h('a', { href, ...attrs, onClick: (e: MouseEvent) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); navigate(href); } }, ...children);
document.addEventListener('click', (e) => { const a = (e.target as HTMLElement).closest('a[data-link]') as HTMLAnchorElement | null; if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); navigate(a.getAttribute('href')!); });
window.addEventListener('popstate', () => void render());

// ── API client with an outbox for when the network is away ──
class ApiError extends Error { status: number; body: Record<string, unknown>; constructor(status: number, body: Record<string, unknown>) { super(String(body.error ?? 'Request failed')); this.status = status; this.body = body; } }
type Outbox = { id: string; method: string; path: string; body?: unknown; at: string }[];
const store = {
  get<T>(k: string, fallback: T): T { try { const v = localStorage.getItem('todo.' + k); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; } },
  set(k: string, v: unknown): void { try { if (v == null) localStorage.removeItem('todo.' + k); else localStorage.setItem('todo.' + k, JSON.stringify(v)); } catch { /* storage blocked: the app still works online */ } },
};
async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'x-todo': '1' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch('/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  const data = (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : {};
  if (res.status === 401) { showLock(); throw new ApiError(401, data); }
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}
const online = () => navigator.onLine;
async function flushOutbox(): Promise<void> {
  const box = store.get<Outbox>('outbox', []);
  if (!box.length || !online()) return;
  const left: Outbox = [];
  for (const item of box) {
    try { await api(item.method, item.path, item.body); }
    catch (e) { if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429) { /* bad request: drop it, it cannot ever succeed */ } else left.push(item); }
  }
  store.set('outbox', left);
  if (box.length !== left.length) { toast(`${box.length - left.length} saved change${box.length - left.length === 1 ? '' : 's'} sent`); await loadTasks(); void render(); }
}
window.addEventListener('online', () => { $('offline').hidden = true; void flushOutbox(); });
window.addEventListener('offline', () => { $('offline').hidden = false; });

// ── state ──
let tasks: Task[] = store.get<Task[]>('cache', []);
let status: { setUp: boolean; recoveryConfigured: boolean; authenticated: boolean; lockedForSec: number; lockTimeoutMin: number; vapidPublicKey: string } | null = null;
let lastActivity = Date.now();
const currentStatus = () => status;
async function loadTasks(): Promise<Task[]> {
  try { const r = await api<{ tasks: Task[] }>('GET', '/tasks'); tasks = r.tasks; store.set('cache', tasks); store.set('syncedAt', new Date().toISOString()); }
  catch (e) { if (!(e instanceof ApiError)) $('offline').hidden = false; }
  return tasks;
}
// optimistic writes: change the cache now, send now or later
async function write(method: string, path: string, body: unknown, apply: (list: Task[]) => Task[]): Promise<void> {
  tasks = apply(tasks); store.set('cache', tasks);
  if (!online()) { const box = store.get<Outbox>('outbox', []); box.push({ id: Math.random().toString(36).slice(2), method, path, body, at: new Date().toISOString() }); store.set('outbox', box); toast('Saved on this device. It will sync when you are back online.'); return; }
  try { await api(method, path, body); await loadTasks(); }
  catch (e) { if (e instanceof ApiError) { toast(e.message); await loadTasks(); throw e; } const box = store.get<Outbox>('outbox', []); box.push({ id: Math.random().toString(36).slice(2), method, path, body, at: new Date().toISOString() }); store.set('outbox', box); $('offline').hidden = false; toast('No connection. Saved here; it will sync later.'); }
}

// ── dates (everything shown in the device's own time zone) ──
const pad = (n: number) => String(n).padStart(2, '0');
const todayStr = (): string => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const addDays = (ymd: string, n: number): string => { const d = new Date(ymd + 'T12:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtDate = (ymd: string): string => { const t = todayStr(); if (ymd === t) return 'Today'; if (ymd === addDays(t, 1)) return 'Tomorrow'; if (ymd === addDays(t, -1)) return 'Yesterday'; return new Date(ymd + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: ymd.slice(0, 4) === t.slice(0, 4) ? undefined : 'numeric' }); };
const fmtTime = (hm: string): string => new Date(`2000-01-01T${hm}:00`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const fmtInstant = (iso: string): string => { const d = new Date(iso); const ymd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; return `${fmtDate(ymd)} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`; };
const localToIso = (ymd: string, hm: string): string => new Date(`${ymd}T${hm}:00`).toISOString();
const isoToLocal = (iso: string): { date: string; time: string } => { const d = new Date(iso); return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }; };
const isOverdue = (t: Task): boolean => t.status !== 'done' && !!t.dueDate && (t.dueDate < todayStr() || (t.dueDate === todayStr() && !!t.dueTime && t.dueTime < `${pad(new Date().getHours())}:${pad(new Date().getMinutes())}`));

// ── the lock screen (setup, PIN, recovery) ──
let lockMode: 'pin' | 'setup' | 'recover' = 'pin';
function showLock(): void { const l = $('lock'); if (!l.hidden) return; l.hidden = false; $('top').hidden = true; drawLock(); }
function hideLock(): void { $('lock').hidden = true; $('top').hidden = false; }
async function refreshStatus(): Promise<void> { try { status = await api('GET', '/status'); } catch { status = status ?? { setUp: true, recoveryConfigured: true, authenticated: false, lockedForSec: 0, lockTimeoutMin: 15, vapidPublicKey: '' }; } }

function drawLock(): void {
  const box = $('lock'); box.replaceChildren();
  const inner = h('div', { class: 'lock-inner' });
  box.appendChild(inner);
  const msg = h('div', { class: 'msg', role: 'alert', hidden: true });
  const say = (text: string, kind = 'error') => { msg.textContent = text; msg.className = `msg ${kind}`; msg.hidden = false; };
  if (!status?.setUp) lockMode = 'setup';
  if (lockMode === 'setup' || lockMode === 'recover') {
    const setup = lockMode === 'setup';
    const key = h('input', { type: 'password', autocomplete: 'off', placeholder: 'Recovery key', 'aria-label': 'Recovery key' }) as HTMLInputElement;
    const pin1 = h('input', { type: 'password', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'new-password', placeholder: '4 to 12 digits' }) as HTMLInputElement;
    const pin2 = h('input', { type: 'password', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'new-password', placeholder: 'Same again' }) as HTMLInputElement;
    const go = h('button', { class: 'btn primary wide', type: 'submit' }, setup ? 'Set my PIN' : 'Reset my PIN') as HTMLButtonElement;
    add(inner,
      h('h1', null, setup ? 'Set up your to-do list' : 'Reset your PIN'),
      h('p', { class: 'sub' }, setup ? 'This list is private. To set your PIN the first time, enter the recovery key that was configured on the server.' : 'Enter the recovery key, then choose a new PIN. Every other device will be signed out.'),
      status && !status.recoveryConfigured ? h('div', { class: 'card warn' }, 'No recovery key is set on the server yet, so a PIN cannot be created. Add the TODO_RECOVERY_KEY secret and redeploy (see the README). Nobody can get in until then.') : null,
      h('form', { class: 'form', onSubmit: async (e: Event) => {
        e.preventDefault();
        if (!/^\d{4,12}$/.test(pin1.value)) { say('The PIN must be 4 to 12 digits.'); pin1.focus(); return; }
        if (pin1.value !== pin2.value) { say('The two PINs do not match.'); pin2.focus(); return; }
        go.disabled = true;
        try { await api('POST', setup ? '/setup' : '/recover', { recoveryKey: key.value, pin: pin1.value }); lockMode = 'pin'; await refreshStatus(); hideLock(); toast(setup ? 'PIN set. Welcome.' : 'PIN reset.'); await loadTasks(); void render(); }
        catch (err) { say(err instanceof Error ? err.message : String(err)); }
        finally { go.disabled = false; }
      } },
        field('Recovery key', key),
        field('New PIN', pin1, 'Digits only, 4 to 12 of them.'),
        field('New PIN again', pin2),
        msg, go),
      h('div', { class: 'links' }, status?.setUp ? h('button', { type: 'button', onClick: () => { lockMode = 'pin'; drawLock(); } }, 'Back to the PIN') : null));
    setTimeout(() => key.focus(), 50);
    return;
  }
  // PIN keypad
  let pin = '';
  const dots = h('div', { class: 'dots', 'aria-hidden': 'true' });
  const live = h('div', { class: 'sr', 'aria-live': 'polite' });
  const drawDots = () => { dots.replaceChildren(...Array.from({ length: Math.max(4, pin.length) }, (_, i) => h('i', { class: i < pin.length ? 'on' : '' }))); live.textContent = `${pin.length} digit${pin.length === 1 ? '' : 's'} entered`; };
  const submit = async () => {
    if (pin.length < 4) { say('Enter at least 4 digits, then press Enter.'); return; }
    try { await api('POST', '/login', { pin }); pin = ''; await refreshStatus(); hideLock(); lastActivity = Date.now(); await loadTasks(); void render(); }
    catch (err) { pin = ''; drawDots(); say(err instanceof Error ? err.message : String(err)); }
  };
  const key = (label: string, cls = '', act?: () => void) => h('button', { type: 'button', class: cls, 'aria-label': label === '⌫' ? 'Delete a digit' : label === '↵' ? 'Enter' : label, onClick: act ?? (() => { if (pin.length < 12) { pin += label; drawDots(); msg.hidden = true; } }) }, label);
  add(inner,
    h('h1', null, 'Enter your PIN'),
    h('p', { class: 'sub' }, status?.lockedForSec ? `Locked for ${status.lockedForSec} seconds after too many wrong tries.` : 'Your to-do list is locked.'),
    dots, live, msg,
    h('div', { class: 'keypad', role: 'group', 'aria-label': 'PIN keypad' }, ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => key(d)), key('⌫', 'word', () => { pin = pin.slice(0, -1); drawDots(); }), key('0'), key('↵', 'word', () => void submit())),
    h('div', { class: 'links' }, h('button', { type: 'button', onClick: () => { lockMode = 'recover'; drawLock(); } }, 'Forgot your PIN?')));
  drawDots();
  box.onkeydown = (e: KeyboardEvent) => { if ((e.target as HTMLElement).tagName === 'INPUT') return; if (/^\d$/.test(e.key) && pin.length < 12) { pin += e.key; drawDots(); } else if (e.key === 'Backspace') { pin = pin.slice(0, -1); drawDots(); } else if (e.key === 'Enter') void submit(); };
  setTimeout(() => (inner.querySelector('.keypad button') as HTMLElement | null)?.focus(), 50);
}

// ── shared pieces ──
const NAV: [string, string][] = [['/', 'Today'], ['/upcoming', 'Upcoming'], ['/all', 'All'], ['/done', 'Done'], ['/people', 'People'], ['/reminders', 'Reminders'], ['/search', 'Search'], ['/settings', 'Settings']];
function drawNav(): void {
  const open = tasks.filter((t) => t.status !== 'done');
  const counts: Record<string, number> = { '/': open.filter((t) => t.dueDate && t.dueDate <= todayStr()).length, '/upcoming': open.filter((t) => t.dueDate && t.dueDate > todayStr()).length, '/all': open.length };
  $('nav').replaceChildren(...NAV.map(([href, label]) => link(href, { class: location.pathname === href ? 'active' : '', 'aria-current': location.pathname === href ? 'page' : null }, label, counts[href] ? h('span', { class: 'n' }, String(counts[href])) : null)));
}
const priorityTag = (p: Priority) => p === 'high' ? h('span', { class: 'tag inv' }, 'High priority') : p === 'low' ? h('span', { class: 'tag' }, 'Low') : null;
function taskRow(t: Task): HTMLElement {
  const done = t.status === 'done';
  const toggle = async () => { const next: Status = done ? 'todo' : 'done'; await write('PATCH', `/tasks/${t.id}`, { status: next }, (l) => l.map((x) => x.id === t.id ? { ...x, status: next, completedAt: next === 'done' ? new Date().toISOString() : null } : x)); toast(next === 'done' ? `Done: ${t.title}` : `Reopened: ${t.title}`); void render(); };
  return h('li', { class: `task ${done ? 'is-done' : ''}` },
    h('button', { type: 'button', class: 'done-btn', 'aria-label': done ? `Reopen ${t.title}` : `Mark ${t.title} done`, 'aria-pressed': String(done), onClick: toggle }, done ? '✓' : ''),
    h('div', { class: 'task-body' },
      link(`/task/${t.id}`, { class: 'task-title' }, t.title),
      h('div', { class: 'task-meta' },
        isOverdue(t) ? h('span', { class: 'tag inv' }, 'Overdue') : null,
        t.dueDate ? h('span', null, h('b', null, 'Due '), fmtDate(t.dueDate), t.dueTime ? ' ' + fmtTime(t.dueTime) : '') : null,
        t.person ? h('span', null, h('b', null, 'For '), t.person) : null,
        priorityTag(t.priority),
        t.status === 'doing' ? h('span', { class: 'tag' }, 'In progress') : null,
        t.remindAt && !done ? h('span', null, h('b', null, '⏰ '), fmtInstant(t.remindAt)) : null,
        done && t.completedAt ? h('span', null, 'Done ', fmtInstant(t.completedAt)) : null)));
}
const taskList = (list: Task[], emptyText: string) => list.length ? h('ul', { class: 'tasks' }, ...list.map(taskRow)) : h('p', { class: 'empty' }, emptyText);
const section = (title: string, list: Task[], emptyText?: string): HTMLElement => (list.length || emptyText) ? h('section', null, h('h2', null, title, h('span', { class: 'section-count' }, `${list.length}`)), taskList(list, emptyText ?? '')) : h('span', { hidden: true });
const addButton = () => link('/new', { class: 'btn primary huge' }, '+ Add task');
const sortBy = (list: Task[], key: string): Task[] => {
  const p = { high: 0, normal: 1, low: 2 };
  const by = key === 'priority' ? (a: Task, b: Task) => p[a.priority] - p[b.priority] || (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9') : key === 'created' ? (a: Task, b: Task) => b.createdAt.localeCompare(a.createdAt) : (a: Task, b: Task) => (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9') || (a.dueTime ?? '9').localeCompare(b.dueTime ?? '9') || p[a.priority] - p[b.priority];
  return [...list].sort(by);
};
function filters(q: URLSearchParams, base: string, extra: Record<string, string> = {}): HTMLElement {
  const sel = (name: string, options: [string, string][], label: string) => { const s = h('select', { 'aria-label': label, onChange: () => { const u = new URLSearchParams(q); u.set(name, s.value); if (!s.value) u.delete(name); navigate(`${base}${u.toString() ? '?' + u : ''}`); } }, ...options.map(([v, l]) => h('option', { value: v, selected: (q.get(name) ?? '') === v }, l))) as HTMLSelectElement; return s; };
  const people = [...new Set(tasks.map((t) => t.person).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return h('div', { class: 'toolbar' },
    sel('sort', [['', 'Sort: due date'], ['priority', 'Sort: priority'], ['created', 'Sort: newest']], 'Sort order'),
    sel('priority', [['', 'Any priority'], ['high', 'High priority'], ['normal', 'Normal priority'], ['low', 'Low priority']], 'Priority filter'),
    people.length ? sel('person', [['', 'Anyone'], ...people.map((p): [string, string] => [p, p])], 'Person filter') : null,
    ...Object.entries(extra).map(([k, v]) => h('span', { class: 'sr' }, `${k} ${v}`)));
}
const applyFilters = (list: Task[], q: URLSearchParams): Task[] => sortBy(list.filter((t) => (!q.get('priority') || t.priority === q.get('priority')) && (!q.get('person') || t.person.toLowerCase() === q.get('person')!.toLowerCase())), q.get('sort') ?? '');

// ── pages ──
route(/^\/$/, (_p, q) => {
  const open = applyFilters(tasks.filter((t) => t.status !== 'done'), q);
  const today = todayStr();
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today), due = open.filter((t) => t.dueDate === today), undated = open.filter((t) => !t.dueDate);
  return h('div', null, h('h1', null, 'Today', h('span', { class: 'section-count' }, new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }))),
    addButton(),
    overdue.length ? section('Overdue', overdue) : null,
    section('Due today', due, overdue.length || undated.length ? 'Nothing due today.' : 'Nothing due today. Add a task, or look at Upcoming.'),
    undated.length ? section('No date', undated) : null,
    filters(q, '/'));
});
route(/^\/upcoming$/, (_p, q) => {
  const open = applyFilters(tasks.filter((t) => t.status !== 'done' && t.dueDate && t.dueDate > todayStr()), q);
  const groups = new Map<string, Task[]>();
  for (const t of open) { const k = t.dueDate!; groups.set(k, [...(groups.get(k) ?? []), t]); }
  return h('div', null, h('h1', null, 'Upcoming'), addButton(), filters(q, '/upcoming'),
    groups.size ? [...groups.entries()].map(([d, list]) => section(fmtDate(d), list)) : h('p', { class: 'empty' }, 'Nothing with a future date.'));
});
route(/^\/all$/, (_p, q) => { const open = applyFilters(tasks.filter((t) => t.status !== 'done'), q); return h('div', null, h('h1', null, 'All open tasks', h('span', { class: 'section-count' }, String(open.length))), addButton(), filters(q, '/all'), taskList(open, 'Nothing to do. Enjoy it.')); });
route(/^\/done$/, (_p, q) => { const done = applyFilters(tasks.filter((t) => t.status === 'done'), q).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')); return h('div', null, h('h1', null, 'Completed', h('span', { class: 'section-count' }, String(done.length))), h('p', { class: 'muted' }, 'Finished tasks stay here. Tap the tick to reopen one, or open it to delete it.'), taskList(done, 'Nothing completed yet.')); });
route(/^\/people$/, () => {
  const by = new Map<string, Task[]>();
  for (const t of tasks) if (t.person) { const k = t.person.toLowerCase(); by.set(k, [...(by.get(k) ?? []), t]); }
  const list = [...by.values()].map((l) => ({ name: l[0].person, open: l.filter((t) => t.status !== 'done').length, total: l.length })).sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
  return h('div', null, h('h1', null, 'People'), h('p', { class: 'muted' }, 'Everyone a task is for.'),
    list.length ? h('ul', { class: 'people' }, ...list.map((p) => h('li', null, link(`/person/${encodeURIComponent(p.name)}`, null, h('span', null, p.name), h('span', { class: 'muted' }, `${p.open} open · ${p.total} total`))))) : h('p', { class: 'empty' }, 'No tasks name a person yet. Add a person when you add a task.'));
});
route(/^\/person\/([^/]+)$/, ([name], q) => { const who = decodeURIComponent(name); const mine = tasks.filter((t) => t.person.toLowerCase() === who.toLowerCase()); const open = applyFilters(mine.filter((t) => t.status !== 'done'), q), done = mine.filter((t) => t.status === 'done'); return h('div', null, h('p', null, link('/people', null, '‹ People')), h('h1', null, who), link(`/new?person=${encodeURIComponent(who)}`, { class: 'btn primary huge' }, `+ Add task for ${who}`), section('Open', open, 'Nothing open.'), done.length ? section('Completed', done) : null); });
route(/^\/search$/, (_p, q) => {
  const term = (q.get('q') ?? '').trim();
  const input = h('input', { type: 'search', value: term, placeholder: 'Title, person or notes', 'aria-label': 'Search tasks', autofocus: !term }) as HTMLInputElement;
  const n = term.toLowerCase();
  const hits = term ? sortBy(tasks.filter((t) => t.title.toLowerCase().includes(n) || t.person.toLowerCase().includes(n) || t.notes.toLowerCase().includes(n)), '') : [];
  return h('div', null, h('h1', null, 'Search'),
    h('form', { class: 'search-row', onSubmit: (e: Event) => { e.preventDefault(); navigate(`/search?q=${encodeURIComponent(input.value.trim())}`); } }, input, h('button', { class: 'btn', type: 'submit' }, 'Search')),
    term ? taskList(hits, `Nothing matches "${term}".`) : h('p', { class: 'muted' }, 'Type part of a title, a name, or a note.'));
});

// the task form, for new and existing tasks
function taskForm(t: Task | null, q: URLSearchParams): HTMLElement {
  const draftKey = 'draft.' + (t?.id ?? 'new');
  const draft = store.get<Partial<Task> & { reminderDate?: string; reminderTime?: string }>(draftKey, {}) ?? {};
  const v = { title: draft.title ?? t?.title ?? '', person: draft.person ?? t?.person ?? q.get('person') ?? '', notes: draft.notes ?? t?.notes ?? '', dueDate: draft.dueDate ?? t?.dueDate ?? '', dueTime: draft.dueTime ?? t?.dueTime ?? '', priority: (draft.priority ?? t?.priority ?? 'normal') as Priority, status: (draft.status ?? t?.status ?? 'todo') as Status, reminderDate: draft.reminderDate ?? (t?.remindAt ? isoToLocal(t.remindAt).date : ''), reminderTime: draft.reminderTime ?? (t?.remindAt ? isoToLocal(t.remindAt).time : '') };
  const title = h('input', { type: 'text', value: v.title, placeholder: 'What needs doing?', maxlength: 300, required: true, autocomplete: 'off', autofocus: !t }) as HTMLInputElement;
  const person = h('input', { type: 'text', value: v.person, placeholder: 'Who it is for or about', maxlength: 120, list: 'people-list', autocomplete: 'off' }) as HTMLInputElement;
  const notes = h('textarea', { placeholder: 'Anything else', maxlength: 5000 }, v.notes) as HTMLTextAreaElement;
  const dueDate = h('input', { type: 'date', value: v.dueDate }) as HTMLInputElement;
  const dueTime = h('input', { type: 'time', value: v.dueTime }) as HTMLInputElement;
  const remDate = h('input', { type: 'date', value: v.reminderDate }) as HTMLInputElement;
  const remTime = h('input', { type: 'time', value: v.reminderTime }) as HTMLInputElement;
  const defaultTime = store.get<string>('defaultReminderTime', '09:00');
  let priority: Priority = v.priority, status: Status = v.status;
  const choice = <T extends string>(name: string, options: [T, string][], get: () => T, set: (x: T) => void) => { const box = h('div', { class: 'choice', role: 'group', 'aria-label': name }); const draw = () => box.replaceChildren(...options.map(([val, label]) => h('button', { type: 'button', class: 'btn', 'aria-pressed': String(get() === val), onClick: () => { set(val); draw(); saveDraft(); } }, label))); draw(); return box; };
  const people = [...new Set(tasks.map((x) => x.person).filter(Boolean))];
  const errBox = h('div', { class: 'msg error', role: 'alert', hidden: true });
  const saveDraft = () => store.set(draftKey, { title: title.value, person: person.value, notes: notes.value, dueDate: dueDate.value, dueTime: dueTime.value, priority, status, reminderDate: remDate.value, reminderTime: remTime.value });
  for (const el of [title, person, notes, dueDate, dueTime, remDate, remTime]) el.addEventListener('input', saveDraft);
  const quick = (label: string, fn: () => void) => h('button', { type: 'button', class: 'btn', onClick: () => { fn(); saveDraft(); } }, label);
  const more = h('details', { open: !!(v.person || v.notes || v.dueDate || v.reminderDate || t) }, h('summary', null, 'More: person, notes, dates, reminder, priority'),
    field('Person', person, 'Optional. Who the task is for or about.'),
    h('datalist', { id: 'people-list' }, ...people.map((p) => h('option', { value: p }))),
    field('Notes', notes),
    h('div', { class: 'grid2' }, field('Due date', dueDate), field('Due time', dueTime, 'Optional, only with a date.')),
    h('div', { class: 'row' }, quick('Due today', () => { dueDate.value = todayStr(); }), quick('Tomorrow', () => { dueDate.value = addDays(todayStr(), 1); }), quick('Next week', () => { dueDate.value = addDays(todayStr(), 7); }), quick('No date', () => { dueDate.value = ''; dueTime.value = ''; })),
    h('div', { class: 'grid2' }, field('Reminder date', remDate, 'A notification at this date and time.'), field('Reminder time', remTime)),
    h('div', { class: 'row' }, quick('Remind at the due time', () => { if (!dueDate.value) { toast('Set a due date first.'); return; } remDate.value = dueDate.value; remTime.value = dueTime.value || defaultTime; }), quick(`Remind at ${fmtTime(defaultTime)} that day`, () => { remDate.value = dueDate.value || todayStr(); remTime.value = defaultTime; }), quick('No reminder', () => { remDate.value = ''; remTime.value = ''; })),
    field('Priority', choice<Priority>('Priority', [['low', 'Low'], ['normal', 'Normal'], ['high', 'High']], () => priority, (x) => { priority = x; })),
    t ? field('Status', choice<Status>('Status', [['todo', 'To do'], ['doing', 'In progress'], ['done', 'Completed']], () => status, (x) => { status = x; })) : null);
  const save = h('button', { class: 'btn primary huge', type: 'submit' }, t ? 'Save changes' : 'Add task') as HTMLButtonElement;
  const form = h('form', { class: 'form', onSubmit: async (e: Event) => {
    e.preventDefault(); errBox.hidden = true;
    if (!title.value.trim()) { errBox.textContent = 'Give the task a title.'; errBox.hidden = false; title.focus(); return; }
    if (dueTime.value && !dueDate.value) { errBox.textContent = 'A due time needs a due date.'; errBox.hidden = false; dueDate.focus(); return; }
    if ((remDate.value && !remTime.value) || (!remDate.value && remTime.value)) { errBox.textContent = 'A reminder needs both a date and a time.'; errBox.hidden = false; (remDate.value ? remTime : remDate).focus(); return; }
    const body = { title: title.value.trim(), person: person.value.trim(), notes: notes.value.trim(), dueDate: dueDate.value || null, dueTime: dueDate.value && dueTime.value ? dueTime.value : null, remindAt: remDate.value ? localToIso(remDate.value, remTime.value) : null, priority, status };
    if (body.remindAt && Date.parse(body.remindAt) < Date.now() - 60_000 && !confirm('That reminder time has already passed. It will go off straight away. Save anyway?')) return;
    save.disabled = true;
    try {
      if (t) { await write('PATCH', `/tasks/${t.id}`, body, (l) => l.map((x) => x.id === t.id ? { ...x, ...body, updatedAt: new Date().toISOString() } as Task : x)); }
      else { const tmp: Task = { id: 'tmp_' + Math.random().toString(36).slice(2), ...body, reminderSentAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: null }; await write('POST', '/tasks', body, (l) => [tmp, ...l]); }
      store.set(draftKey, null); toast(t ? 'Saved' : `Added: ${body.title}`);
      navigate(t ? `/task/${t.id}` : (body.dueDate && body.dueDate > todayStr() ? '/upcoming' : '/'));
    } catch { save.disabled = false; }
  } }, field('Task', title), more, errBox, save, t ? null : h('p', { class: 'muted small' }, 'Your typing is kept on this device until you add the task, so a refresh loses nothing.'));
  return form;
}
route(/^\/new$/, (_p, q) => h('div', null, h('p', null, link('/', null, '‹ Today')), h('h1', null, 'Add a task'), taskForm(null, q)));
route(/^\/task\/([^/]+)$/, async ([id], q) => {
  let t = tasks.find((x) => x.id === id) ?? null;
  if (!t) { try { t = await api<Task>('GET', `/tasks/${id}`); } catch { /* fall through */ } }
  if (!t) return h('div', null, h('h1', null, 'Not found'), h('p', null, 'That task is not here any more. ', link('/', null, 'Back to Today')));
  const task = t;
  const editing = q.get('edit') === '1';
  const done = task.status === 'done';
  const setStatus = async (s: Status) => { await write('PATCH', `/tasks/${task.id}`, { status: s }, (l) => l.map((x) => x.id === task.id ? { ...x, status: s, completedAt: s === 'done' ? new Date().toISOString() : null } : x)); toast(s === 'done' ? 'Done' : s === 'doing' ? 'In progress' : 'Reopened'); void render(); };
  return h('div', { class: 'detail' },
    h('p', null, link(done ? '/done' : '/', null, done ? '‹ Completed' : '‹ Today')),
    h('h1', null, task.title),
    h('div', { class: 'task-meta big' }, isOverdue(task) ? h('span', { class: 'tag inv' }, 'Overdue') : null, done ? h('span', { class: 'tag inv' }, 'Completed') : task.status === 'doing' ? h('span', { class: 'tag' }, 'In progress') : null, priorityTag(task.priority)),
    editing ? taskForm(task, q) : h('div', null,
      h('dl', null,
        task.person ? [h('dt', null, 'Person'), h('dd', null, link(`/person/${encodeURIComponent(task.person)}`, null, task.person))] : null,
        task.dueDate ? [h('dt', null, 'Due'), h('dd', null, fmtDate(task.dueDate) + (task.dueTime ? ' at ' + fmtTime(task.dueTime) : ''))] : null,
        task.remindAt ? [h('dt', null, 'Reminder'), h('dd', null, fmtInstant(task.remindAt), task.reminderSentAt ? ' (sent)' : '')] : null,
        task.notes ? [h('dt', null, 'Notes'), h('dd', null, task.notes)] : null,
        h('dt', null, 'Added'), h('dd', null, fmtInstant(task.createdAt)),
        task.completedAt ? [h('dt', null, 'Completed'), h('dd', null, fmtInstant(task.completedAt))] : null),
      h('div', { class: 'row' },
        done ? h('button', { class: 'btn', onClick: () => void setStatus('todo') }, 'Reopen') : h('button', { class: 'btn primary', onClick: () => void setStatus('done') }, '✓ Complete'),
        !done && task.status !== 'doing' ? h('button', { class: 'btn', onClick: () => void setStatus('doing') }, 'In progress') : null,
        link(`/task/${task.id}?edit=1`, { class: 'btn' }, 'Edit')),
      h('div', { class: 'row' }, h('button', { class: 'btn danger wide', onClick: async () => { if (!confirm(`Delete "${task.title}"? This cannot be undone.`)) return; await write('DELETE', `/tasks/${task.id}`, undefined, (l) => l.filter((x) => x.id !== task.id)); toast('Deleted'); navigate('/'); } }, 'Delete this task'))));
});

route(/^\/reminders$/, async () => {
  let data: { upcoming: Task[]; recent: { taskId: string; remindAt: string; sentAt: string; result: string }[] } = { upcoming: [], recent: [] };
  try { data = await api('GET', '/reminders'); } catch { /* offline: show what the cache knows */ data.upcoming = tasks.filter((t) => t.remindAt && !t.reminderSentAt && t.status !== 'done'); }
  const support = pushSupport();
  const box = h('div');
  const drawPush = async () => {
    box.replaceChildren(h('p', { class: 'muted' }, 'Checking…'));
    const reg = support.ok ? await navigator.serviceWorker.getRegistration() : null;
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    const perm = support.ok ? Notification.permission : 'denied';
    fill(box,
      !support.ok ? h('div', { class: 'card warn' }, support.why) : null,
      support.ok && perm === 'denied' ? h('div', { class: 'card warn' }, 'Notifications are blocked for this site in your browser settings. Allow them there, then come back and press the button.') : null,
      sub ? h('div', { class: 'msg ok' }, 'This device gets notifications.') : null,
      h('div', { class: 'row' },
        support.ok && !sub ? h('button', { class: 'btn primary', onClick: async () => { try { await subscribePush(); toast('Notifications are on for this device'); await drawPush(); } catch (e) { toast(e instanceof Error ? e.message : String(e)); } } }, 'Turn on notifications here') : null,
        sub ? h('button', { class: 'btn', onClick: async () => { try { const r = await api<{ sent: number; failed: number }>('POST', '/push/test'); toast(r.sent ? 'Test sent. It should appear in a moment.' : 'Nothing was sent; see Settings.'); } catch (e) { toast(e instanceof Error ? e.message : String(e)); } } }, 'Send a test') : null,
        sub ? h('button', { class: 'btn', onClick: async () => { await api('DELETE', '/push/subscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); toast('Notifications are off for this device'); await drawPush(); } }, 'Turn off here') : null),
      h('details', null, h('summary', null, 'On an iPhone or iPad'), h('p', null, 'Open this site in Safari, tap Share, then "Add to Home Screen". Open the To-do icon from the Home Screen (not from Safari), come back to this page and press "Turn on notifications here". iOS 16.4 or later is needed, and notifications only reach the Home Screen copy.')),
      h('details', null, h('summary', null, 'Not getting notifications?'), h('ul', null, h('li', null, 'Check the device shows above as on. Each device is turned on separately.'), h('li', null, 'On iPhone, open the Home Screen icon at least once after turning notifications on, and check Settings → Notifications → To-do.'), h('li', null, 'Focus modes and Do Not Disturb hold notifications back.'), h('li', null, 'Reminders are sent from the server at the time you set, even with the app closed. The "Recent" list below shows what was sent.'), h('li', null, 'Reminders use this device\'s time zone when you set them, and go off at that moment wherever you are.'))));
  };
  void drawPush();
  return h('div', null, h('h1', null, 'Reminders'), box,
    section('Coming up', data.upcoming, 'No reminders scheduled. Set one when you add or edit a task.'),
    data.recent.length ? h('section', null, h('h2', null, 'Recently sent'), h('ul', { class: 'tasks' }, ...data.recent.map((r) => { const t = tasks.find((x) => x.id === r.taskId); return h('li', { class: 'task' }, h('div', { class: 'task-body' }, t ? link(`/task/${t.id}`, { class: 'task-title' }, t.title) : h('span', { class: 'task-title muted' }, 'A task since deleted'), h('div', { class: 'task-meta' }, h('span', null, 'Sent ', fmtInstant(r.sentAt)), h('span', { class: 'muted' }, r.result)))); }))) : null);
});

function pushSupport(): { ok: boolean; why: string } {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    return { ok: false, why: ios ? 'On iPhone and iPad, notifications only work once the app is added to the Home Screen and opened from there (iOS 16.4 or later). See the steps below.' : 'This browser does not support web push notifications. Chrome, Edge, Firefox and Safari 16 or later do.' };
  }
  if (!window.isSecureContext) return { ok: false, why: 'Notifications need the site opened over https.' };
  return { ok: true, why: '' };
}
async function subscribePush(): Promise<void> {
  if (!status?.vapidPublicKey) await refreshStatus();
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notification permission was not given.');
  const reg = await navigator.serviceWorker.ready;
  const key = Uint8Array.from(atob(status!.vapidPublicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const j = sub.toJSON();
  await api('POST', '/push/subscribe', { endpoint: j.endpoint, keys: j.keys, label: deviceLabel() });
}
const deviceLabel = () => { const ua = navigator.userAgent; const standalone = (navigator as unknown as { standalone?: boolean }).standalone || matchMedia('(display-mode: standalone)').matches; return (/iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Device') + (standalone ? ' (Home Screen app)' : ' (browser)'); };

route(/^\/settings$/, async () => {
  type Settings = { lockTimeoutMin: number; lockChoices: number[]; defaultReminderTime: string; notificationsEnabled: boolean; timezone: string; pinChangedAt: string | null; recoveryConfigured: boolean; devices: { endpoint: string; label: string; createdAt: string; lastOkAt: string | null; failures: number }[]; counts: { open: number; done: number } };
  const s = await api<Settings>('GET', '/settings');
  store.set('defaultReminderTime', s.defaultReminderTime);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz && s.timezone !== tz) { try { await api('PATCH', '/settings', { timezone: tz }); } catch { /* fine */ } }
  const lockSel = h('select', { 'aria-label': 'Lock after' }, ...s.lockChoices.map((m) => h('option', { value: String(m), selected: m === s.lockTimeoutMin }, m >= 43200 ? 'Only when I log out (30 days at most)' : m >= 60 ? `${m / 60} hour${m >= 120 ? 's' : ''} of not using it` : `${m} minute${m === 1 ? '' : 's'} of not using it`))) as HTMLSelectElement;
  lockSel.addEventListener('change', async () => { try { await api('PATCH', '/settings', { lockTimeoutMin: Number(lockSel.value) }); await refreshStatus(); toast('Lock timeout saved'); } catch (e) { toast(e instanceof Error ? e.message : String(e)); } });
  const remTime = h('input', { type: 'time', value: s.defaultReminderTime }) as HTMLInputElement;
  remTime.addEventListener('change', async () => { try { await api('PATCH', '/settings', { defaultReminderTime: remTime.value }); store.set('defaultReminderTime', remTime.value); toast('Default reminder time saved'); } catch (e) { toast(e instanceof Error ? e.message : String(e)); } });
  const notif = h('button', { class: 'btn', 'aria-pressed': String(s.notificationsEnabled), onClick: async () => { const on = notif.getAttribute('aria-pressed') !== 'true'; await api('PATCH', '/settings', { notificationsEnabled: on }); notif.setAttribute('aria-pressed', String(on)); notif.textContent = on ? 'Reminders are ON' : 'Reminders are OFF'; toast(on ? 'Reminders will be sent' : 'No reminders will be sent'); } }, s.notificationsEnabled ? 'Reminders are ON' : 'Reminders are OFF');
  const cur = h('input', { type: 'password', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'current-password' }) as HTMLInputElement;
  const n1 = h('input', { type: 'password', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'new-password' }) as HTMLInputElement;
  const n2 = h('input', { type: 'password', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'new-password' }) as HTMLInputElement;
  const pinMsg = h('div', { class: 'msg', role: 'alert', hidden: true });
  return h('div', null, h('h1', null, 'Settings'),
    h('h2', null, 'Lock'),
    field('Lock the list after', lockSel, 'You enter your PIN again after this long without using the list, on every device.'),
    h('details', null, h('summary', null, 'Change my PIN'),
      h('form', { class: 'form', onSubmit: async (e: Event) => { e.preventDefault(); if (n1.value !== n2.value) { pinMsg.textContent = 'The new PINs do not match.'; pinMsg.className = 'msg error'; pinMsg.hidden = false; return; } try { await api('POST', '/pin', { current: cur.value, next: n1.value }); pinMsg.textContent = 'PIN changed. Other devices will ask for the new one.'; pinMsg.className = 'msg ok'; pinMsg.hidden = false; cur.value = n1.value = n2.value = ''; } catch (err) { pinMsg.textContent = err instanceof Error ? err.message : String(err); pinMsg.className = 'msg error'; pinMsg.hidden = false; } } },
        field('Current PIN', cur), field('New PIN', n1, '4 to 12 digits.'), field('New PIN again', n2), pinMsg, h('button', { class: 'btn primary', type: 'submit' }, 'Change PIN'))),
    h('div', { class: 'row' }, h('button', { class: 'btn', onClick: async () => { await api('POST', '/logout'); tasks = []; store.set('cache', []); await refreshStatus(); showLock(); } }, 'Log out'), h('button', { class: 'btn', onClick: async () => { await api('DELETE', '/sessions/others'); toast('Every other device will ask for the PIN'); } }, 'Log out other devices')),
    h('p', { class: 'muted small' }, 'Logging out never deletes tasks. They are kept on the server.'),
    h('h2', null, 'Text size'),
    h('p', { class: 'muted' }, 'For this device only. Phones start larger than wide screens; pick what reads best here.'),
    (() => { const box = h('div', { class: 'choice', role: 'group', 'aria-label': 'Text size' }); const cur = () => store.get<string>('size', 'normal'); const draw = () => box.replaceChildren(...[['small', 'Small'], ['normal', 'Normal'], ['large', 'Large'], ['huge', 'Huge']].map(([v, l]) => h('button', { type: 'button', class: 'btn', 'aria-pressed': String(cur() === v), onClick: () => { store.set('size', v); applySize(); draw(); } }, l))); draw(); return box; })(),
    h('h2', null, 'Reminders'),
    h('div', { class: 'row' }, notif),
    field('Default reminder time', remTime, 'Used by the "remind me that day" button when adding a task.'),
    h('p', null, 'Devices that get notifications:'),
    s.devices.length ? h('ul', null, ...s.devices.map((d) => h('li', null, `${d.label} · added ${fmtInstant(d.createdAt)}${d.failures ? ` · ${d.failures} recent failures` : ''}`))) : h('p', { class: 'empty' }, 'None yet. Turn them on from the Reminders page on each device.'),
    h('p', null, link('/reminders', { class: 'btn' }, 'Reminders page')),
    h('h2', null, 'Your data'),
    h('p', null, `${s.counts.open} open and ${s.counts.done} completed tasks, stored on the server and cached on this device.`),
    h('div', { class: 'row' }, h('a', { class: 'btn', href: '/api/export.json', download: '' }, 'Download JSON'), h('a', { class: 'btn', href: '/api/export.csv', download: '' }, 'Download CSV')),
    h('p', { class: 'muted small' }, 'Keep a download somewhere safe now and then. A JSON file can be put back with the Restore button.'),
    h('div', { class: 'row' }, h('label', { class: 'btn', for: 'restore' }, 'Restore from JSON'), h('input', { id: 'restore', type: 'file', accept: 'application/json', class: 'sr', onChange: async (e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return; try { const r = await api<{ added: number; skipped: number }>('POST', '/import', JSON.parse(await f.text())); toast(`Restored ${r.added}, ${r.skipped} already here`); await loadTasks(); } catch (err) { toast(err instanceof Error ? err.message : 'That file is not a to-do export'); } } })),
    h('h2', null, 'If you forget your PIN'),
    h('p', null, 'On the lock screen, tap "Forgot your PIN?" and enter the recovery key. ', s.recoveryConfigured ? 'The recovery key is the TODO_RECOVERY_KEY secret you set on the server; it is not stored anywhere else, so keep it in a password manager.' : 'No recovery key is set on the server right now: set the TODO_RECOVERY_KEY secret and redeploy, or you will not be able to reset a lost PIN.'),
    h('p', { class: 'muted small' }, `Time zone: ${tz}. ${s.pinChangedAt ? 'PIN last changed ' + fmtInstant(s.pinChangedAt) + '.' : ''}`));
});

function applySize(): void { const v = store.get<string>('size', 'normal'); if (v === 'normal') delete document.documentElement.dataset.size; else document.documentElement.dataset.size = v; }

// ── render loop, idle lock, sync ──
async function render(): Promise<void> {
  const main = $('main');
  if (!status?.authenticated) { showLock(); return; }
  hideLock();
  const url = new URL(location.href);
  const r = routes.find((x) => x.re.test(url.pathname));
  const params = r ? (url.pathname.match(r.re) ?? []).slice(1) : [];
  main.setAttribute('aria-busy', 'true');
  try { main.replaceChildren(await (r ? r.page(params, url.searchParams) : h('div', null, h('h1', null, 'Not found'), h('p', null, link('/', null, 'Back to Today'))))); }
  catch (e) { if (!(e instanceof ApiError && e.status === 401)) main.replaceChildren(h('div', { class: 'msg error' }, (e as Error).message)); }
  main.removeAttribute('aria-busy');
  drawNav();
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
}
function touch(): void { lastActivity = Date.now(); }
for (const ev of ['click', 'keydown', 'touchstart', 'pointerdown']) document.addEventListener(ev, touch, { passive: true });
function checkIdle(): void { const st = status; if (!st || !st.authenticated) return; if (Date.now() - lastActivity > st.lockTimeoutMin * 60_000) { st.authenticated = false; showLock(); } }
setInterval(checkIdle, 15_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkIdle(); void sync(); } });
async function sync(): Promise<void> { if (!status?.authenticated || $('lock').hidden === false) return; await flushOutbox(); const before = JSON.stringify(tasks); await loadTasks(); if (JSON.stringify(tasks) !== before) void render(); }
setInterval(() => { if (!document.hidden) void sync(); }, 45_000);

(async () => {
  applySize();
  document.body.appendChild(h('div', { id: 'offline', class: 'offline', hidden: online() }, 'Offline. Changes are kept on this device and sent when you are back.'));
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { /* no offline shell then */ });
  await refreshStatus();
  if (currentStatus()?.authenticated) { await flushOutbox(); await loadTasks(); }
  await render();
  (window as unknown as { __todo: unknown }).__todo = { api, navigate, tasks: () => tasks, status: () => status, store };
})();
