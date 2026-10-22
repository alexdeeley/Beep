# Architectural decisions

## ADR 1 — Cloudflare Worker + one SQLite Durable Object, not Postgres (yet)

**Context.** Every app on deeley.org is a Cloudflare Worker deployed by one
workflow with one token; there is no Postgres, no server to run, and the
first community will be small. The spec prefers a relational database with
migrations and names Postgres as the production default.

**Decision.** A single SQLite-backed Durable Object holds the database. It
is a real relational SQLite with tables, foreign keys, indexes, transactions
and versioned migrations. All services talk to it through the `SqlDriver`
seam, and the same SQL runs on `node:sqlite` in tests.

**Consequences.** Simple, zero-ops, consistent (one writer). The costs: one
object means one region and no horizontal scaling; storage is bounded by the
Durable Object limits; no SQL console. When the community grows past what one
object serves comfortably, the migration path is: swap `SqlDriver` for D1
(same SQLite dialect, same migrations) or for Postgres (a driver plus dialect
touch-ups in the migrations), and move the data with the export/import
format. Nothing in the services or client changes.

## ADR 2 — TypeScript end to end, no framework

The client is plain DOM with a 200-line toolkit. It keeps the bundle small
(150 KB unminified), the accessibility explicit, and the pages readable as
functions. If component reuse becomes painful in Phase 3's ranking editor, a
small framework can be adopted page by page.

## ADR 3 — An edit key before accounts

Phase 1 is a single installation. An optional `EDIT_KEY` secret gates every
write on the server; without it the installation is open, as the spec allows
for personal installs. It is deliberately not a custom auth scheme: no users,
no passwords, no sessions. Phase 2 brings real accounts on an established
scheme and replaces this.

## ADR 4 — Registries for media and relationship types

A new media type or relationship type is a code entry, not a migration. Typed
attributes are validated against the registry and stored per entity. This
keeps "a film has a runtime, an album has tracks" without a universal schema.

## ADR 5 — Claims are kinded; sources travel with facts

Every relationship is factual, editorial or inferred, and sources attach to
the entity or relationship they support. The UI shows the kind everywhere.
This is the hook for later distinguishing sourced metadata, community
descriptions and AI hypotheses.

## ADR 6 — Recommendations are objects, strategies are plugins

`Recommendation` carries strategy, explanation, connection, evidence,
caveats and estimates from day one; strategies implement one interface.
Taste-profile and community strategies slot in without touching the UI.

## ADR 7 — Sample data is labelled and removable, never silently seeded

Sample entities carry `origin = 'sample'` and say so in their text; they
load only on request and leave in one call. No sources or external ids are
invented for them.

## ADR 8 — AI gathers drafts; people commit; templates are the contract

Lists from a topic were asked for ahead of Phase 7, so the AI adapter
arrived early, under the spec's rules. The AI never writes to the catalog:
it returns a draft that the server validates like any input and a person
reviews row by row. The kinds of list live in one registry, the list
templates, which define both what is gathered (attribute keys, guidance)
and how it is shown (columns, styles), so prompt and UI cannot drift apart
and a new kind of list is one entry. Context shared by every kind (creator,
genres, popularity) became common attributes on every media type rather
than list-only fields, so it is searchable and exportable like everything
else, and `popularity` is documented as an estimate. The provider is the
official Anthropic SDK behind an interface with a fake for tests; the key
is a Worker secret, and drafting is gated like a write so a locked
installation cannot be made to spend it.
