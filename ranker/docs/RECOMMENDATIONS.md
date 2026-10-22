# Recommendations

## The recommendation object

Every suggestion is a `Recommendation` (`server/domain/types.ts`):

- `entity` – what is recommended
- `strategy` – which strategy produced it
- `explanation` – what it is and why, in words, naming the start entity
- `connection` – the specific link to the user or start entity
- `relevance`, `novelty`, `confidence` – 0..1 estimates, shown as such, never as a quality score
- `evidence[]` – each item has a kind (factual / editorial / inferred), text,
  and the id of the real relationship it rests on
- `caveats[]` – reasons it might not fit (e.g. "2 of the 3 links are opinions")
- `nextAction` – what to do with it
- `createdAt`

## The strategy interface

```ts
interface DiscoveryStrategy {
  id; name; description;
  needs: ('start' | 'profile' | 'community')[];
  run(input: { startId?, type?, limit?, seed?, depth?, exclude? }): Recommendation[];
}
```

`GET /api/discover/strategies` lists them; `GET /api/discover/:id` runs one.
`exclude` carries the session's dismissals so a dismissed thing stays out.

## Strategies in Phase 1

| id | What it does | Why it is different |
|---|---|---|
| `trail` | Breadth-first walk from the start entity up to `depth` (default 3) steps; recommends what sits at the far end, farthest first; the explanation narrates the path; each link is evidence | Multi-step, cross-media; novelty rises with distance; confidence falls with each editorial link |
| `adjacent` | Neighbours of the start's neighbours that are not themselves neighbours, ordered by how many shared neighbours | Exactly one hop of novelty; relevance rises with the number of shared connections |
| `random` | A uniformly random pick, optionally within a type, seeded so tests are exact | Says plainly that nothing about the user was used |

Tests (`tests/discovery.test.ts`) check that the three return different
sets, that evidence ids resolve to real relationships, that type filters and
exclusions hold, that a trail never repeats an entity, and that randomness is
reproducible for a seed.

## What comes next

- Phase 4 adds the taste profile; Phase 5 adds `direct`, `unexpected`,
  `contrarian`, `historical` and `experiment` strategies on it, a ranking
  layer that balances relevance, novelty, diversity and confidence with
  user-controlled exploration settings, and dismissal memory across sessions.
- Phase 5/6 add `community` (rankings, categories and followed curators as
  signals) with a setting for how much community activity may influence
  results, and the rule that popularity is never the sole signal.
- Phase 7 adds the curator (thematic collections, deep dives) and optional
  AI-written editorial explanations behind a provider adapter; generated
  text is always labelled as interpretation.
