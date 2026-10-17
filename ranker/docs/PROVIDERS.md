# External data and AI providers

**Status: none are live.** Phase 1 has manual entry, sample data and
import/export only. Everything on the site is identified as manual, sample,
or imported through `origin`.

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
- AI assistance (editorial text, hypotheses, natural-language search) goes
  behind its own adapter, is optional, never required for core functions,
  and its output is stored and shown as interpretation, not fact.
