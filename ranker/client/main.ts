// The pages. Each is a function of route params that returns DOM.
import { api, ApiError, bar, confirmBox, editKey, entityPicker, field, fmtDate, h, link, navigate, pill, render, route, select, setNotFound, toast, typeLabel } from './ui.ts';
import type { Collection, CollectionItem, Entity, EntitySummary, Note, Recommendation, RelationshipView } from '../server/domain/types.ts';
import type { MediaType, RelationshipType } from '../server/domain/media-types.ts';
import { AI_PILL, columnsFor, isAi, listTable, provenance, registerListPages, rowFromItem, templates } from './lists.ts';

type EntityFull = Entity & { relationships: RelationshipView[]; notes: Note[]; collections: Collection[] };
type Status = { version: string; locked: boolean; entities: number; relationships: number; collections: number; types: Record<string, number>; sample: boolean; ai: { configured: boolean; provider: string | null; model: string | null } };
let TYPES: { mediaTypes: MediaType[]; relationshipTypes: RelationshipType[] } = { mediaTypes: [], relationshipTypes: [] };
const mt = (id: string) => TYPES.mediaTypes.find((t) => t.id === id);
const GROUPS: Record<string, string> = { music: 'Music', film: 'Film & TV', books: 'Books', games: 'Games', other: 'Other' };
const groupOf = (type: string) => mt(type)?.group ?? 'other';
const typeOptions = () => TYPES.mediaTypes.map((t) => ({ value: t.id, label: t.label, group: GROUPS[t.group] }));

// The MENU: everything lives behind one button, as in the sketch. LOGIN
// goes to Settings (the edit key) until accounts arrive in Phase 2.
const NAV = [['/', 'Home'], ['/library', 'Library'], ['/collections', 'Lists'], ['/lists/new', 'New list from a topic'], ['/discover', 'Discover'], ['/data', 'Data'], ['/roadmap', 'Roadmap'], ['/settings', 'Settings']];
const menu = document.getElementById('menu')!, menuBtn = document.getElementById('menu-btn') as HTMLButtonElement;
const menuOpen = (open: boolean) => { menu.hidden = !open; menuBtn.setAttribute('aria-expanded', String(open)); if (open) (menu.querySelector('a') as HTMLElement | null)?.focus(); };
menu.replaceChildren(...NAV.map(([href, label]) => link(href, { 'data-nav': '1', onClick: () => menuOpen(false) }, label, h('span', { 'aria-hidden': 'true' }, '→'))));
menuBtn.addEventListener('click', () => menuOpen(menu.hidden));
document.addEventListener('click', (e) => { if (!menu.hidden && !(e.target as HTMLElement).closest('#nav')) menuOpen(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { menuOpen(false); menuBtn.focus(); } });
window.addEventListener('popstate', () => menuOpen(false));

// The filter bar from the sketch: [CATEGORY ▾] [NEW] [POPULAR] [TAGS] (+) [SEARCH BOX…]
function filterBar(o: { categories: { value: string; label: string; group?: string }[]; category: string; categoryLabel: string; sort: string; q: string; tags?: { tag: string; count: number }[]; tag?: string; showTags?: boolean; plusHref: string; plusLabel: string; searchLabel: string; go: (patch: Record<string, string>) => void }): HTMLElement {
  const cat = select([{ value: '', label: o.categoryLabel }, ...o.categories], o.category, { 'aria-label': o.categoryLabel });
  cat.addEventListener('change', () => o.go({ category: cat.value }));
  const q = h('input', { type: 'search', value: o.q, placeholder: 'Search box…', 'aria-label': o.searchLabel }) as HTMLInputElement;
  const sortChip = (id: string, label: string) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(o.sort === id), onClick: () => o.go({ sort: o.sort === id ? '' : id }) }, label);
  const tagsOpen = o.showTags || !!o.tag;
  return h('div', null,
    h('div', { class: 'fbar' },
      cat, sortChip('new', 'New'), sortChip('popular', 'Popular'),
      o.tags ? h('button', { type: 'button', class: 'chip', 'aria-pressed': String(tagsOpen), onClick: () => o.go({ tags: tagsOpen ? '' : '1', tag: '' }) }, 'Tags') : null,
      link(o.plusHref, { class: 'btn round plus', 'aria-label': o.plusLabel, title: o.plusLabel }, '+'),
      h('form', { onSubmit: (e: Event) => { e.preventDefault(); o.go({ q: q.value.trim() }); } }, q, h('button', { class: 'btn', type: 'submit' }, 'Go'))),
    o.tags && tagsOpen ? h('div', { class: 'chips tagrow' }, o.tags.length ? o.tags.slice(0, 40).map((t) => h('button', { type: 'button', class: `chip ${o.tag === t.tag ? 'on' : ''}`, onClick: () => o.go({ tag: o.tag === t.tag ? '' : t.tag, tags: '1' }) }, `${t.tag} · ${t.count}`)) : h('span', { class: 'muted' }, 'No tags yet: genres arrive with lists built from a topic.')) : null);
}
const qs = (base: Record<string, string>, patch: Record<string, string>): string => { const u = new URLSearchParams(); for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) u.set(k, v); const str = u.toString(); return str ? '?' + str : ''; };

const entityLink = (e: EntitySummary, cls = '') => link(`/entity/${e.id}`, { class: `ent ${cls} g-${groupOf(e.type)}` }, h('span', { class: 'ent-name' }, e.name), ' ', pill(typeLabel(e.type)), e.year ? h('span', { class: 'muted' }, ` ${e.year}`) : null);
const section = (title: string, ...children: Parameters<typeof h>[2][]) => h('section', { class: 'section' }, h('h2', null, title), ...children);
const empty = (text: string) => h('p', { class: 'muted empty' }, text);
const onErr = (e: unknown) => { toast(e instanceof Error ? e.message : String(e), 'bad'); };

// ── Home ──
route(/^\/$/, async () => {
  const [st, recent, cols] = await Promise.all([api<Status>('GET', '/status'), api<EntitySummary[]>('GET', '/entities/recent?limit=8'), api<Collection[]>('GET', '/collections')]);
  const fresh = st.entities === 0;
  return h('div', null,
    h('div', { class: 'hero' },
      h('h1', null, 'A map of what you love, and what sits next to it.'),
      h('p', { class: 'lead' }, 'Ranker is the TASTE MACHINE: lists of albums, films, books, games and the people and scenes around them, the connections between them, and a discovery engine that explains every suggestion. Type a topic and the AI gathers the list; you rank it.'),
      h('div', { class: 'row' },
        link('/lists/new', { class: 'btn primary' }, '+ List from a topic'),
        link('/library/new', { class: 'btn' }, 'Add something'),
        link('/discover', { class: 'btn' }, 'Discover'),
        fresh ? h('button', { class: 'btn', onClick: async () => { try { await api('POST', '/sample'); toast('Sample data loaded', 'ok'); void render(); } catch (e) { onErr(e); } } }, 'Load sample data to try it') : null)),
    h('div', { class: 'stats' },
      stat(st.entities, 'in the library'), stat(st.relationships, 'connections'), stat(st.collections, 'lists'),
      h('div', { class: 'stat' }, h('b', null, st.locked ? 'Locked' : 'Open'), h('span', null, st.locked ? 'edit key needed to change things' : 'anyone with the link can edit'))),
    fresh ? h('div', { class: 'card' }, h('h2', null, 'Empty so far'), h('p', null, 'Add an album, a film, a person, anything, and connect it to something else. Or load the labelled sample data to see trails, adjacency and lists working, and remove it later from the Data page.')) : null,
    cols.length ? section('Lists', h('ol', { class: 'items' }, ...cols.slice(0, 8).map((c, i) => h('li', { class: 'item' }, h('span', { class: 'pos' }, `${i + 1}.`), h('div', { class: 'item-body' }, link(`/collections/${c.id}`, { class: 'ent' }, h('span', { class: 'ent-name' }, c.title)), h('span', { class: 'meta' }, `${c.itemCount} item${c.itemCount === 1 ? '' : 's'}${c.template ? ' · ' + c.template : ''}`))))), cols.length > 8 ? h('p', null, link('/collections', null, 'All lists →')) : null) : null,
    recent.length ? section('Recently added', h('div', { class: 'ent-grid' }, ...recent.map((e) => entityLink(e, 'tile')))) : null,
    !fresh ? section('One at random', await randomCard()) : null,
  );
});
const stat = (n: number, label: string) => h('div', { class: 'stat' }, h('b', null, String(n)), h('span', null, label));
async function randomCard(): Promise<HTMLElement> {
  const recs = await api<Recommendation[]>('GET', '/discover/random?limit=1');
  return recs.length ? recCard(recs[0], () => {}) : empty('Nothing yet.');
}

// ── Library ──
route(/^\/library$/, async (_p, q) => {
  const query = q.get('q') ?? '', type = q.get('type') ?? '', sort = q.get('sort') ?? '', tag = q.get('tag') ?? '', showTags = q.get('tags') === '1', page = Number(q.get('page') ?? '0');
  const LIMIT = 40;
  const base = { q: query, type, sort, tag, tags: showTags ? '1' : '' };
  const [r, st, tags] = await Promise.all([
    api<{ items: EntitySummary[]; total: number }>('GET', `/entities${qs(base, { tags: '', limit: String(LIMIT), offset: String(page * LIMIT) })}`),
    api<Status>('GET', '/status'),
    api<{ tag: string; count: number }[]>('GET', `/tags${type ? '?type=' + type : ''}`)]);
  const go = (patch: Record<string, string>) => navigate(`/library${qs(base, { page: '', ...('category' in patch ? { type: patch.category } : {}), ...patch })}`);
  const pages = Math.ceil(r.total / LIMIT);
  const what = type ? (mt(type)?.plural ?? type) : 'everything';
  return h('div', null,
    filterBar({ categories: TYPES.mediaTypes.map((t) => ({ value: t.id, label: `${t.plural}${st.types[t.id] ? ' · ' + st.types[t.id] : ''}`, group: GROUPS[t.group] })), category: type, categoryLabel: 'Category', sort, q: query, tags, tag, showTags, plusHref: '/library/new', plusLabel: 'Add something to the library', searchLabel: 'Search the library', go }),
    h('div', { class: 'list-head' }, h('h1', null, h('span', { class: 'kicker' }, 'Library:'), what, tag ? ` · ${tag}` : '', query ? ` · "${query}"` : ''), h('span', { class: 'muted' }, `${r.total} ${sort === 'new' ? 'newest first' : sort === 'popular' ? 'most popular first' : 'A to Z'}`)),
    h('div', { class: 'list-rule', 'aria-hidden': 'true' }),
    r.items.length ? h('ul', { class: 'list ent-list', style: `counter-reset: row ${page * LIMIT}` }, ...r.items.map((e) => h('li', null, entityLink(e)))) : empty(query || tag ? 'Nothing matches that.' : 'The library is empty. Add something, build a list from a topic, or load the sample data from the Data page.'),
    pages > 1 ? h('div', { class: 'row' }, page > 0 ? h('button', { class: 'btn small', onClick: () => navigate(`/library${qs(base, { page: String(page - 1) })}`) }, 'Previous') : null, h('span', { class: 'muted' }, `Page ${page + 1} of ${pages}`), page + 1 < pages ? h('button', { class: 'btn small', onClick: () => navigate(`/library${qs(base, { page: String(page + 1) })}`) }, 'Next') : null) : null);
});

// ── Entity form (new and edit) ──
route(/^\/library\/new$/, () => entityForm(null));
route(/^\/entity\/([^/]+)\/edit$/, async ([id]) => entityForm(await api<EntityFull>('GET', `/entity/${id}`.replace('/entity/', '/entities/'))));
function entityForm(existing: EntityFull | null): HTMLElement {
  const typeSel = select(typeOptions(), existing?.type ?? 'album', { 'aria-label': 'Media type' });
  const name = h('input', { type: 'text', value: existing?.name ?? '', required: true, maxlength: 200 }) as HTMLInputElement;
  const year = h('input', { type: 'number', value: existing?.year ?? '', min: -5000, max: 3000 }) as HTMLInputElement;
  const desc = h('textarea', { rows: 4, maxlength: 5000 }, existing?.description ?? '') as HTMLTextAreaElement;
  const image = h('input', { type: 'url', value: existing?.imageUrl ?? '', placeholder: 'https://…' }) as HTMLInputElement;
  const aliases = h('input', { type: 'text', value: (existing?.aliases ?? []).join(', '), placeholder: 'Other names, separated by commas' }) as HTMLInputElement;
  const attrBox = h('div', { class: 'attrs' });
  const attrInputs = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
  const renderAttrs = () => {
    attrInputs.clear();
    const t = mt(typeSel.value);
    attrBox.replaceChildren(...(t?.attributes ?? []).map((a) => {
      const cur = existing?.attributes?.[a.key];
      const ctl = a.kind === 'list' ? h('textarea', { rows: 2, placeholder: 'One per line, or separated by commas' }, Array.isArray(cur) ? cur.join('\n') : '') as HTMLTextAreaElement
        : h('input', { type: a.kind === 'number' || a.kind === 'year' ? 'number' : a.kind === 'url' ? 'url' : 'text', value: cur == null ? '' : String(cur), step: a.kind === 'number' ? 'any' : null }) as HTMLInputElement;
      attrInputs.set(a.key, ctl);
      return field(a.label, ctl, a.help);
    }));
  };
  typeSel.addEventListener('change', renderAttrs); renderAttrs();
  const extRows = h('div', { class: 'rows' });
  const addExt = (p = '', v = '') => extRows.appendChild(h('div', { class: 'row tight' }, h('input', { type: 'text', value: p, placeholder: 'provider (musicbrainz, tmdb, wikidata…)', 'aria-label': 'Provider' }), h('input', { type: 'text', value: v, placeholder: 'id', 'aria-label': 'External id' }), h('button', { type: 'button', class: 'btn small', 'aria-label': 'Remove this id', onClick: (e: Event) => (e.target as HTMLElement).parentElement!.remove() }, '×')));
  (existing?.externalIds ?? []).forEach((x) => addExt(x.provider, x.value));
  const srcRows = h('div', { class: 'rows' });
  const addSrc = (u = '', l = '') => srcRows.appendChild(h('div', { class: 'row tight' }, h('input', { type: 'url', value: u, placeholder: 'https://… where this information comes from', 'aria-label': 'Source URL' }), h('input', { type: 'text', value: l, placeholder: 'label', 'aria-label': 'Source label' }), h('button', { type: 'button', class: 'btn small', 'aria-label': 'Remove this source', onClick: (e: Event) => (e.target as HTMLElement).parentElement!.remove() }, '×')));
  (existing?.sources ?? []).forEach((s) => addSrc(s.url, s.label));
  const dupBox = h('div');
  const rows = (box: HTMLElement) => [...box.querySelectorAll(':scope > .row')].map((r) => [...r.querySelectorAll('input')].map((i) => (i as HTMLInputElement).value.trim()));
  const payload = () => {
    const attributes: Record<string, unknown> = {};
    for (const [k, ctl] of attrInputs) if (ctl.value.trim() !== '') attributes[k] = ctl.value;
    return { type: typeSel.value, name: name.value.trim(), year: year.value === '' ? null : Number(year.value), description: desc.value, imageUrl: image.value.trim() || null, aliases: aliases.value.split(',').map((s) => s.trim()).filter(Boolean), attributes, externalIds: rows(extRows).filter(([p, v]) => p && v).map(([provider, value]) => ({ provider, value })), sources: rows(srcRows).filter(([u]) => u).map(([url, label]) => ({ url, label })) };
  };
  let allowDuplicate = false;
  const save = async (e: Event) => {
    e.preventDefault();
    try {
      const body = { ...payload(), allowDuplicate };
      const saved = existing ? await api<Entity>('PATCH', `/entities/${existing.id}`, body) : await api<Entity>('POST', '/entities', body);
      toast(existing ? 'Saved' : 'Added to the library', 'ok');
      navigate(`/entity/${saved.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const d = err.body.duplicate as { entity: EntitySummary; reason: string };
        const cands = err.body.candidates as { entity: EntitySummary; reason: string; strength: string }[];
        dupBox.replaceChildren(h('div', { class: 'card warn' }, h('h3', null, 'This may already be here'), h('ul', { class: 'list' }, ...cands.map((c) => h('li', null, entityLink(c.entity), ' ', h('span', { class: 'muted' }, `— ${c.reason}`)))),
          h('div', { class: 'row' }, link(`/entity/${d.entity.id}`, { class: 'btn' }, `Open ${d.entity.name}`), h('button', { type: 'button', class: 'btn', onClick: (ev: Event) => { allowDuplicate = true; void save(ev); } }, 'It is a different thing, create anyway'))));
        dupBox.scrollIntoView({ block: 'center' });
      } else onErr(err);
    }
  };
  return h('div', null,
    h('h1', null, existing ? `Edit ${existing.name}` : 'Add to the library'),
    h('form', { class: 'form', onSubmit: save },
      field('What kind of thing', typeSel), field('Name', name), field('Year', year, 'Leave blank if it does not apply'), field('Description', desc, 'Your own words. Facts belong in the fields below, with a source.'),
      h('fieldset', null, h('legend', null, 'Details'), attrBox),
      field('Also known as', aliases),
      field('Image', image, 'A web address of a cover or portrait, if you have one'),
      h('fieldset', null, h('legend', null, 'External ids'), extRows, h('button', { type: 'button', class: 'btn small', onClick: () => addExt() }, 'Add an id')),
      h('fieldset', null, h('legend', null, 'Sources'), srcRows, h('button', { type: 'button', class: 'btn small', onClick: () => addSrc() }, 'Add a source')),
      dupBox,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, existing ? 'Save' : 'Add'), existing ? link(`/entity/${existing.id}`, { class: 'btn' }, 'Cancel') : link('/library', { class: 'btn' }, 'Cancel'))));
}

// ── Entity detail ──
route(/^\/entity\/([^/]+)$/, async ([id]) => {
  const e = await api<EntityFull>('GET', `/entities/${id}`);
  const t = mt(e.type);
  const cols = await api<Collection[]>('GET', '/collections');
  const attrs = (t?.attributes ?? []).filter((a) => e.attributes[a.key] != null && e.attributes[a.key] !== '');
  const groups = new Map<string, RelationshipView[]>();
  for (const r of e.relationships) groups.set(r.label, [...(groups.get(r.label) ?? []), r]);
  const relForm = relationshipForm(e);
  const noteBox = h('textarea', { rows: 3, placeholder: 'A private note: where you heard of it, what you thought…' }) as HTMLTextAreaElement;
  const colSel = select([{ value: '', label: 'Add to a list…' }, ...cols.filter((c) => !e.collections.some((x) => x.id === c.id)).map((c) => ({ value: c.id, label: c.title }))], '', { 'aria-label': 'Add to a list' });
  colSel.addEventListener('change', async () => { if (!colSel.value) return; try { await api('POST', `/collections/${colSel.value}/items`, { entityId: e.id }); toast('Added', 'ok'); void render(); } catch (err) { onErr(err); } });
  return h('div', { class: `entity g-${groupOf(e.type)}` },
    h('div', { class: 'ent-head' },
      e.imageUrl ? h('img', { class: 'ent-img', src: e.imageUrl, alt: '' }) : h('div', { class: 'ent-img placeholder', 'aria-hidden': 'true' }, (t?.label ?? e.type).slice(0, 1)),
      h('div', null, h('div', { class: 'crumb' }, link('/library', null, 'Library'), ' › ', link(`/library?type=${e.type}`, null, t?.plural ?? e.type)), h('h1', null, e.name, e.year ? h('span', { class: 'year' }, ` ${e.year}`) : null),
        e.aliases.length ? h('p', { class: 'muted' }, 'Also known as ', e.aliases.join(', ')) : null,
        h('div', { class: 'row' }, link(`/discover?strategy=trail&start=${e.id}`, { class: 'btn primary' }, 'Explore from here'), link(`/entity/${e.id}/edit`, { class: 'btn' }, 'Edit'), h('button', { class: 'btn danger', onClick: async () => { if (!confirmBox(`Delete ${e.name} and its connections? Lists and notes that point at it go too.`)) return; try { await api('DELETE', `/entities/${e.id}`); toast('Deleted', 'ok'); navigate('/library'); } catch (err) { onErr(err); } } }, 'Delete')),
        e.origin === 'sample' ? pill('sample data', 'warn') : isAi(e.origin) ? AI_PILL() : null)),
    e.description ? h('p', { class: 'desc' }, e.description) : null,
    attrs.length || e.externalIds.length || e.sources.length ? section('Details',
      attrs.length ? h('dl', { class: 'dl' }, ...attrs.flatMap((a) => [h('dt', null, a.label), h('dd', null, Array.isArray(e.attributes[a.key]) ? (e.attributes[a.key] as string[]).join(', ') : String(e.attributes[a.key]))])) : null,
      e.externalIds.length ? h('p', { class: 'muted' }, 'External ids: ', e.externalIds.map((x) => `${x.provider} ${x.value}`).join(' · ')) : null,
      e.sources.length ? h('p', { class: 'sources' }, 'Sources: ', ...e.sources.flatMap((s, i) => [i ? ' · ' : '', h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.label || new URL(s.url).hostname)])) : h('p', { class: 'muted small' }, 'No sources recorded. Facts here are unverified until one is added.')) : null,
    section('Connections',
      e.relationships.length ? h('div', { class: 'rel-groups' }, ...[...groups.entries()].map(([label, list]) => h('div', { class: 'rel-group' }, h('h3', null, label), h('ul', { class: 'list' }, ...list.map((r) => h('li', { class: 'rel' }, entityLink(r.other), ' ', pill(r.kind, `kind-${r.kind}`), r.confidence != null ? h('span', { class: 'muted' }, ` ${Math.round(r.confidence * 100)}% sure`) : null, r.note ? h('span', { class: 'muted' }, ` — ${r.note}`) : null, ' ', h('button', { class: 'btn tiny', 'aria-label': `Remove connection to ${r.other.name}`, onClick: async () => { try { await api('DELETE', `/relationships/${r.id}`); void render(); } catch (err) { onErr(err); } } }, '×'))))))) : empty('No connections yet. Add one below and the discovery engine has something to follow.'),
      h('details', { class: 'card', open: !e.relationships.length }, h('summary', null, 'Add a connection'), relForm)),
    section('Lists', e.collections.length ? h('ul', { class: 'list' }, ...e.collections.map((c) => h('li', null, link(`/collections/${c.id}`, null, c.title)))) : empty('Not on any list yet.'), cols.length ? colSel : link('/collections', null, 'Make a list')),
    section('Notes', e.notes.length ? h('ul', { class: 'list notes' }, ...e.notes.map((n) => noteItem(n))) : null,
      h('form', { class: 'row', onSubmit: async (ev: Event) => { ev.preventDefault(); if (!noteBox.value.trim()) return; try { await api('POST', `/entities/${e.id}/notes`, { body: noteBox.value.trim() }); void render(); } catch (err) { onErr(err); } } }, noteBox, h('button', { class: 'btn', type: 'submit' }, 'Add note'))),
    h('p', { class: 'muted small' }, `Added ${fmtDate(e.createdAt)} · updated ${fmtDate(e.updatedAt)} · origin: ${e.origin}`));
});
function noteItem(n: Note): HTMLElement {
  const li = h('li', { class: 'note' });
  const show = () => li.replaceChildren(h('p', null, n.body), h('span', { class: 'muted small' }, fmtDate(n.updatedAt), ' '), h('button', { class: 'btn tiny', onClick: edit }, 'Edit'), ' ', h('button', { class: 'btn tiny', onClick: async () => { try { await api('DELETE', `/notes/${n.id}`); li.remove(); } catch (err) { onErr(err); } } }, 'Delete'));
  const edit = () => { const ta = h('textarea', { rows: 3 }, n.body) as HTMLTextAreaElement; li.replaceChildren(ta, h('div', { class: 'row' }, h('button', { class: 'btn small', onClick: async () => { try { const u = await api<Note>('PATCH', `/notes/${n.id}`, { body: ta.value.trim() }); n.body = u.body; n.updatedAt = u.updatedAt; show(); } catch (err) { onErr(err); } } }, 'Save'), h('button', { class: 'btn small', onClick: show }, 'Cancel'))); };
  show();
  return li;
}
function relationshipForm(e: EntityFull): HTMLElement {
  let other: EntitySummary | null = null;
  const chosen = h('div', { class: 'chosen muted' }, 'Pick the other end from the library.');
  const picker = entityPicker((p) => { other = { ...p, imageUrl: null }; chosen.replaceChildren(h('b', null, p.name), ' ', pill(typeLabel(p.type))); }, { placeholder: 'The other thing…', exclude: [e.id] });
  const typeSel = select(TYPES.relationshipTypes.map((r) => ({ value: r.id, label: r.label })), 'influenced_by', { 'aria-label': 'Relationship' });
  const dir = select([{ value: 'out', label: `${e.name} … the other` }, { value: 'in', label: `the other … ${e.name}` }], 'out', { 'aria-label': 'Direction' });
  const kind = select([{ value: '', label: 'default for this type' }, { value: 'factual', label: 'factual (documented)' }, { value: 'editorial', label: 'editorial (an opinion)' }, { value: 'inferred', label: 'inferred (a guess)' }], '', { 'aria-label': 'Kind of claim' });
  const note = h('input', { type: 'text', placeholder: 'Why? (optional)', maxlength: 500 }) as HTMLInputElement;
  const conf = h('input', { type: 'number', min: 0, max: 100, placeholder: '%', 'aria-label': 'Confidence percent', style: 'width:5em' }) as HTMLInputElement;
  const src = h('input', { type: 'url', placeholder: 'Source URL (optional)' }) as HTMLInputElement;
  return h('form', { class: 'form compact', onSubmit: async (ev: Event) => {
    ev.preventDefault();
    if (!other) { toast('Pick the other end first', 'bad'); return; }
    const fromId = dir.value === 'out' ? e.id : other.id, toId = dir.value === 'out' ? other.id : e.id;
    try { await api('POST', '/relationships', { fromId, toId, type: typeSel.value, kind: kind.value || undefined, note: note.value, confidence: conf.value === '' ? null : Number(conf.value) / 100, sourceUrl: src.value.trim() || undefined }); toast('Connected', 'ok'); void render(); } catch (err) { onErr(err); }
  } }, field('Other end', picker), chosen, h('div', { class: 'row' }, field('Direction', dir), field('Relationship', typeSel)), h('div', { class: 'row' }, field('Kind', kind), field('Confidence', conf)), field('Note', note), field('Source', src), h('button', { class: 'btn primary', type: 'submit' }, 'Connect'));
}

// ── Lists (collections) ──
route(/^\/collections$/, async (_p, q) => {
  const [cols, T] = await Promise.all([api<Collection[]>('GET', '/collections'), templates()]);
  const query = q.get('q') ?? '', kind = q.get('kind') ?? '', sort = q.get('sort') ?? '';
  const base = { q: query, kind, sort };
  const go = (patch: Record<string, string>) => navigate(`/collections${qs(base, { ...('category' in patch ? { kind: patch.category } : {}), ...patch })}`);
  const n = query.toLowerCase();
  let shown = cols.filter((c) => (!kind || c.template === kind || (kind === 'plain' && !c.template)) && (!n || c.title.toLowerCase().includes(n) || c.topic.toLowerCase().includes(n)));
  if (sort === 'new') shown = [...shown].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  else if (sort === 'popular') shown = [...shown].sort((a, b) => b.itemCount - a.itemCount);
  const title = h('input', { type: 'text', placeholder: 'Title', required: true, maxlength: 200 }) as HTMLInputElement;
  const vis = select([{ value: 'private', label: 'private' }, { value: 'unlisted', label: 'unlisted' }, { value: 'public', label: 'public' }], 'private', { 'aria-label': 'Visibility' });
  return h('div', null,
    filterBar({ categories: [...T.templates.map((t) => ({ value: t.id, label: t.label })), { value: 'plain', label: 'Made by hand' }], category: kind, categoryLabel: 'Category', sort, q: query, plusHref: '/lists/new', plusLabel: 'New list from a topic', searchLabel: 'Search lists', go }),
    h('div', { class: 'list-head' }, h('h1', null, h('span', { class: 'kicker' }, 'Lists:'), kind ? (T.templates.find((t) => t.id === kind)?.label ?? 'made by hand') : 'all'), h('span', { class: 'muted' }, `${shown.length} of ${cols.length}${sort === 'new' ? ' · newest first' : sort === 'popular' ? ' · biggest first' : ''}`)),
    h('div', { class: 'list-rule', 'aria-hidden': 'true' }),
    shown.length ? h('ol', { class: 'items' }, ...shown.map((c, i) => h('li', { class: 'item' }, h('span', { class: 'pos' }, `${i + 1}.`), h('div', { class: 'item-body' }, link(`/collections/${c.id}`, { class: 'ent' }, h('span', { class: 'ent-name' }, c.title)), h('span', { class: 'meta' }, `${c.itemCount} item${c.itemCount === 1 ? '' : 's'} · ${c.visibility}${c.template ? ' · ' + c.template : ''} · ${fmtDate(c.updatedAt)}`))))) : empty(cols.length ? 'No list matches that.' : 'No lists yet. Press + to build one from a topic, or start an empty one below.'),
    section('Or start an empty list', h('form', { class: 'row', onSubmit: async (ev: Event) => { ev.preventDefault(); try { const c = await api<Collection>('POST', '/collections', { title: title.value.trim(), visibility: vis.value }); navigate(`/collections/${c.id}`); } catch (err) { onErr(err); } } }, title, vis, h('button', { class: 'btn', type: 'submit' }, 'New list'))),
    h('p', { class: 'muted small' }, 'Visibility is recorded now and enforced once accounts exist (Phase 2). Today everything on this installation is visible to whoever can open it.'));
});
route(/^\/collections\/([^/]+)$/, async ([id]) => {
  const [c, T] = await Promise.all([api<Collection & { items: CollectionItem[] }>('GET', `/collections/${id}`), templates()]);
  const cols = columnsFor(T, c.template);
  const view: 'table' | 'plain' = VIEW.get(id) ?? 'plain';
  // The order is edited here and written only when "Save my order" is pressed.
  let items = [...c.items];
  const dirty = () => items.map((i) => i.entity.id).join() !== c.items.map((i) => i.entity.id).join();
  const saveBtn = h('button', { class: 'btn primary', disabled: true, onClick: async () => { try { await api('PUT', `/collections/${id}/order`, { entityIds: items.map((i) => i.entity.id) }); toast('Order saved', 'ok'); void render(); } catch (err) { onErr(err); } } }, 'Save my order') as HTMLButtonElement;
  const listBox = h('div');
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= items.length) return; [items[i], items[j]] = [items[j], items[i]]; draw(); };
  const removeItem = async (it: CollectionItem) => { try { await api('DELETE', `/collections/${id}/items/${it.entity.id}`); items = items.filter((x) => x !== it); c.items = c.items.filter((x) => x !== it); draw(); } catch (err) { onErr(err); } };
  const ctl = (it: CollectionItem, i: number) => [
    h('button', { type: 'button', class: 'ctl-tri', 'aria-label': `Move ${it.entity.name} up`, disabled: i === 0, onClick: () => move(i, -1) }, '▲'),
    h('button', { type: 'button', class: 'ctl-tri', 'aria-label': `Move ${it.entity.name} down`, disabled: i === items.length - 1, onClick: () => move(i, 1) }, '▼'),
    h('button', { type: 'button', class: 'ctl-tri note', 'aria-label': `Note on ${it.entity.name}`, onClick: async () => { const v = window.prompt('Note for this item', it.note); if (v == null) return; try { await api('PATCH', `/collections/${id}/items/${it.entity.id}`, { note: v }); it.note = v; draw(); } catch (err) { onErr(err); } } }, 'note'),
    h('button', { type: 'button', class: 'ctl-tri x', 'aria-label': `Remove ${it.entity.name}`, onClick: () => void removeItem(it) }, '✕'),
  ];
  const draw = () => {
    saveBtn.disabled = !dirty(); saveBtn.classList.toggle('dirty', dirty());
    listBox.replaceChildren(!items.length ? empty('Nothing in it yet.') : view === 'table'
      ? listTable(cols, items.map(rowFromItem), groupOf, { extra: (_r, i) => h('div', { class: 'item-ctl' }, ...ctl(items[i], i)) })
      : h('ol', { class: 'items' }, ...items.map((it, i) => { const a = it.entity.attributes; const meta = typeof a.creator === 'string' ? a.creator : ''; return h('li', { class: 'item' }, h('span', { class: 'pos' }, `${i + 1}.`), h('div', { class: 'item-body' }, entityLink(it.entity), meta ? h('span', { class: 'meta' }, meta) : null, it.note ? h('p', { class: 'muted' }, it.note) : null), h('div', { class: 'item-ctl' }, ...ctl(it, i))); })));
  };
  draw();
  const title = h('input', { type: 'text', value: c.title, maxlength: 200, 'aria-label': 'Title' }) as HTMLInputElement;
  const desc = h('textarea', { rows: 2, placeholder: 'What holds these together?' }, c.description) as HTMLTextAreaElement;
  const vis = select([{ value: 'private', label: 'private' }, { value: 'unlisted', label: 'unlisted' }, { value: 'public', label: 'public' }], c.visibility, { 'aria-label': 'Visibility' });
  return h('div', null,
    h('div', { class: 'crumb' }, link('/collections', null, 'Lists')),
    h('div', { class: 'list-head' }, h('h1', null, h('span', { class: 'kicker' }, 'List:'), c.title), saveBtn,
      h('div', { class: 'row tight view-row' }, h('button', { type: 'button', class: `chip ${view === 'plain' ? 'on' : ''}`, onClick: () => { VIEW.set(id, 'plain'); void render(); } }, 'Plain list'), h('button', { type: 'button', class: `chip ${view === 'table' ? 'on' : ''}`, onClick: () => { VIEW.set(id, 'table'); void render(); } }, 'Details'))),
    h('div', { class: 'list-rule', 'aria-hidden': 'true' }),
    provenance(c),
    c.description ? h('p', { class: 'desc' }, c.description) : null,
    listBox,
    section('Add something', entityPicker(async (p) => { try { await api('POST', `/collections/${id}/items`, { entityId: p.id }); void render(); } catch (err) { onErr(err); } }, { exclude: items.map((i) => i.entity.id) })),
    h('details', { class: 'card' }, h('summary', null, 'Edit title, description, visibility'), h('form', { class: 'form compact', onSubmit: async (ev: Event) => { ev.preventDefault(); try { await api('PATCH', `/collections/${id}`, { title: title.value.trim(), description: desc.value, visibility: vis.value }); toast('Saved', 'ok'); void render(); } catch (err) { onErr(err); } } }, field('Title', title), field('Description', desc), field('Visibility', vis), h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save'), h('button', { type: 'button', class: 'btn danger', onClick: async () => { if (!confirmBox('Delete this list? The things in it stay in the library.')) return; try { await api('DELETE', `/collections/${id}`); navigate('/collections'); } catch (err) { onErr(err); } } }, 'Delete list')))),
    h('p', { class: 'muted small' }, `${c.visibility} · created ${fmtDate(c.createdAt)}`));
});
const VIEW = new Map<string, 'table' | 'plain'>();   // table or plain list per collection, for this visit

// ── Discover ──
route(/^\/discover$/, async (_p, q) => {
  const strategies = await api<{ id: string; name: string; description: string; needs: string[] }[]>('GET', '/discover/strategies');
  const strategy = q.get('strategy') ?? (q.get('start') ? 'trail' : 'random'), startId = q.get('start') ?? '', type = q.get('type') ?? '';
  const s = strategies.find((x) => x.id === strategy) ?? strategies[0];
  const start = startId ? await api<Entity>('GET', `/entities/${startId}`).catch(() => null) : null;
  const dismissed = new Set<string>();
  const results = h('div', { class: 'recs' });
  const go = (patch: Record<string, string>) => { const u = new URLSearchParams({ strategy: s.id, ...(startId ? { start: startId } : {}), ...(type ? { type } : {}), ...patch }); for (const [k, v] of [...u.entries()]) if (!v) u.delete(k); navigate(`/discover?${u}`); };
  const load = async () => {
    results.replaceChildren(h('p', { class: 'muted' }, 'Thinking…'));
    try {
      const recs = await api<Recommendation[]>('GET', `/discover/${s.id}?${new URLSearchParams({ ...(startId ? { start: startId } : {}), ...(type ? { type } : {}), limit: '8', seed: String(Math.floor(Math.random() * 1e9)) })}`);
      const shown = recs.filter((r) => !dismissed.has(r.entity.id));
      results.replaceChildren(shown.length ? h('div', null, ...shown.map((r) => recCard(r, (card) => { dismissed.add(r.entity.id); card.remove(); }))) : empty(s.needs.includes('start') && !start ? 'Pick a starting point above.' : 'Nothing to suggest from here yet: add some connections and try again.'));
    } catch (e) { results.replaceChildren(h('p', { class: 'error' }, (e as Error).message)); }
  };
  const typeSel = select([{ value: '', label: 'any kind of thing' }, ...typeOptions()], type, { 'aria-label': 'Limit to a media type' });
  typeSel.addEventListener('change', () => go({ type: typeSel.value }));
  const page = h('div', null, h('h1', null, 'Discover'),
    h('p', { class: 'lead' }, 'Every suggestion says which strategy made it, how it connects, what the evidence is and how sure it is. Three strategies exist now; the ones that need a taste profile come with Phase 4 and 5.'),
    h('div', { class: 'strategies', role: 'tablist' }, ...strategies.map((x) => h('button', { class: `strategy ${x.id === s.id ? 'on' : ''}`, role: 'tab', 'aria-selected': String(x.id === s.id), onClick: () => go({ strategy: x.id }) }, h('b', null, x.name), h('span', null, x.description)))),
    h('div', { class: 'row discover-ctl' },
      s.needs.includes('start') ? h('div', { class: 'start' }, h('span', { class: 'muted' }, 'Start from: '), start ? h('span', null, entityLink(start), ' ') : null, entityPicker((p) => go({ start: p.id }), { placeholder: start ? 'Change the starting point…' : 'Pick a starting point…' })) : null,
      field('Only', typeSel), h('button', { class: 'btn', onClick: () => void load() }, 'Again')),
    results);
  void load();
  return page;
});
function recCard(r: Recommendation, onDismiss: (card: HTMLElement) => void): HTMLElement {
  const card: HTMLElement = h('article', { class: `rec g-${groupOf(r.entity.type)}` },
    h('div', { class: 'rec-head' }, entityLink(r.entity, 'big'), pill(r.strategy, 'strategy')),
    h('p', { class: 'rec-why' }, r.explanation),
    h('p', { class: 'muted' }, r.connection),
    r.evidence.length ? h('details', null, h('summary', null, `Evidence (${r.evidence.length})`), h('ul', { class: 'list small' }, ...r.evidence.map((e) => h('li', null, pill(e.kind, `kind-${e.kind}`), ' ', e.text)))) : null,
    r.caveats.length ? h('ul', { class: 'caveats' }, ...r.caveats.map((c) => h('li', null, c))) : null,
    h('div', { class: 'bars' }, bar('relevance', r.relevance), bar('novelty', r.novelty), bar('confidence', r.confidence)),
    h('div', { class: 'row' }, link(`/entity/${r.entity.id}`, { class: 'btn small primary' }, 'Open'), link(`/discover?strategy=trail&start=${r.entity.id}`, { class: 'btn small' }, 'Trail from here'), h('button', { class: 'btn small', onClick: () => onDismiss(card) }, 'Not for me'), h('span', { class: 'muted small next' }, r.nextAction)));
  return card;
}

// ── Data ──
route(/^\/data$/, async () => {
  const st = await api<Status>('GET', '/status');
  const file = h('input', { type: 'file', accept: 'application/json,.json', 'aria-label': 'Export file to import' }) as HTMLInputElement;
  const report = h('div');
  const showReport = (rep: Record<string, { added: number; skipped: number }> & { problems: string[] }, dry: boolean, data?: unknown) => report.replaceChildren(h('div', { class: 'card' }, h('h3', null, dry ? 'What an import would do' : 'Imported'),
    h('ul', { class: 'list' }, ...['entities', 'relationships', 'collections', 'notes'].map((k) => h('li', null, `${k}: ${rep[k].added} ${dry ? 'would be added' : 'added'}, ${rep[k].skipped} already here`))),
    rep.problems.length ? h('details', null, h('summary', null, `${rep.problems.length} problem${rep.problems.length === 1 ? '' : 's'}`), h('ul', { class: 'list small' }, ...rep.problems.map((p) => h('li', null, p)))) : null,
    dry ? h('button', { class: 'btn primary', onClick: async () => { try { showReport(await api('POST', '/import', data), false); toast('Imported', 'ok'); } catch (err) { onErr(err); } } }, 'Import it') : null));
  return h('div', null, h('h1', null, 'Your data'),
    h('div', { class: 'stats' }, stat(st.entities, 'in the library'), stat(st.relationships, 'connections'), stat(st.collections, 'collections')),
    section('Export', h('p', null, 'Everything in this installation as one JSON file: entities with their attributes, aliases, ids and sources; connections; collections with their order and notes; your notes. Ids are kept, so a restore is exact.'), h('a', { class: 'btn primary', href: '/api/export', download: '' }, 'Download export')),
    section('Import', h('p', null, 'Choose an export file. It is checked first and nothing is written until you confirm. Things already here are skipped, never doubled.'),
      h('div', { class: 'row' }, file, h('button', { class: 'btn', onClick: async () => { const f = file.files?.[0]; if (!f) { toast('Choose a file first', 'bad'); return; } try { const data = JSON.parse(await f.text()); showReport(await api('POST', '/import?dryRun=1', data), true, data); } catch (err) { onErr(err instanceof SyntaxError ? new Error('That file is not JSON') : err); } } }, 'Check the file')), report),
    section('Sample data', h('p', null, st.sample ? 'The labelled sample data is loaded. Every sample entity says so in its description and carries origin "sample"; nothing in it is verified.' : 'Load a small, clearly labelled set of albums, films, people and connections to see the app working. Remove it in one click whenever you like.'),
      st.sample ? h('button', { class: 'btn danger', onClick: async () => { if (!confirmBox('Remove every sample entity, its connections, and the sample collection?')) return; try { const r = await api<{ removed: number }>('DELETE', '/sample'); toast(`Removed ${r.removed} sample entries`, 'ok'); void render(); } catch (err) { onErr(err); } } }, 'Remove sample data')
        : h('button', { class: 'btn', onClick: async () => { try { await api('POST', '/sample'); toast('Sample data loaded', 'ok'); void render(); } catch (err) { onErr(err); } } }, 'Load sample data')));
});

// ── Roadmap ──
route(/^\/roadmap$/, () => {
  const phases: [string, string, 'done' | 'next' | 'later', string][] = [
    ['0', 'Repository audit and architecture', 'done', 'Decisions and documentation: Cloudflare Worker + one SQLite Durable Object, TypeScript end to end, no framework, services behind a SQL seam, migrations.'],
    ['1', 'Working foundation', 'done', 'This release: app shell and navigation, the media-type registry, canonical entities with aliases, typed attributes, external ids and sources, duplicate detection, search, relationships with kinds and confidence, collections and notes, connection-trail / adjacent / random discovery with explanations, export and import, labelled sample data. Plus, pulled forward from Phase 7: lists built from a topic, with list templates (the "stylesheet" for a kind of list) and an optional AI gatherer behind a provider adapter, every result reviewed before it is saved and marked AI-gathered.'],
    ['2', 'Accounts and profiles', 'next', 'Registration and sign-in on an established scheme, profile editing, visibility settings enforced on the server, public profile pages, account export and deletion. Replaces the single edit key.'],
    ['3', 'Rankings and categories', 'later', 'The ranking editor, drafts and publication, revisions, remixing with attribution, public ranking pages and search; category proposals, lifecycle, relationships and pages.'],
    ['4', 'Taste profile and feedback', 'later', 'Onboarding from a few favourites, preference dimensions with evidence and confidence, feedback events, an editable profile page.'],
    ['5', 'Discovery engine', 'later', 'Direct, adjacent, unexpected, contrarian, historical and community strategies on the taste profile; diversity and novelty controls; taste experiments.'],
    ['6', 'Community discovery', 'later', 'Following, likes and bookmarks, category following, people discovery, comments, reporting and moderation.'],
    ['7', 'External metadata and the curator', 'later', 'MusicBrainz, TMDB, Open Library, IGDB, Wikidata and others behind provider adapters, after their terms are checked; deep dives and thematic collections; optional AI-assisted editorial writing.'],
    ['8', 'Cultural radar', 'later', 'Release monitoring, watchlists, sourced announcements, digests.'],
    ['9', 'Community intelligence', 'later', 'Consensus rankings with documented methods, complementary-taste discovery, category analytics.'],
  ];
  return h('div', null, h('h1', null, 'What is built, what is next'),
    h('p', { class: 'lead' }, 'The platform is being built in phases, each one working and tested before the next. Full documentation lives in the repository under ranker/docs.'),
    h('ol', { class: 'phases' }, ...phases.map(([n, title, state, text]) => h('li', { class: `phase ${state}` }, h('div', { class: 'phase-head' }, h('span', { class: 'phase-no' }, n), h('b', null, title), pill(state === 'done' ? 'built' : state === 'next' ? 'next' : 'later', state)), h('p', null, text)))));
});

// ── Settings ──
route(/^\/settings$/, async () => {
  const st = await api<Status>('GET', '/status');
  const key = h('input', { type: 'password', value: editKey.get(), placeholder: 'edit key', autocomplete: 'off' }) as HTMLInputElement;
  return h('div', null, h('h1', null, 'Settings'),
    section('Who can change things', h('p', null, st.locked ? 'This installation is locked: changes need the edit key, which is kept only on this device.' : 'This installation is open: anyone who can reach it can add and change things. To lock it, set the EDIT_KEY secret on the Worker (see docs/SECURITY.md). Accounts replace this in Phase 2.'),
      h('form', { class: 'row', onSubmit: (ev: Event) => { ev.preventDefault(); editKey.set(key.value.trim()); toast(key.value.trim() ? 'Edit key saved on this device' : 'Edit key cleared', 'ok'); } }, key, h('button', { class: 'btn', type: 'submit' }, 'Save on this device'))),
    section('AI gathering', st.ai.configured
      ? h('p', null, `On: lists from a topic are gathered by ${st.ai.provider} / ${st.ai.model}. The key lives only in the Worker secret ANTHROPIC_API_KEY; nothing the AI returns is saved until a person reviews it, and every saved entry is marked AI-gathered and unverified. `, st.locked ? '' : 'This installation is open, so anyone who can reach it can spend the AI budget: set EDIT_KEY too.')
      : h('p', null, 'Off: no ANTHROPIC_API_KEY secret is set. Lists can still be built by hand. To turn it on, in ranker/ run npx wrangler secret put ANTHROPIC_API_KEY, then redeploy (docs/PROVIDERS.md).')),
    section('Appearance', h('p', null, 'Colours follow your system light or dark setting. Text size follows your browser. Motion is reduced when your system asks for it.')),
    h('p', { class: 'muted small' }, `Ranker ${st.version}`));
});

registerListPages({ groupOf, onErr, route });

setNotFound(() => h('div', null, h('h1', null, 'Not found'), h('p', null, 'There is nothing at this address. ', link('/', null, 'Go home'))));

(async () => {
  try { TYPES = await api('GET', '/types'); } catch (e) { toast('Could not reach the server', 'bad'); }
  await render();
  (window as unknown as { __ranker: unknown }).__ranker = { api, navigate, types: () => TYPES };
})();
