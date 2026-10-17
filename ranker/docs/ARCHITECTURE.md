# Architecture

## Shape

```
browser (client/)  ──HTTP /api/*──▶  Worker (server/worker.ts)  ──▶  Catalog Durable Object
   TypeScript, no framework              routes only                     one SQLite database
   pages = functions returning DOM                                       services + migrations
                                     ──static──▶  public/ (built by build.mjs)
```

- **client/** – the browser app. `ui.ts` is a 200-line toolkit (elements,
  router, API client, toasts, an entity picker); `main.ts` is the pages.
  Built by esbuild into `public/app.js`. Client-side routing with real URLs;
  the Worker serves `index.html` for any non-API, non-file path.
- **server/api.ts** – the HTTP API on web-standard `Request`/`Response`, so
  the same code runs in the Worker and in `dev/local-server.mjs` on Node.
- **server/services/** – the domain logic: `catalog` (entities), `relationships`,
  `collections` (and notes), `discovery` (strategies), `portability`
  (export/import), `sample`. Services talk to SQL through one interface,
  `SqlDriver` (`server/db/driver.ts`), with two implementations: the Durable
  Object's `storage.sql` in production and `node:sqlite` for tests and local
  development. Services never know which.
- **server/domain/** – types shared with the client, the media-type and
  relationship-type registries, and input validation.
- **server/db/migrations.ts** – versioned SQL, applied once each on start,
  recorded in `schema_migrations`.

## Boundaries that matter for later phases

- *Registry, not schema, for media types.* A new kind of thing is one entry
  in `media-types.ts`; its attributes are typed by the registry and stored
  per entity. Relationship types the same.
- *Entities are referenced, never copied.* Collections, relationships, notes
  and (later) rankings point at an entity id. Metadata changes never alter
  order or membership anywhere.
- *Claims are kinded.* Every relationship is factual, editorial or inferred;
  sources attach to the metadata they support. Later, user-submitted
  metadata and AI hypotheses land in the same vocabulary.
- *Strategies are plugins.* `DiscoveryStrategy` is one interface; the taste
  profile (Phase 4) and community signals (Phase 5/6) add strategies and
  inputs without changing the recommendation object.
- *Ownership columns exist.* `owner_id` on collections and notes is NULL in
  Phase 1 and becomes the authorization key in Phase 2.

## Deployment

One Cloudflare Worker (`wrangler.jsonc`): static assets with the single-page
fallback; `/api/*` forwarded to the one `Catalog` Durable Object named
`the-catalog`, which owns the SQLite database and runs the services. Custom
domain `ranker.deeley.org`. Deploys from `.github/workflows/deploy-workers.yml`.

The database lives inside the Durable Object's storage. See
`docs/DECISIONS.md` for why, what it costs, and the path to D1 or Postgres.
