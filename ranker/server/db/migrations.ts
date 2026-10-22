// Versioned schema. Each migration runs once, in order, inside a transaction;
// the version reached is recorded in schema_migrations. Add a new entry at
// the end to change the schema - never edit an applied one.
//
// Conventions: ids are text (random, stable, never reused); timestamps are
// ISO-8601 strings in UTC; every child row has a foreign key with ON DELETE.

import type { SqlDriver } from './driver.ts';

export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'foundation: catalog, relationships, collections, notes, audit',
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);

      -- The canonical catalog. A row is one real-world thing: an album, a
      -- film, a person, a scene. Type-specific attributes live in
      -- entity_attributes (typed by the media-type registry), never as
      -- extra columns here.
      CREATE TABLE entities (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        sort_name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        year INTEGER,
        image_url TEXT,
        origin TEXT NOT NULL DEFAULT 'manual',           -- manual | import | sample | provider:<id>
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_entities_type ON entities(type);
      CREATE INDEX idx_entities_sort ON entities(sort_name);
      CREATE INDEX idx_entities_year ON entities(year);

      CREATE TABLE entity_aliases (
        entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        alias TEXT NOT NULL,
        alias_norm TEXT NOT NULL,
        PRIMARY KEY (entity_id, alias_norm)
      );
      CREATE INDEX idx_aliases_norm ON entity_aliases(alias_norm);

      CREATE TABLE entity_attributes (
        entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT NOT NULL,                              -- JSON-encoded, typed by the registry
        PRIMARY KEY (entity_id, key)
      );

      CREATE TABLE external_ids (
        entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,                           -- musicbrainz | discogs | tmdb | openlibrary | igdb | wikidata | url | other
        value TEXT NOT NULL,
        PRIMARY KEY (provider, value)
      );
      CREATE INDEX idx_external_entity ON external_ids(entity_id);

      -- Where a fact came from. Attached to an entity (and optionally a
      -- relationship); provenance stays with the metadata it supports.
      CREATE TABLE sources (
        id TEXT PRIMARY KEY,
        entity_id TEXT REFERENCES entities(id) ON DELETE CASCADE,
        relationship_id TEXT,
        url TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        retrieved_at TEXT NOT NULL
      );
      CREATE INDEX idx_sources_entity ON sources(entity_id);

      -- The relationship graph. kind says what sort of claim it is:
      -- factual (sourced or sourceable), editorial (a comparison someone
      -- made) or inferred (the machine guessed). Confidence is 0..1.
      CREATE TABLE relationships (
        id TEXT PRIMARY KEY,
        from_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        to_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('factual', 'editorial', 'inferred')),
        note TEXT NOT NULL DEFAULT '',
        confidence REAL,
        created_at TEXT NOT NULL,
        UNIQUE (from_id, to_id, type)
      );
      CREATE INDEX idx_rel_from ON relationships(from_id);
      CREATE INDEX idx_rel_to ON relationships(to_id);

      -- Personal collections (Phase 1: one installation, no accounts yet;
      -- owner_id is reserved for Phase 2 and stays NULL until then).
      CREATE TABLE collections (
        id TEXT PRIMARY KEY,
        owner_id TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'unlisted', 'private')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE collection_items (
        collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        added_at TEXT NOT NULL,
        PRIMARY KEY (collection_id, entity_id)
      );
      CREATE INDEX idx_items_entity ON collection_items(entity_id);

      CREATE TABLE notes (
        id TEXT PRIMARY KEY,
        owner_id TEXT,
        entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_notes_entity ON notes(entity_id);

      CREATE TABLE audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        actor TEXT NOT NULL DEFAULT 'anonymous',
        action TEXT NOT NULL,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT ''
      );
    `,
  },
  {
    version: 2,
    name: 'lists: a collection remembers the template and topic it was built from',
    sql: `
      -- template: a list template id (server/domain/list-templates.ts), '' for a plain collection
      ALTER TABLE collections ADD COLUMN template TEXT NOT NULL DEFAULT '';
      -- topic: what was typed to build it, e.g. "Beatles albums"
      ALTER TABLE collections ADD COLUMN topic TEXT NOT NULL DEFAULT '';
      -- generated_by: '' when built by hand, otherwise ai:<provider>/<model>
      ALTER TABLE collections ADD COLUMN generated_by TEXT NOT NULL DEFAULT '';
    `,
  },
];

export function migrate(db: SqlDriver): number {
  db.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const applied = new Set(db.query('SELECT version FROM schema_migrations').map((r) => Number(r.version)));
  let current = Math.max(0, ...applied);
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.transaction(() => {
      for (const stmt of splitStatements(m.sql)) db.query(stmt);
      db.query('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [m.version, m.name, new Date().toISOString()]);
    });
    current = m.version;
  }
  return current;
}

// Split on semicolons at the end of statements; comments are stripped first.
function splitStatements(sql: string): string[] {
  return sql
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    .split(';').map((s) => s.trim()).filter(Boolean);
}
