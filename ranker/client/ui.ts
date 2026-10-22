// Tiny UI toolkit: elements, routing, the API client, toasts, a few shared
// components. No framework; everything is a function returning DOM.

export type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown>;

export function h(tag: string, attrs: Attrs | null = null, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'dataset') Object.assign(el.dataset, v as Record<string, string>);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'value' && 'value' in el) (el as HTMLInputElement).value = String(v);
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') { if (v) el.setAttribute(k, ''); }
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}
function append(el: HTMLElement, children: Child[]): void {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}
export const frag = (...children: Child[]): DocumentFragment => { const f = document.createDocumentFragment(); const d = h('div', null, ...children); while (d.firstChild) f.appendChild(d.firstChild); return f; };

// ── routing ──
export type Route = { pattern: RegExp; page: (params: string[], query: URLSearchParams) => Promise<Node> | Node };
const routes: Route[] = [];
export function route(pattern: RegExp, page: Route['page']): void { routes.push({ pattern, page }); }
export function navigate(path: string, replace = false): void { if (replace) history.replaceState(null, '', path); else history.pushState(null, '', path); void render(); }
export function link(href: string, attrs: Attrs | null, ...children: Child[]): HTMLElement { return h('a', { href, ...attrs, onClick: (e: MouseEvent) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); navigate(href); } }, ...children); }
let notFound: Route['page'] = () => h('p', null, 'Not found.');
export function setNotFound(p: Route['page']): void { notFound = p; }
export async function render(): Promise<void> {
  const main = document.getElementById('main')!;
  const url = new URL(location.href);
  const r = routes.find((x) => x.pattern.test(url.pathname));
  const params = r ? (url.pathname.match(r.pattern) ?? []).slice(1) : [];
  main.setAttribute('aria-busy', 'true');
  try {
    const node = await (r ? r.page : notFound)(params, url.searchParams);
    main.replaceChildren(node);
  } catch (e) {
    main.replaceChildren(h('div', { class: 'card error' }, h('h2', null, 'Could not load this page'), h('p', null, (e as Error).message)));
  }
  main.removeAttribute('aria-busy');
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', (a as HTMLAnchorElement).pathname === url.pathname || (url.pathname.startsWith((a as HTMLAnchorElement).pathname + '/') && (a as HTMLAnchorElement).pathname !== '/')));
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
}
window.addEventListener('popstate', () => void render());
document.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest('a[data-link]') as HTMLAnchorElement | null;
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault(); navigate(a.getAttribute('href')!);
});

// ── api ──
export class ApiError extends Error { status: number; body: Record<string, unknown>; constructor(status: number, body: Record<string, unknown>) { super(String(body.error ?? 'request failed')); this.status = status; this.body = body; } }
export const editKey = { get: (): string => { try { return localStorage.getItem('ranker.editKey') ?? ''; } catch { return ''; } }, set: (k: string): void => { try { k ? localStorage.setItem('ranker.editKey', k) : localStorage.removeItem('ranker.editKey'); } catch { /* blocked */ } } };
export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const key = editKey.get(); if (key) headers['x-edit-key'] = key;
  const res = await fetch('/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : {};
  if (!res.ok) {
    if (res.status === 401) toast('This installation is locked. Enter the edit key in Settings.', 'bad');
    throw new ApiError(res.status, data);
  }
  return data as T;
}

// ── toasts ──
export function toast(text: string, kind: 'ok' | 'bad' | 'info' = 'info'): void {
  const box = document.getElementById('toasts')!;
  const t = h('div', { class: `toast ${kind}`, role: 'status' }, text);
  box.appendChild(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3800);
}

// ── components ──
export const pill = (text: string, cls = ''): HTMLElement => h('span', { class: `pill ${cls}` }, text);
export const typeLabel = (id: string): string => id.replace(/_/g, ' ');
export function field(label: string, control: HTMLElement, help?: string): HTMLElement {
  const id = control.id || (control.id = 'f_' + Math.random().toString(36).slice(2, 8));
  return h('div', { class: 'field' }, h('label', { for: id }, label), control, help ? h('small', { class: 'help' }, help) : null);
}
export function select(options: { value: string; label: string; group?: string }[], value: string, attrs: Attrs = {}): HTMLSelectElement {
  const s = h('select', attrs) as HTMLSelectElement;
  const groups = new Map<string, HTMLElement>();
  for (const o of options) {
    const opt = h('option', { value: o.value, selected: o.value === value }, o.label);
    if (o.group) { if (!groups.has(o.group)) { const g = h('optgroup', { label: o.group }); groups.set(o.group, g); s.appendChild(g); } groups.get(o.group)!.appendChild(opt); }
    else s.appendChild(opt);
  }
  return s;
}
export function confirmBox(text: string): boolean { return window.confirm(text); }

// A search box that finds entities as you type and hands back the chosen one.
export function entityPicker(onPick: (e: { id: string; type: string; name: string; year: number | null }) => void, opts: { placeholder?: string; type?: string; exclude?: string[] } = {}): HTMLElement {
  const input = h('input', { type: 'search', placeholder: opts.placeholder ?? 'Search the library…', autocomplete: 'off', class: 'picker-input', 'aria-label': opts.placeholder ?? 'Search the library' }) as HTMLInputElement;
  const list = h('ul', { class: 'picker-list', role: 'listbox', hidden: true });
  const wrap = h('div', { class: 'picker' }, input, list);
  let timer = 0, seq = 0;
  const search = async () => {
    const q = input.value.trim();
    if (!q) { list.hidden = true; list.replaceChildren(); return; }
    const my = ++seq;
    const r = await api<{ items: { id: string; type: string; name: string; year: number | null }[] }>('GET', `/entities?q=${encodeURIComponent(q)}${opts.type ? '&type=' + opts.type : ''}&limit=8`);
    if (my !== seq) return;
    const items = r.items.filter((i) => !(opts.exclude ?? []).includes(i.id));
    list.replaceChildren(...(items.length ? items.map((i) => h('li', { role: 'option' }, h('button', { type: 'button', class: 'picker-item', onClick: () => { onPick(i); input.value = ''; list.hidden = true; list.replaceChildren(); } }, h('b', null, i.name), ' ', pill(typeLabel(i.type)), i.year ? h('span', { class: 'muted' }, ` ${i.year}`) : null))) : [h('li', { class: 'muted picker-empty' }, 'Nothing by that name in the library yet.')]));
    list.hidden = false;
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = window.setTimeout(() => void search(), 180); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { list.hidden = true; } });
  return wrap;
}

export const fmtDate = (iso: string): string => { try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return iso; } };
export const bar = (label: string, v: number): HTMLElement => h('div', { class: 'bar', role: 'img', 'aria-label': `${label} ${Math.round(v * 100)} percent` }, h('span', { class: 'bar-l' }, label), h('span', { class: 'bar-t' }, h('i', { style: `width:${Math.round(v * 100)}%` })), h('span', { class: 'bar-v' }, `${Math.round(v * 100)}%`));
