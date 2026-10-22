// Lists from a topic: the "New list" page (type a topic, let the AI gather
// the items, review them, save) and the list table every templated
// collection is drawn with. The layout comes from the server's list
// templates (server/domain/list-templates.ts), the "stylesheet" for lists.

import { api, ApiError, field, h, link, navigate, pill, select, toast, typeLabel } from './ui.ts';
import type { ListColumn, ListTemplate } from '../server/domain/list-templates.ts';
import type { Draft, DraftItem } from '../server/services/lists.ts';
import type { Collection, CollectionItem } from '../server/domain/types.ts';

export type TemplatesResponse = { templates: ListTemplate[]; generic: ListColumn[]; ai: { configured: boolean; provider: string | null; model: string | null } };
let cache: TemplatesResponse | null = null;
export async function templates(): Promise<TemplatesResponse> { return cache ?? (cache = await api<TemplatesResponse>('GET', '/lists/templates')); }
export const columnsFor = (t: TemplatesResponse, templateId: string): ListColumn[] => t.templates.find((x) => x.id === templateId)?.columns ?? t.generic;

// One row of a list, however it got here.
export interface ListRow { name: string; year: number | null; type: string; attributes: Record<string, unknown>; why: string; description: string; href?: string }
export const rowFromItem = (it: CollectionItem): ListRow => ({ name: it.entity.name, year: it.entity.year, type: it.entity.type, attributes: it.entity.attributes, why: it.note, description: '', href: `/entity/${it.entity.id}` });

export const AI_PILL = (): HTMLElement => pill('AI-gathered · unverified', 'warn');
export const isAi = (origin: string): boolean => origin.startsWith('provider:');

// Draw one cell per the column's style.
export function cell(col: ListColumn, row: ListRow, groupOf: (type: string) => string): Node | null {
  const v = col.key === 'name' ? row.name : col.key === 'year' ? row.year : col.key === 'why' ? row.why : col.key === 'description' ? row.description : row.attributes[col.key];
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return col.key === 'name' ? h('span', null, row.name) : h('span', { class: 'faint' }, '–');
  switch (col.style) {
    case 'year': return h('span', { class: 'num' }, String(v));
    case 'number': return h('span', { class: 'num' }, String(v));
    case 'bar': { const n = Math.max(0, Math.min(100, Number(v))); return h('span', { class: 'pop', role: 'img', 'aria-label': `${col.label} ${n} of 100, an estimate`, title: 'An estimate, not a measurement' }, h('i', { style: `width:${n}%` }), h('b', null, String(n))); }
    case 'pills': return h('span', { class: 'pills' }, ...(Array.isArray(v) ? v : [v]).slice(0, 6).map((x) => pill(String(x))));
    case 'long': return h('span', { class: 'long' }, String(v));
    default:
      if (col.key === 'name') return row.href ? link(row.href, { class: `ent g-${groupOf(row.type)}` }, h('span', { class: 'ent-name' }, row.name)) : h('b', null, row.name);
      return h('span', null, Array.isArray(v) ? v.join(', ') : String(v));
  }
}

// The table. `extra(row, i)` adds controls per row; detail columns (table:
// false) fold under the row.
export function listTable(columns: ListColumn[], rows: ListRow[], groupOf: (type: string) => string, opts: { extra?: (row: ListRow, i: number) => Node | null; lead?: (row: ListRow, i: number) => Node | null; cls?: string } = {}): HTMLElement {
  const main = columns.filter((c) => c.table !== false), detail = columns.filter((c) => c.table === false);
  return h('div', { class: `ltable-wrap ${opts.cls ?? ''}` }, h('table', { class: 'ltable' },
    h('thead', null, h('tr', null, h('th', { class: 'pos' }, '#'), ...(opts.lead ? [h('th', null)] : []), ...main.map((c) => h('th', { class: `st-${c.style}` }, c.label)), ...(opts.extra ? [h('th', null)] : []))),
    h('tbody', null, ...rows.flatMap((r, i) => {
      const details = detail.map((c) => { const v = c.key === 'why' ? r.why : c.key === 'description' ? r.description : r.attributes[c.key]; return v == null || v === '' || (Array.isArray(v) && !v.length) ? null : h('div', { class: 'ldetail' }, h('b', null, c.label, ': '), Array.isArray(v) ? v.join(', ') : String(v)); }).filter(Boolean);
      const span = main.length + 1 + (opts.lead ? 1 : 0) + (opts.extra ? 1 : 0);
      return [
        h('tr', { class: 'lrow' }, h('td', { class: 'pos' }, String(i + 1)), ...(opts.lead ? [h('td', { class: 'lead-cell' }, opts.lead(r, i))] : []), ...main.map((c) => h('td', { class: `st-${c.style} k-${c.key}` }, cell(c, r, groupOf))), ...(opts.extra ? [h('td', { class: 'ctl' }, opts.extra(r, i))] : [])),
        details.length ? h('tr', { class: 'lrow-detail' }, h('td', { colspan: String(span) }, ...details)) : null,
      ];
    }))));
}

// A collection's provenance line, when it came from a topic or the AI.
export function provenance(c: Collection): HTMLElement | null {
  if (!c.topic && !c.generatedBy) return null;
  const ai = c.generatedBy.startsWith('ai:');
  return h('p', { class: 'prov' }, c.topic ? ['Built from the topic ', h('b', null, c.topic), '. '] : null, ai ? ['Items gathered by AI (', c.generatedBy.slice(3), ') and reviewed before saving; facts are unverified until a source is added. '] : null, c.template ? pill(c.template) : null);
}

// ── the page ──
export function registerListPages(deps: { groupOf: (type: string) => string; onErr: (e: unknown) => void; route: (p: RegExp, page: (params: string[], q: URLSearchParams) => Promise<Node> | Node) => void }): void {
  deps.route(/^\/lists\/new$/, async (_p, q) => {
    const T = await templates();
    const topic = h('input', { type: 'text', placeholder: T.templates[0]?.example ?? 'Beatles albums', value: q.get('topic') ?? '', maxlength: 200, required: true, autofocus: true }) as HTMLInputElement;
    const tsel = select([{ value: '', label: 'Let the AI choose from the topic' }, ...T.templates.map((t) => ({ value: t.id, label: `${t.label} (${t.example})` }))], q.get('template') ?? '', { 'aria-label': 'List template' });
    tsel.addEventListener('change', () => { const t = T.templates.find((x) => x.id === tsel.value); if (t) topic.placeholder = t.example; });
    const count = h('input', { type: 'number', min: 1, max: 60, value: '20', style: 'width:6em' }) as HTMLInputElement;
    const guidance = h('textarea', { rows: 2, placeholder: 'Optional: UK releases only · in order of release · include EPs…', maxlength: 1000 }) as HTMLTextAreaElement;
    const go = h('button', { class: 'btn primary', type: 'submit', disabled: !T.ai.configured }, 'Gather with AI') as HTMLButtonElement;
    const out = h('div', { class: 'draft-out', 'aria-live': 'polite' });
    const stylesheet = h('details', { class: 'card' }, h('summary', null, 'The list templates (what each kind of list gathers and shows)'),
      h('ul', { class: 'list small tpl-list' }, ...T.templates.map((t) => h('li', null, h('b', null, t.label), ' ', pill(typeLabel(t.type)), h('span', { class: 'muted' }, ` e.g. "${t.example}" · columns: ${t.columns.map((c) => c.label).join(', ')}`), h('br'), h('span', { class: 'muted small' }, `Gathers ${t.gather}.`)))),
      h('p', { class: 'muted small' }, 'Templates live in ranker/server/domain/list-templates.ts. Add one there to teach the app a new kind of list; the gathering prompt, this review table and the saved list page all follow it.'));
    const form = h('form', { class: 'form', onSubmit: async (ev: Event) => {
      ev.preventDefault();
      if (!topic.value.trim()) { topic.focus(); return; }
      go.disabled = true; const label = go.textContent; go.textContent = 'Gathering…';
      out.replaceChildren(h('div', { class: 'card working' }, h('p', null, h('b', null, `Gathering "${topic.value.trim()}"…`)), h('p', { class: 'muted' }, 'The AI is listing the items and their context (year, who made it, popularity, genres). This usually takes under a minute; nothing is saved until you review it.')));
      try {
        const d = await api<Draft>('POST', '/lists/draft', { topic: topic.value.trim(), template: tsel.value || undefined, count: Number(count.value) || 20, guidance: guidance.value.trim() });
        out.replaceChildren(review(d, T, deps));
        out.querySelector<HTMLElement>('h2')?.scrollIntoView({ block: 'start' });
      } catch (e) {
        const msg = e instanceof ApiError && e.status === 503 ? `${e.message} ` : e instanceof Error ? e.message : String(e);
        out.replaceChildren(h('div', { class: 'card error-card' }, h('h3', null, 'Could not gather the list'), h('p', null, msg), e instanceof ApiError && e.status === 503 ? h('p', { class: 'muted small' }, 'You can still make a list by hand from the Lists page.') : null));
      } finally { go.disabled = !T.ai.configured; go.textContent = label; }
    } },
      field('Topic', topic, 'What the list is of: a band\'s albums, a director\'s films, a prize\'s winners, a scene, a decade…'),
      h('div', { class: 'row' }, field('Kind of list', tsel), field('Up to', count, 'items (max 60)')),
      field('Anything to add?', guidance),
      h('div', { class: 'row' }, go, link('/collections', { class: 'btn' }, 'Cancel')));
    return h('div', null,
      h('div', { class: 'crumb' }, link('/collections', null, 'Lists')),
      h('h1', null, 'New list from a topic'),
      h('p', { class: 'lead' }, 'Type a topic such as "Beatles albums". The AI gathers the items with their context: year released, who made it, how well known it is, genres, and the details the kind of list calls for. You review every row, fix or drop what is wrong, and only then is it saved as a list in the library.'),
      T.ai.configured ? h('p', { class: 'muted small' }, `AI provider: ${T.ai.provider} / ${T.ai.model}. Everything it returns is marked AI-gathered and unverified until you add a source.`)
        : h('div', { class: 'card warn' }, h('h3', null, 'AI gathering is not set up on this installation'), h('p', null, 'Set the ANTHROPIC_API_KEY secret on the Worker (in ranker/: npx wrangler secret put ANTHROPIC_API_KEY) and redeploy. See ranker/docs/PROVIDERS.md. Lists can still be made by hand from the Lists page.')),
      form, out, stylesheet);
  });
}

// The review step: a table in the template's layout, each row editable,
// with the default decision (new / link existing / skip) to change.
function review(d: Draft, T: TemplatesResponse, deps: { groupOf: (type: string) => string; onErr: (e: unknown) => void }): HTMLElement {
  const cols = columnsFor(T, d.template);
  const items: (DraftItem & { force?: boolean })[] = d.items.map((i) => ({ ...i }));
  const title = h('input', { type: 'text', value: d.title, maxlength: 200, required: true }) as HTMLInputElement;
  const desc = h('textarea', { rows: 2 }, d.description) as HTMLTextAreaElement;
  const vis = select([{ value: 'private', label: 'private' }, { value: 'unlisted', label: 'unlisted' }, { value: 'public', label: 'public' }], 'private', { 'aria-label': 'Visibility' });
  const counts = h('p', { class: 'muted small counts' });
  const refreshCounts = () => { const n = items.filter((i) => i.action === 'new').length, l = items.filter((i) => i.action === 'existing').length, s = items.filter((i) => i.action === 'skip').length; counts.textContent = `${n} new ${n === 1 ? 'entry' : 'entries'} will be added to the library, ${l} linked to things already there, ${s} skipped.`; };
  const rows = (): ListRow[] => items.map((i) => ({ name: i.name, year: i.year, type: i.type, attributes: i.attributes, why: i.why, description: i.description }));
  const tableBox = h('div');
  const draw = () => {
    tableBox.replaceChildren(listTable(cols, rows(), deps.groupOf, {
      cls: 'review',
      lead: (_r, i) => { const it = items[i]; const sel = select([{ value: 'new', label: 'add as new' }, ...(it.match ? [{ value: 'existing', label: `link: ${it.match.entity.name}${it.match.entity.year ? ` (${it.match.entity.year})` : ''}` }] : []), { value: 'skip', label: 'skip' }], it.action, { 'aria-label': `Decision for ${it.name}`, class: 'decide' }); sel.addEventListener('change', () => { it.action = sel.value as DraftItem['action']; it.force = it.action === 'new' && it.match?.strength === 'exact'; refreshCounts(); tableBox.querySelectorAll('tr.lrow')[i]?.classList.toggle('skipped', it.action === 'skip'); }); return h('div', { class: 'decide-wrap' }, sel, it.match ? h('div', { class: `small ${it.match.strength === 'exact' ? 'warn-text' : 'muted'}` }, it.match.strength === 'exact' ? 'already in the library' : `maybe: ${it.match.reason}`) : null, it.uncertain ? h('div', { class: 'small warn-text' }, 'AI unsure: check this one') : null, it.dropped.length ? h('div', { class: 'small muted', title: it.dropped.join('\n') }, `${it.dropped.length} value${it.dropped.length === 1 ? '' : 's'} not kept`) : null); },
      extra: (_r, i) => h('button', { type: 'button', class: 'btn tiny', 'aria-label': `Edit ${items[i].name}`, onClick: () => { const it = items[i]; const n = window.prompt('Title', it.name); if (n == null) return; it.name = n.trim() || it.name; const y = window.prompt('Year (blank if unknown)', it.year == null ? '' : String(it.year)); if (y != null) it.year = y.trim() === '' ? null : Number(y) || it.year; const w = window.prompt('Why it is on the list', it.why); if (w != null) it.why = w.trim(); draw(); } }, 'edit'),
    }));
    tableBox.querySelectorAll('tr.lrow').forEach((tr, i) => tr.classList.toggle('skipped', items[i].action === 'skip'));
    refreshCounts();
  };
  draw();
  const save = h('button', { class: 'btn primary', type: 'submit' }, 'Save this list') as HTMLButtonElement;
  const form = h('form', { class: 'form', onSubmit: async (ev: Event) => {
    ev.preventDefault();
    if (!title.value.trim()) { title.focus(); return; }
    save.disabled = true;
    try {
      const r = await api<{ collection: Collection; created: number; linked: number; skipped: number }>('POST', '/lists/commit', {
        topic: d.topic, template: d.template, title: title.value.trim(), description: desc.value.trim(), visibility: vis.value, generatedBy: d.generatedBy,
        items: items.map((i) => ({ action: i.action, existingId: i.match?.entity.id, force: i.force === true, name: i.name, year: i.year, description: i.description, why: i.why, aliases: i.aliases, attributes: i.attributes })),
      });
      toast(`Saved: ${r.created} added, ${r.linked} linked, ${r.skipped} skipped`, 'ok');
      navigate(`/collections/${r.collection.id}`);
    } catch (e) { deps.onErr(e); save.disabled = false; }
  } }, h('div', { class: 'row' }, field('Title', title), field('Visibility', vis)), field('Description', desc), counts, h('div', { class: 'row' }, save, h('span', { class: 'muted small' }, 'Every new entry is marked AI-gathered and unverified; the "why" line becomes the item\'s note.')));
  return h('section', { class: 'section review-sec' },
    h('h2', null, 'Review the draft'),
    h('p', null, h('b', null, `${items.length} item${items.length === 1 ? '' : 's'}`), ` for "${d.topic}" as a ${T.templates.find((t) => t.id === d.template)?.label.toLowerCase() ?? d.template} list. `, AI_PILL(), ' Check names and years, change a decision, edit a row, or skip it. Nothing is saved until you press Save.'),
    d.caveats.length ? h('ul', { class: 'caveats' }, ...d.caveats.map((c) => h('li', null, c))) : null,
    d.rejected.length ? h('details', { class: 'small muted' }, h('summary', null, `${d.rejected.length} item${d.rejected.length === 1 ? ' was' : 's were'} left out while cleaning`), h('ul', { class: 'list small' }, ...d.rejected.map((x) => h('li', null, x)))) : null,
    tableBox, form);
}
