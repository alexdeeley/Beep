// The relationship graph: typed, kinded, sourced edges between entities.

import type { SqlDriver, Row } from '../db/driver.ts';
import { one } from '../db/driver.ts';
import type { Relationship, RelationshipView } from '../domain/types.ts';
import { relationshipType } from '../domain/media-types.ts';
import { ValidationError } from '../domain/validate.ts';
import { CatalogService, NotFound } from './catalog.ts';
import { newId, now } from './ids.ts';

export class RelationshipService {
  private db: SqlDriver; private catalog: CatalogService; private audit: (action: string, subjectType: string, subjectId: string, detail?: string) => void;
  constructor(db: SqlDriver, catalog: CatalogService, audit: (action: string, subjectType: string, subjectId: string, detail?: string) => void = () => {}) { this.db = db; this.catalog = catalog; this.audit = audit; }

  private row(r: Row): Relationship {
    return { id: String(r.id), fromId: String(r.from_id), toId: String(r.to_id), type: String(r.type), kind: r.kind as Relationship['kind'], note: String(r.note), confidence: r.confidence == null ? null : Number(r.confidence), createdAt: String(r.created_at) };
  }

  create(input: { fromId: string; toId: string; type: string; kind?: Relationship['kind']; note: string; confidence: number | null; sourceUrl?: string }): Relationship {
    this.catalog.get(input.fromId); this.catalog.get(input.toId);
    const rt = relationshipType(input.type)!;
    if (one(this.db.query('SELECT id FROM relationships WHERE from_id = ? AND to_id = ? AND type = ?', [input.fromId, input.toId, input.type]))) throw new ValidationError('that relationship already exists');
    const id = newId('rel');
    this.db.transaction(() => {
      this.db.query('INSERT INTO relationships (id, from_id, to_id, type, kind, note, confidence, created_at) VALUES (?,?,?,?,?,?,?,?)', [id, input.fromId, input.toId, input.type, input.kind ?? rt.kind, input.note, input.confidence, now()]);
      if (input.sourceUrl) this.db.query('INSERT INTO sources (id, entity_id, relationship_id, url, label, retrieved_at) VALUES (?,?,?,?,?,?)', [newId('src'), null, id, input.sourceUrl, '', now()]);
    });
    this.audit('relationship.create', 'relationship', id, `${input.fromId} ${input.type} ${input.toId}`);
    return this.get(id);
  }

  get(id: string): Relationship {
    const r = one(this.db.query('SELECT * FROM relationships WHERE id = ?', [id]));
    if (!r) throw new NotFound('no such relationship');
    return this.row(r);
  }

  remove(id: string): void { this.get(id); this.db.query('DELETE FROM relationships WHERE id = ?', [id]); this.audit('relationship.delete', 'relationship', id); }

  // Everything touching one entity, with the other end resolved and the
  // label read from this entity's point of view.
  forEntity(entityId: string): RelationshipView[] {
    const rows = this.db.query(`SELECT r.*, e.id AS o_id, e.type AS o_type, e.name AS o_name, e.year AS o_year, e.image_url AS o_image,
      CASE WHEN r.from_id = ? THEN 'out' ELSE 'in' END AS direction
      FROM relationships r JOIN entities e ON e.id = CASE WHEN r.from_id = ? THEN r.to_id ELSE r.from_id END
      WHERE r.from_id = ? OR r.to_id = ? ORDER BY r.type, e.sort_name`, [entityId, entityId, entityId, entityId]);
    return rows.map((r) => {
      const rt = relationshipType(String(r.type));
      const direction = r.direction as 'out' | 'in';
      return { ...this.row(r), direction, label: direction === 'out' ? (rt?.label ?? String(r.type)) : (rt?.inverse ?? String(r.type)), other: { id: String(r.o_id), type: String(r.o_type), name: String(r.o_name), year: r.o_year == null ? null : Number(r.o_year), imageUrl: r.o_image == null ? null : String(r.o_image) } };
    });
  }

  all(): Relationship[] { return this.db.query('SELECT * FROM relationships ORDER BY created_at').map((r) => this.row(r)); }
  count(): number { return Number(one(this.db.query('SELECT COUNT(*) AS n FROM relationships'))?.n ?? 0); }
}
