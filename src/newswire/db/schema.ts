/**
 * SQLite schema for the newswire story database, applied as an ordered,
 * idempotent set of migrations (see migrate.ts). The database is not
 * git-committed - it lives in the existing R2 bucket (see sync.ts) and is
 * downloaded/uploaded around each hourly run, so this file is the only
 * durable record of its shape.
 */
export interface Migration {
  id: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    id: "0001_init",
    sql: `
      CREATE TABLE IF NOT EXISTS stories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        headline TEXT NOT NULL,
        summary TEXT NOT NULL,
        topic_tags TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'archived')),
        importance_score REAL NOT NULL DEFAULT 0,
        first_seen_at TEXT NOT NULL,
        last_updated_at TEXT NOT NULL,
        last_posted_at TEXT,
        archived_at TEXT,
        created_in_run_id INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_stories_status ON stories(status);
      CREATE INDEX IF NOT EXISTS idx_stories_last_updated ON stories(last_updated_at);

      CREATE TABLE IF NOT EXISTS story_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        story_id INTEGER NOT NULL REFERENCES stories(id),
        summary TEXT NOT NULL,
        event_time TEXT,
        event_time_confidence TEXT NOT NULL DEFAULT 'unknown' CHECK (event_time_confidence IN ('exact', 'approximate', 'unknown')),
        article_published_at TEXT,
        fact_label TEXT NOT NULL DEFAULT 'FACT' CHECK (fact_label IN ('FACT', 'ANALYSIS', 'UNCONFIRMED', 'BACKGROUND', 'PREDICTION')),
        is_correction INTEGER NOT NULL DEFAULT 0,
        corrects_event_id INTEGER REFERENCES story_events(id),
        discovered_in_run_id INTEGER NOT NULL,
        posted_in_run_id INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_story_events_story ON story_events(story_id);
      CREATE INDEX IF NOT EXISTS idx_story_events_run ON story_events(discovered_in_run_id);

      CREATE TABLE IF NOT EXISTS sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        story_event_id INTEGER NOT NULL REFERENCES story_events(id),
        url TEXT NOT NULL,
        domain TEXT NOT NULL,
        title TEXT,
        source_tier TEXT NOT NULL CHECK (source_tier IN (
          'primary_official', 'court_filing', 'company_statement', 'entertainment_trade',
          'wire_service', 'general_news', 'aggregator', 'blog_social'
        )),
        is_primary_for_event INTEGER NOT NULL DEFAULT 0,
        retrieved_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sources_event ON sources(story_event_id);
      CREATE INDEX IF NOT EXISTS idx_sources_domain ON sources(domain);

      CREATE TABLE IF NOT EXISTS entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        entity_type TEXT NOT NULL CHECK (entity_type IN (
          'PERSON', 'COMPANY', 'COUNTRY', 'ORGANIZATION', 'EVENT', 'LAW', 'PRODUCT', 'PLACE', 'TECHNOLOGY'
        )),
        first_seen_at TEXT NOT NULL,
        UNIQUE(name, entity_type)
      );

      CREATE TABLE IF NOT EXISTS entity_relationships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_entity_id INTEGER NOT NULL REFERENCES entities(id),
        to_entity_id INTEGER NOT NULL REFERENCES entities(id),
        relationship_type TEXT NOT NULL CHECK (relationship_type IN (
          'EMPLOYED_BY', 'ACQUIRED', 'REGULATES', 'INVESTIGATES', 'COMPETES_WITH',
          'AFFECTS', 'LOCATED_IN', 'RESPONDS_TO', 'CONNECTED_TO'
        )),
        evidence_story_event_id INTEGER NOT NULL REFERENCES story_events(id),
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_relationships_from ON entity_relationships(from_entity_id);
      CREATE INDEX IF NOT EXISTS idx_relationships_to ON entity_relationships(to_entity_id);

      CREATE TABLE IF NOT EXISTS story_entities (
        story_id INTEGER NOT NULL REFERENCES stories(id),
        entity_id INTEGER NOT NULL REFERENCES entities(id),
        PRIMARY KEY (story_id, entity_id)
      );

      CREATE TABLE IF NOT EXISTS hourly_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed', 'silent')),
        quiet_hours_outcome TEXT CHECK (quiet_hours_outcome IN ('normal', 'slow', 'silent')),
        candidates_found INTEGER NOT NULL DEFAULT 0,
        candidates_rejected INTEGER NOT NULL DEFAULT 0,
        final_edition_json TEXT,
        publish_status TEXT CHECK (publish_status IN ('published', 'skipped', 'failed', 'dry_run')),
        token_usage_json TEXT,
        error_message TEXT,
        dry_run INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS run_candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL REFERENCES hourly_runs(id),
        stage TEXT NOT NULL,
        candidate_summary TEXT NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('accepted', 'rejected')),
        reason TEXT,
        story_id INTEGER REFERENCES stories(id),
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_run_candidates_run ON run_candidates(run_id);

      CREATE TABLE IF NOT EXISTS research_searches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL REFERENCES hourly_runs(id),
        stage TEXT NOT NULL,
        query TEXT NOT NULL,
        result_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_research_searches_run ON research_searches(run_id);

      CREATE TABLE IF NOT EXISTS deep_research_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
        context_blob TEXT,
        token_usage_json TEXT,
        error_message TEXT
      );

      CREATE TABLE IF NOT EXISTS bluesky_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id INTEGER NOT NULL REFERENCES hourly_runs(id),
        thread_position INTEGER NOT NULL,
        text TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        uri TEXT,
        cid TEXT,
        root_uri TEXT,
        parent_uri TEXT,
        dry_run INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_bluesky_posts_run ON bluesky_posts(run_id);
      CREATE INDEX IF NOT EXISTS idx_bluesky_posts_hash ON bluesky_posts(content_hash);

      CREATE TABLE IF NOT EXISTS corrections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        original_story_event_id INTEGER NOT NULL REFERENCES story_events(id),
        corrected_story_event_id INTEGER NOT NULL REFERENCES story_events(id),
        detected_in_run_id INTEGER NOT NULL REFERENCES hourly_runs(id),
        correction_post_id INTEGER REFERENCES bluesky_posts(id),
        explanation TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `,
  },
];
