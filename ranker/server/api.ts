// The HTTP API, on web-standard Request/Response so the same code serves
// the Worker and the local Node server. One function: handle(request).
//
// Authorization today (Phase 1): a single installation. If EDIT_KEY is
// configured, every change needs header `x-edit-key`; reads are open.
// Accounts, ownership and per-object visibility arrive in Phase 2 and
// replace this guard - see docs/SECURITY.md.

import type { SqlDriver } from './db/driver.ts';
import { migrate } from './db/migrations.ts';
import { MEDIA_TYPES, RELATIONSHIP_TYPES } from './domain/media-types.ts';
import { entityInput, relationshipInput, str, visibility, ValidationError, NOTE_MAX, DESC_MAX } from './domain/validate.ts';
import { CatalogService, DuplicateError, NotFound } from './services/catalog.ts';
import { RelationshipService } from './services/relationships.ts';
import { CollectionService } from './services/collections.ts';
import { PortabilityService } from './services/portability.ts';
import { DiscoveryService } from './services/discovery.ts';
import { loadSample, removeSample } from './services/sample.ts';
import { ListService } from './services/lists.ts';
import { GENERIC_COLUMNS } from './domain/list-templates.ts';
import { AiRefused, AiUnavailable } from './services/ai.ts';
import type { AiProvider } from './services/ai.ts';
import { now } from './services/ids.ts';

export const VERSION = '0.2.0';

export interface Services { catalog: CatalogService; rels: RelationshipService; cols: CollectionService; port: PortabilityService; disc: DiscoveryService; lists: ListService; db: SqlDriver }

export function buildServices(db: SqlDriver, actor = 'anonymous', opts: { ai?: AiProvider | null } = {}): Services {
  migrate(db);
  const audit = (action: string, subjectType: string, subjectId: string, detail = '') => { db.query('INSERT INTO audit_events (at, actor, action, subject_type, subject_id, detail) VALUES (?,?,?,?,?,?)', [now(), actor, action, subjectType, subjectId, detail]); };
  const catalog = new CatalogService(db, audit);
  const rels = new RelationshipService(db, catalog, audit);
  const cols = new CollectionService(db, catalog, audit);
  const port = new PortabilityService(db, catalog, rels, cols);
  const disc = new DiscoveryService(db, catalog, rels);
  const lists = new ListService(db, catalog, cols, opts.ai ?? null);
  return { catalog, rels, cols, port, disc, lists, db };
}

const json = (data: unknown, status = 200): Response => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const err = (message: string, status: number, extra: Record<string, unknown> = {}): Response => json({ error: message, ...extra }, status);

class HttpError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }

export interface ApiOptions { editKey?: string; ip?: string }

export async function handle(request: Request, svc: Services, opts: ApiOptions = {}): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();
  const locked = !!opts.editKey;
  try {
    if (method !== 'GET' && method !== 'HEAD') {
      if (locked && request.headers.get('x-edit-key') !== opts.editKey) throw new HttpError(401, 'this installation is locked: send the edit key (Settings)');
      if (!rateLimit(opts.ip ?? 'local')) throw new HttpError(429, 'too many changes in a minute; slow down');
    }
    const body = async () => { try { return await request.json(); } catch { throw new HttpError(400, 'the request body must be JSON'); } };
    const m = (re: RegExp) => path.match(re);
    let g: RegExpMatchArray | null;

    if (path === '/health') return json({ ok: true, version: VERSION });
    if (path === '/status') return json({ version: VERSION, locked, entities: svc.catalog.count(), relationships: svc.rels.count(), collections: svc.cols.list().length, types: svc.catalog.typeCounts(), sample: !!svc.db.query("SELECT 1 AS x FROM entities WHERE origin = 'sample' LIMIT 1").length, ai: svc.lists.aiStatus() });
    if (path === '/types') return json({ mediaTypes: MEDIA_TYPES, relationshipTypes: RELATIONSHIP_TYPES });

    // entities
    if (path === '/entities' && method === 'GET') { const sort = url.searchParams.get('sort'); return json(svc.catalog.search(url.searchParams.get('q') ?? '', { type: url.searchParams.get('type') || undefined, tag: url.searchParams.get('tag') || undefined, sort: sort === 'new' || sort === 'popular' ? sort : 'name', limit: num(url.searchParams.get('limit')), offset: num(url.searchParams.get('offset')) })); }
    if (path === '/tags') return json(svc.catalog.tags(url.searchParams.get('type') || undefined));
    if (path === '/entities/recent') return json(svc.catalog.recent(num(url.searchParams.get('limit')) ?? 12));
    if (path === '/entities/check' && method === 'POST') { const b = await body() as Record<string, unknown>; return json({ candidates: svc.catalog.findDuplicates(entityInput(b, true) as never, typeof b.excludeId === 'string' ? b.excludeId : undefined) }); }
    if (path === '/entities' && method === 'POST') {
      const b = await body() as Record<string, unknown>;
      return json(svc.catalog.create(entityInput(b), { allowDuplicate: b.allowDuplicate === true }), 201);
    }
    if ((g = m(/^\/entities\/([^/]+)$/))) {
      const id = g[1];
      if (method === 'GET') { const e = svc.catalog.get(id); return json({ ...e, relationships: svc.rels.forEntity(id), notes: svc.cols.notesFor(id), collections: svc.cols.containing(id) }); }
      if (method === 'PATCH') return json(svc.catalog.update(id, entityInput(await body(), true)));
      if (method === 'DELETE') { svc.catalog.remove(id); return json({ ok: true }); }
    }
    if ((g = m(/^\/entities\/([^/]+)\/relationships$/)) && method === 'GET') return json(svc.rels.forEntity(g[1]));
    if ((g = m(/^\/entities\/([^/]+)\/notes$/)) && method === 'POST') { const b = await body() as Record<string, unknown>; return json(svc.cols.addNote(g[1], str(b.body, 'note', NOTE_MAX, true)), 201); }

    // relationships
    if (path === '/relationships' && method === 'POST') { const b = await body() as Record<string, unknown>; const input = relationshipInput(b); return json(svc.rels.create({ ...input, sourceUrl: typeof b.sourceUrl === 'string' && b.sourceUrl ? b.sourceUrl : undefined }), 201); }
    if ((g = m(/^\/relationships\/([^/]+)$/)) && method === 'DELETE') { svc.rels.remove(g[1]); return json({ ok: true }); }

    // notes
    if ((g = m(/^\/notes\/([^/]+)$/))) {
      if (method === 'PATCH') { const b = await body() as Record<string, unknown>; return json(svc.cols.updateNote(g[1], str(b.body, 'note', NOTE_MAX, true))); }
      if (method === 'DELETE') { svc.cols.removeNote(g[1]); return json({ ok: true }); }
    }

    // collections
    if (path === '/collections' && method === 'GET') return json(svc.cols.list());
    if (path === '/collections' && method === 'POST') { const b = await body() as Record<string, unknown>; return json(svc.cols.create({ title: str(b.title, 'title', 200, true), description: str(b.description, 'description', DESC_MAX), visibility: visibility(b.visibility) }), 201); }
    if ((g = m(/^\/collections\/([^/]+)$/))) {
      const id = g[1];
      if (method === 'GET') return json({ ...svc.cols.get(id), items: svc.cols.items(id) });
      if (method === 'PATCH') { const b = await body() as Record<string, unknown>; return json(svc.cols.update(id, { title: b.title === undefined ? undefined : str(b.title, 'title', 200, true), description: b.description === undefined ? undefined : str(b.description, 'description', DESC_MAX), visibility: b.visibility === undefined ? undefined : visibility(b.visibility) })); }
      if (method === 'DELETE') { svc.cols.remove(id); return json({ ok: true }); }
    }
    if ((g = m(/^\/collections\/([^/]+)\/items$/)) && method === 'POST') { const b = await body() as Record<string, unknown>; return json(svc.cols.addItem(g[1], str(b.entityId, 'entityId', 64, true), str(b.note, 'note', DESC_MAX)), 201); }
    if ((g = m(/^\/collections\/([^/]+)\/order$/)) && method === 'PUT') { const b = await body() as Record<string, unknown>; if (!Array.isArray(b.entityIds)) throw new ValidationError('entityIds must be a list'); return json(svc.cols.reorder(g[1], b.entityIds.map(String))); }
    if ((g = m(/^\/collections\/([^/]+)\/items\/([^/]+)$/))) {
      if (method === 'DELETE') return json(svc.cols.removeItem(g[1], g[2]));
      if (method === 'PATCH') { const b = await body() as Record<string, unknown>; return json(svc.cols.setItemNote(g[1], g[2], str(b.note, 'note', DESC_MAX))); }
    }

    // lists from a topic (the templates are the "stylesheet"; drafting needs the AI provider)
    if (path === '/lists/templates') return json({ templates: svc.lists.templates(), generic: GENERIC_COLUMNS, ai: svc.lists.aiStatus() });
    if (path === '/lists/draft' && method === 'POST') {
      if (!aiLimit(opts.ip ?? 'local')) throw new HttpError(429, 'too many AI drafts in a minute; wait a little');
      return json(await svc.lists.draft(await body() as Record<string, unknown>));
    }
    if (path === '/lists/commit' && method === 'POST') return json(svc.lists.commit(await body()), 201);

    // discovery
    if (path === '/discover/strategies') return json(svc.disc.strategies.map(({ id, name, description, needs }) => ({ id, name, description, needs })));
    if ((g = m(/^\/discover\/([a-z]+)$/)) && method === 'GET') {
      const s = svc.disc.strategy(g[1]);
      if (!s) throw new HttpError(404, 'unknown strategy');
      try {
        return json(svc.disc.run(g[1], { startId: url.searchParams.get('start') || undefined, type: url.searchParams.get('type') || undefined, limit: num(url.searchParams.get('limit')), depth: num(url.searchParams.get('depth')), seed: num(url.searchParams.get('seed')) }));
      } catch (e) { if (e instanceof NotFound) throw e; throw new HttpError(400, (e as Error).message); }
    }

    // portability and sample data
    if (path === '/export' && method === 'GET') return new Response(JSON.stringify(svc.port.exportAll(), null, 2), { headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="ranker-export-${new Date().toISOString().slice(0, 10)}.json"` } });
    if (path === '/import' && method === 'POST') return json(svc.port.importAll(await body(), { dryRun: url.searchParams.get('dryRun') === '1' }));
    if (path === '/sample' && method === 'POST') return json(svc.db.transaction(() => loadSample(svc.catalog, svc.rels, svc.cols)), 201);
    if (path === '/sample' && method === 'DELETE') return json({ removed: svc.db.transaction(() => removeSample(svc.catalog, svc.db)) });

    throw new HttpError(404, 'not found');
  } catch (e) {
    if (e instanceof DuplicateError) return err(e.message, 409, { duplicate: e.match, candidates: e.candidates });
    if (e instanceof ValidationError || e instanceof NotFound || e instanceof HttpError || e instanceof AiUnavailable || e instanceof AiRefused) return err(e.message, (e as { status: number }).status);
    console.error(e);
    return err('something went wrong on the server', 500);
  }
}

const num = (v: string | null): number | undefined => (v == null || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));

// Light in-memory rate limits per address: 120 changes a minute, and 6 AI
// drafts a minute (each one costs real money on the installation's key).
const recent = new Map<string, number[]>();
const recentAi = new Map<string, number[]>();
const limiter = (store: Map<string, number[]>, max: number) => (ip: string): boolean => {
  const t = Date.now();
  const list = (store.get(ip) ?? []).filter((x) => t - x < 60_000);
  if (list.length >= max) return false;
  list.push(t); store.set(ip, list);
  return true;
};
const rateLimit = limiter(recent, 120);
const aiLimit = limiter(recentAi, 6);
