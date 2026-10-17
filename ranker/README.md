# Ranker — the TASTE MACHINE

A cultural discovery engine, personal taste map and community-curation
platform, live at **https://ranker.deeley.org**. This is **Phase 1, the
working foundation**: the catalog, the relationship graph, collections and
notes, a discovery engine that explains itself, and import/export. Accounts,
rankings, categories, the taste profile and the community layers follow in
the phases listed in `docs/ROADMAP.md`.

## What works now

- **Library.** Albums, artists, tracks, labels, scenes, films, TV series,
  film movements, books, publishers, literary movements, games, studios,
  people, podcasts, artworks, art movements and events, each with the
  attributes that fit its kind (`server/domain/media-types.ts`). Aliases,
  external ids, sources with URLs, an image, a description. Search by name
  or alias, filter by type. Duplicate detection before anything is created.
- **Connections.** Twenty relationship types (produced by, directed by,
  influenced by, shares an aesthetic with…), each read correctly from either
  end, each marked as factual, editorial or inferred, with an optional note,
  confidence and source.
- **Collections and notes.** Ordered, annotated groups of things; private
  notes on anything.
- **Discover.** Three strategies behind one interface: connection trails
  (follow the graph two or three steps out and say how you got there),
  adjacent (neighbours of neighbours), and controlled randomness. Every
  suggestion carries its strategy, an explanation, the specific connection,
  the evidence (pointing at real relationships), caveats, and relevance /
  novelty / confidence estimates. Dismissals stick for the session.
- **Data.** One-click export of everything as JSON; import with a dry run
  first, duplicates skipped; labelled sample data to try the app with.
- **Access.** With the `EDIT_KEY` secret set, every change needs the key
  (kept only on the editor's device). Without it the installation is open.
  This is the Phase 1 stand-in for accounts.

## Running it

```sh
npm install
npm run dev          # builds the client and serves it with the API on http://127.0.0.1:8890 (data in dev/ranker.sqlite)
npm test             # Node tests against real SQLite: catalog, relationships, collections, discovery, API, import/export
npm run test:browser # Playwright: the whole flow on desktop and phone (screenshots in dev/shots)
npm run typecheck
```

Environment: `PORT`, `EDIT_KEY` (lock the local server), `RANKER_DB`
(`:memory:` for a throwaway database).

## Deploying

A Cloudflare Worker with one SQLite-backed Durable Object and static assets.
Run the repository's *Deploy Cloudflare Workers* workflow with the `ranker`
option, or `npm run deploy` with `CLOUDFLARE_API_TOKEN` set. To lock the
live installation: `npx wrangler secret put EDIT_KEY`.

## Documentation

| File | What it covers |
|---|---|
| `docs/ARCHITECTURE.md` | The shape of the system, its layers and boundaries, and the deployment |
| `docs/DOMAIN-MODEL.md` | Every table and type, what it means, and what is reserved for later phases |
| `docs/DECISIONS.md` | The architectural decisions and their trade-offs |
| `docs/RECOMMENDATIONS.md` | The recommendation object, the strategy interface, the three strategies, and what comes next |
| `docs/SECURITY.md` | Authorization today, privacy, validation, rate limits, and the Phase 2 plan |
| `docs/PROVIDERS.md` | External data and AI providers: none live yet, and how they will plug in |
| `docs/ROADMAP.md` | Phases 0 to 9, with what each delivers and the order |
| `docs/LIMITATIONS.md` | Honest list of what this release does not do |
