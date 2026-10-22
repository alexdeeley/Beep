# Domain model

Phase 1 tables (`server/db/migrations.ts`, version 1). Ids are text and
stable; timestamps are ISO-8601 UTC; every child row has a foreign key with
`ON DELETE CASCADE`.

| Table | One row is | Notes |
|---|---|---|
| `entities` | a canonical thing: album, film, person, scene… | `type` from the registry; `sort_name` is the normalized name (search, duplicates); `origin` is manual, import, sample or provider:name |
| `entity_aliases` | another name for an entity | normalized for search and duplicate checks |
| `entity_attributes` | one typed attribute (JSON value) | keys and kinds come from `media-types.ts`; unknown keys are refused |
| `external_ids` | an id in an outside system | unique per provider+value: a shared id means the same thing |
| `sources` | where a fact came from | attached to an entity or a relationship; URL, label, retrieved time |
| `relationships` | a typed, directed edge | `kind` factual / editorial / inferred; optional note, confidence 0..1; unique per (from, to, type) |
| `collections` | an ordered, annotated group | visibility public / unlisted / private (recorded now, enforced with accounts); `owner_id` reserved |
| `collection_items` | an entity in a collection | position, note |
| `notes` | a private note on an entity | `owner_id` reserved |
| `audit_events` | a significant change | who, what, when; the basis for moderation trails later |
| `schema_migrations` | an applied migration | |

## Registries (code, not tables)

- **Media types** (`MEDIA_TYPES`): id, label, plural, group (music, film,
  books, games, other), whether it is a person or a consumable work, and its
  attribute definitions (key, label, kind: text, number, year, date, list,
  url). People are one type whose roles are expressed through relationships
  to works.
- **Relationship types** (`RELATIONSHIP_TYPES`): id, label from the `from`
  side, inverse label from the `to` side, default claim kind.

## Shared types (`server/domain/types.ts`)

`Entity`, `EntitySummary`, `Source`, `Relationship`, `RelationshipView` (an
edge seen from one entity, with the other end resolved), `Collection`,
`CollectionItem`, `Note`, `Recommendation`, `EntityInput`, `ExportFile`.

## Reserved for later phases

The spec's full list maps onto this foundation as follows. Nothing here is a
promise of a separate table; it is where each concept will live.

- Phase 2: `users`, `user_profiles`, `sessions`, `follows`; `owner_id` on
  collections and notes becomes required and enforced.
- Phase 3: `rankings`, `ranking_entries` (entity id + position + commentary),
  `ranking_revisions`, `ranking_remixes`; `categories`, `category_submissions`,
  `category_memberships`, `category_relationships`, `category_follows`.
- Phase 4: `user_preferences`, `preference_evidence`, `interaction_events`,
  `taste_profiles`, `recommendation_sessions`, `discovery_trails`,
  `deep_dives`, `deep_dive_steps`.
- Phase 6: `ranking_likes`, `ranking_bookmarks`, `ranking_comments`,
  `content_reports`, `moderation_actions`, `blocks`, `mutes`.
- Phase 7: `entity_submissions`, `metadata_contributions`, `providers`,
  `provider_configurations`, `import_jobs`, `export_jobs`.
- Phase 8: `watchlists`, `watchlist_items`, `release_records`,
  `announcements`, `digests`, `notifications`.
- Phase 9: `community_consensus`, `consensus_participations`.
