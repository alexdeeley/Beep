import type Database from "better-sqlite3";

export type EntityType =
  | "PERSON"
  | "COMPANY"
  | "COUNTRY"
  | "ORGANIZATION"
  | "EVENT"
  | "LAW"
  | "PRODUCT"
  | "PLACE"
  | "TECHNOLOGY";

export type RelationshipType =
  | "EMPLOYED_BY"
  | "ACQUIRED"
  | "REGULATES"
  | "INVESTIGATES"
  | "COMPETES_WITH"
  | "AFFECTS"
  | "LOCATED_IN"
  | "RESPONDS_TO"
  | "CONNECTED_TO";

export interface EntityRow {
  id: number;
  name: string;
  entity_type: EntityType;
  first_seen_at: string;
}

export interface EntityRelationshipRow {
  id: number;
  from_entity_id: number;
  to_entity_id: number;
  relationship_type: RelationshipType;
  evidence_story_event_id: number;
  created_at: string;
}

/** Finds an existing entity by (name, type) or creates one - entities are deduped on that pair. */
export function upsertEntity(db: Database.Database, name: string, entityType: EntityType): EntityRow {
  const existing = db
    .prepare("SELECT * FROM entities WHERE name = ? AND entity_type = ?")
    .get(name, entityType) as EntityRow | undefined;
  if (existing) return existing;
  const now = new Date().toISOString();
  const result = db
    .prepare("INSERT INTO entities (name, entity_type, first_seen_at) VALUES (?, ?, ?)")
    .run(name, entityType, now);
  return db.prepare("SELECT * FROM entities WHERE id = ?").get(Number(result.lastInsertRowid)) as EntityRow;
}

export function linkStoryEntity(db: Database.Database, storyId: number, entityId: number): void {
  db.prepare("INSERT OR IGNORE INTO story_entities (story_id, entity_id) VALUES (?, ?)").run(storyId, entityId);
}

export function getEntitiesForStory(db: Database.Database, storyId: number): EntityRow[] {
  return db
    .prepare(
      `SELECT e.* FROM entities e
       JOIN story_entities se ON se.entity_id = e.id
       WHERE se.story_id = ?`
    )
    .all(storyId) as EntityRow[];
}

/**
 * Insert a relationship between two entities, always tied to the story
 * event that provides evidence for it - never an invented connection
 * with no textual grounding.
 */
export function insertRelationship(
  db: Database.Database,
  input: {
    fromEntityId: number;
    toEntityId: number;
    relationshipType: RelationshipType;
    evidenceStoryEventId: number;
  }
): EntityRelationshipRow {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO entity_relationships (from_entity_id, to_entity_id, relationship_type, evidence_story_event_id, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(input.fromEntityId, input.toEntityId, input.relationshipType, input.evidenceStoryEventId, now);
  return db
    .prepare("SELECT * FROM entity_relationships WHERE id = ?")
    .get(Number(result.lastInsertRowid)) as EntityRelationshipRow;
}

/** Relationships touching either side of the given entity - the basis for connection-finding between stories. */
export function getRelationshipsForEntity(db: Database.Database, entityId: number): EntityRelationshipRow[] {
  return db
    .prepare("SELECT * FROM entity_relationships WHERE from_entity_id = ? OR to_entity_id = ?")
    .all(entityId, entityId) as EntityRelationshipRow[];
}

/** Other open stories that share at least one entity with the given story - candidate connections. */
export function getStoriesSharingEntities(db: Database.Database, storyId: number): { story_id: number; shared_entities: number }[] {
  return db
    .prepare(
      `SELECT se2.story_id AS story_id, COUNT(*) AS shared_entities
       FROM story_entities se1
       JOIN story_entities se2 ON se2.entity_id = se1.entity_id AND se2.story_id != se1.story_id
       JOIN stories s ON s.id = se2.story_id
       WHERE se1.story_id = ? AND s.status = 'open'
       GROUP BY se2.story_id
       ORDER BY shared_entities DESC`
    )
    .all(storyId) as { story_id: number; shared_entities: number }[];
}
