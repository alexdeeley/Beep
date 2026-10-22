// Collections (ordered, annotated groups of entities) and notes on entities.
// Phase 1 is a single-user installation: owner_id is reserved for accounts.

import type { SqlDriver, Row } from '../db/driver.ts';
import { one } from '../db/driver.ts';
import type { Collection, CollectionItem, Note, Visibility } from '../domain/types.ts';
import { ValidationError } from '../domain/validate.ts';
import { CatalogService, NotFound } from './catalog.ts';
import { newId, now } from './ids.ts';

export class CollectionService {
  private db: SqlDriver; private catalog: CatalogService; private audit: (action: string, subjectType: string, subjectId: string, detail?: string) => void;
  constructor(db: SqlDriver, catalog: CatalogService, audit: (action: string, subjectType: string, subjectId: string, detail?: string) => void = () => {}) { this.db = db; this.catalog = catalog; this.audit = audit; }

  private row(r: Row): Collection {
    return { id: String(r.id), title: String(r.title), description: String(r.description), visibility: r.visibility as Visibility, itemCount: Number(r.item_count ?? 0), template: String(r.template ?? ''), topic: String(r.topic ?? ''), generatedBy: String(r.generated_by ?? ''), createdAt: String(r.created_at), updatedAt: String(r.updated_at) };
  }
  private readonly select = 'SELECT c.*, (SELECT COUNT(*) FROM collection_items i WHERE i.collection_id = c.id) AS item_count FROM collections c';

  list(): Collection[] { return this.db.query(`${this.select} ORDER BY c.updated_at DESC`).map((r) => this.row(r)); }

  get(id: string): Collection {
    const r = one(this.db.query(`${this.select} WHERE c.id = ?`, [id]));
    if (!r) throw new NotFound('no such collection');
    return this.row(r);
  }

  create(input: { title: string; description?: string; visibility?: Visibility; template?: string; topic?: string; generatedBy?: string }, id = newId('col')): Collection {
    const t = now();
    this.db.query('INSERT INTO collections (id, title, description, visibility, template, topic, generated_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [id, input.title, input.description ?? '', input.visibility ?? 'private', input.template ?? '', input.topic ?? '', input.generatedBy ?? '', t, t]);
    this.audit('collection.create', 'collection', id, input.title);
    return this.get(id);
  }

  update(id: string, patch: { title?: string; description?: string; visibility?: Visibility }): Collection {
    const cur = this.get(id);
    this.db.query('UPDATE collections SET title = ?, description = ?, visibility = ?, updated_at = ? WHERE id = ?', [patch.title ?? cur.title, patch.description ?? cur.description, patch.visibility ?? cur.visibility, now(), id]);
    this.audit('collection.update', 'collection', id);
    return this.get(id);
  }

  remove(id: string): void { this.get(id); this.db.query('DELETE FROM collections WHERE id = ?', [id]); this.audit('collection.delete', 'collection', id); }

  items(id: string): CollectionItem[] {
    this.get(id);
    const attrs = new Map<string, Record<string, unknown>>();
    for (const a of this.db.query('SELECT a.entity_id, a.key, a.value FROM entity_attributes a JOIN collection_items i ON i.entity_id = a.entity_id WHERE i.collection_id = ?', [id])) {
      const e = String(a.entity_id); if (!attrs.has(e)) attrs.set(e, {});
      try { attrs.get(e)![String(a.key)] = JSON.parse(String(a.value)); } catch { /* skip a bad row */ }
    }
    return this.db.query('SELECT i.position, i.note, i.added_at, e.id, e.type, e.name, e.year, e.image_url FROM collection_items i JOIN entities e ON e.id = i.entity_id WHERE i.collection_id = ? ORDER BY i.position', [id])
      .map((r) => ({ entity: { ...this.catalog.summary(r), attributes: attrs.get(String(r.id)) ?? {} }, position: Number(r.position), note: String(r.note), addedAt: String(r.added_at) }));
  }

  addItem(id: string, entityId: string, note = ''): CollectionItem[] {
    this.get(id); this.catalog.get(entityId);
    if (one(this.db.query('SELECT 1 AS x FROM collection_items WHERE collection_id = ? AND entity_id = ?', [id, entityId]))) throw new ValidationError('already in this collection');
    const pos = Number(one(this.db.query('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM collection_items WHERE collection_id = ?', [id]))?.p ?? 1);
    this.db.transaction(() => {
      this.db.query('INSERT INTO collection_items (collection_id, entity_id, position, note, added_at) VALUES (?,?,?,?,?)', [id, entityId, pos, note, now()]);
      this.db.query('UPDATE collections SET updated_at = ? WHERE id = ?', [now(), id]);
    });
    return this.items(id);
  }

  removeItem(id: string, entityId: string): CollectionItem[] {
    this.db.transaction(() => {
      this.db.query('DELETE FROM collection_items WHERE collection_id = ? AND entity_id = ?', [id, entityId]);
      this.renumber(id);
    });
    return this.items(id);
  }

  // Set the full order (a list of entity ids). Items left out keep their
  // relative order after the listed ones - nothing is silently dropped.
  reorder(id: string, entityIds: string[]): CollectionItem[] {
    const cur = this.items(id).map((i) => i.entity.id);
    const wanted = entityIds.filter((e) => cur.includes(e));
    const order = [...new Set([...wanted, ...cur])];
    this.db.transaction(() => {
      order.forEach((e, i) => this.db.query('UPDATE collection_items SET position = ? WHERE collection_id = ? AND entity_id = ?', [i + 1, id, e]));
      this.db.query('UPDATE collections SET updated_at = ? WHERE id = ?', [now(), id]);
    });
    return this.items(id);
  }

  setItemNote(id: string, entityId: string, note: string): CollectionItem[] {
    this.db.query('UPDATE collection_items SET note = ? WHERE collection_id = ? AND entity_id = ?', [note, id, entityId]);
    return this.items(id);
  }

  private renumber(id: string): void {
    const rows = this.db.query('SELECT entity_id FROM collection_items WHERE collection_id = ? ORDER BY position', [id]);
    rows.forEach((r, i) => this.db.query('UPDATE collection_items SET position = ? WHERE collection_id = ? AND entity_id = ?', [i + 1, id, r.entity_id]));
  }

  // Which collections hold this entity.
  containing(entityId: string): Collection[] {
    return this.db.query(`${this.select} WHERE c.id IN (SELECT collection_id FROM collection_items WHERE entity_id = ?) ORDER BY c.title`, [entityId]).map((r) => this.row(r));
  }

  // ── notes ──
  private note(r: Row): Note { return { id: String(r.id), entityId: String(r.entity_id), body: String(r.body), createdAt: String(r.created_at), updatedAt: String(r.updated_at) }; }
  notesFor(entityId: string): Note[] { return this.db.query('SELECT * FROM notes WHERE entity_id = ? ORDER BY created_at', [entityId]).map((r) => this.note(r)); }
  allNotes(): Note[] { return this.db.query('SELECT * FROM notes ORDER BY created_at').map((r) => this.note(r)); }
  addNote(entityId: string, body: string, id = newId('note')): Note {
    this.catalog.get(entityId);
    const t = now();
    this.db.query('INSERT INTO notes (id, entity_id, body, created_at, updated_at) VALUES (?,?,?,?,?)', [id, entityId, body, t, t]);
    return this.note(one(this.db.query('SELECT * FROM notes WHERE id = ?', [id]))!);
  }
  updateNote(id: string, body: string): Note {
    if (!one(this.db.query('SELECT id FROM notes WHERE id = ?', [id]))) throw new NotFound('no such note');
    this.db.query('UPDATE notes SET body = ?, updated_at = ? WHERE id = ?', [body, now(), id]);
    return this.note(one(this.db.query('SELECT * FROM notes WHERE id = ?', [id]))!);
  }
  removeNote(id: string): void { this.db.query('DELETE FROM notes WHERE id = ?', [id]); }
}
