# External data and AI providers

**Status: one AI provider is live, for list gathering only.** No external
metadata provider (MusicBrainz, TMDB…) is wired yet. Everything on the site
is identified through `origin`: `manual`, `sample`, `import`, or
`provider:<id>` (today `provider:anthropic`).

## AI list gathering (live)

`server/services/ai.ts` defines `AiProvider` with one method,
`draftList(request)`, and two implementations: `AnthropicProvider` (the
official `@anthropic-ai/sdk`, model `claude-opus-5-5` by default, streamed
with a JSON-schema output format so the reply is always a well-formed
draft; `fallbacks: "default"` lets a policy decline retry on the model
Anthropic recommends) and `FakeProvider` (deterministic, offline, used by
the tests and by `RANKER_AI=fake` locally).

How it is kept honest:

- **The key is a Worker secret** (`ANTHROPIC_API_KEY`), read in
  `server/worker.ts` and never sent to the browser. Drafting is a POST, so
  on a locked installation it needs the edit key: strangers cannot spend
  the budget. Six drafts a minute per address on top of that.
- **Nothing is written by the AI.** `POST /api/lists/draft` returns a
  draft; `server/services/lists.ts` types and validates every value against
  the media-type registry (bad years, unknown attributes and repeats are
  dropped and reported), matches each item against the catalog, and the
  person reviews every row. Only `POST /api/lists/commit` writes, in one
  transaction, and it links to existing entities rather than doubling them.
- **Interpretation is labelled.** Saved entities carry
  `origin = provider:anthropic`, show an "AI-gathered · unverified" mark
  until a source is added, and the collection records `topic` and
  `generated_by`. `popularity` is stored as what it is: a 0-100 estimate.
- **Core functions never depend on it.** With no key, the page explains how
  to set one and everything else works.
- **The list templates** (`server/domain/list-templates.ts`) are the
  contract between the prompt and the UI: what to gather per kind of list,
  which attribute keys, which columns and how to draw them.

Replacing the provider is one class implementing `AiProvider`, chosen in
`providerFromEnv`.

## How they will plug in (Phase 7)

- A `Provider` adapter per source behind one interface: search, fetch by
  external id, map to `EntityInput` with `externalIds`, `sources` (URL and
  retrieval time) and `origin: 'provider:<id>'`.
- Candidates to evaluate first, each only after checking current terms,
  rate limits, attribution and licensing: MusicBrainz, Discogs, TMDB, Open
  Library, IGDB, Wikidata. Nothing is scraped; nothing is fabricated when a
  provider is down (the UI says it is unavailable).
- Duplicate detection already keys on external ids, so provider imports
  merge into existing entities rather than doubling them.
- Further AI assistance (editorial text, hypotheses, natural-language
  search) extends the same adapter under the same rules: optional, never
  required for core functions, stored and shown as interpretation.
