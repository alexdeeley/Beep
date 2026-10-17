// ranker.deeley.org: the Worker routes /api/* to the one Catalog Durable
// Object (which holds the SQLite database) and serves the built client for
// everything else.

import { DurableObject } from 'cloudflare:workers';
import type { SqlDriver, Row } from './db/driver.ts';
import { buildServices, handle } from './api.ts';
import type { Services } from './api.ts';

interface Env { CATALOG: DurableObjectNamespace; ASSETS: Fetcher; EDIT_KEY?: string; ENVIRONMENT?: string }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const stub = env.CATALOG.get(env.CATALOG.idFromName('the-catalog'));
      const h = new Headers(request.headers);
      h.set('x-ip', request.headers.get('cf-connecting-ip') ?? '');
      return stub.fetch(new Request(request, { headers: h }));
    }
    return env.ASSETS.fetch(request);
  },
};

// SqlDriver over the Durable Object's SQLite storage.
class DoDriver implements SqlDriver {
  private sql: SqlStorage; private storage: DurableObjectStorage;
  constructor(sql: SqlStorage, storage: DurableObjectStorage) { this.sql = sql; this.storage = storage; }
  query(sql: string, params: unknown[] = []): Row[] { return this.sql.exec(sql, ...(params as SqlStorageValue[])).toArray() as Row[]; }
  transaction<T>(fn: () => T): T { return this.storage.transactionSync(fn); }
}

export class Catalog extends DurableObject<Env> {
  private svc: Services | null = null;
  private services(): Services {
    if (!this.svc) this.svc = buildServices(new DoDriver(this.ctx.storage.sql, this.ctx.storage), 'installation');
    return this.svc;
  }
  async fetch(request: Request): Promise<Response> {
    return handle(request, this.services(), { editKey: this.env.EDIT_KEY || undefined, ip: request.headers.get('x-ip') || 'unknown' });
  }
}
