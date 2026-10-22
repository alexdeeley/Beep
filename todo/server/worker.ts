// todo.deeley.org: the Worker sends /api/* to the one Vault Durable Object
// (which holds the SQLite database and the reminder alarm) and serves the
// built app for everything else.
import { DurableObject } from 'cloudflare:workers';
import type { SqlDriver, Row } from './driver.ts';
import { buildServices, handle, deliverDue } from './api.ts';
import type { Services } from './api.ts';

interface Env { VAULT: DurableObjectNamespace; ASSETS: Fetcher; TODO_RECOVERY_KEY?: string; VAPID_SUBJECT?: string; ENVIRONMENT?: string }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const stub = env.VAULT.get(env.VAULT.idFromName('the-vault'));
      const h = new Headers(request.headers);
      h.set('x-ip', request.headers.get('cf-connecting-ip') ?? '');
      return stub.fetch(new Request(request, { headers: h }));
    }
    const res = await env.ASSETS.fetch(request);
    // the app shell must never be cached stale, and never framed
    const h = new Headers(res.headers);
    h.set('x-frame-options', 'DENY'); h.set('x-content-type-options', 'nosniff'); h.set('referrer-policy', 'no-referrer');
    if (url.pathname === '/' || url.pathname.endsWith('.html') || url.pathname === '/sw.js') h.set('cache-control', 'no-cache');
    return new Response(res.body, { status: res.status, headers: h });
  },
};

class DoDriver implements SqlDriver {
  private sql: SqlStorage; private storage: DurableObjectStorage;
  constructor(sql: SqlStorage, storage: DurableObjectStorage) { this.sql = sql; this.storage = storage; }
  query(sql: string, params: unknown[] = []): Row[] { return this.sql.exec(sql, ...(params as SqlStorageValue[])).toArray() as Row[]; }
  transaction<T>(fn: () => T): T { return this.storage.transactionSync(fn); }
}

export class Vault extends DurableObject<Env> {
  private svc: Services | null = null;
  private services(): Services {
    if (!this.svc) this.svc = buildServices(new DoDriver(this.ctx.storage.sql, this.ctx.storage), { recoveryKey: this.env.TODO_RECOVERY_KEY, vapidSubject: this.env.VAPID_SUBJECT, environment: this.env.ENVIRONMENT });
    return this.svc;
  }
  // The alarm is the reminder scheduler: it is set to the next reminder
  // time whenever tasks change, and fires exactly then (the platform
  // retries a failed alarm, and markSent keeps a retry from doubling up).
  private async schedule(nextIso: string | null): Promise<void> {
    if (!nextIso) { await this.ctx.storage.deleteAlarm(); return; }
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, Date.parse(nextIso)));
  }
  async fetch(request: Request): Promise<Response> {
    return handle(request, this.services(), { ip: request.headers.get('x-ip') || 'unknown', schedule: (n) => this.schedule(n) });
  }
  async alarm(): Promise<void> {
    const r = await deliverDue(this.services());
    await this.schedule(r.next);
  }
}
