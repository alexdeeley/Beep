// Export everything as one documented JSON file; import it back safely:
// every record is validated, ids are preserved so a restore is exact, and
// duplicates (same id, or same type+name / external id) are reported and
// skipped rather than doubled up.

import type { SqlDriver } from '../db/driver.ts';
import { one } from '../db/driver.ts';
import type { ExportFile } from '../domain/types.ts';
import { entityInput, relationshipInput, str, visibility, ValidationError, NOTE_MAX } from '../domain/validate.ts';
import { CatalogService } from './catalog.ts';
import { RelationshipService } from './relationships.ts';
import { CollectionService } from './collections.ts';

export interface ImportReport { entities: { added: number; skipped: number }; relationships: { added: number; skipped: number }; collections: { added: number; skipped: number }; notes: { added: number; skipped: number }; problems: string[] }

export class PortabilityService {
  private db: SqlDriver; private catalog: CatalogService; private rels: RelationshipService; private cols: CollectionService;
  constructor(db: SqlDriver, catalog: CatalogService, rels: RelationshipService, cols: CollectionService) { this.db = db; this.catalog = catalog; this.rels = rels; this.cols = cols; }

  exportAll(): ExportFile {
    const entities = this.db.query('SELECT id FROM entities ORDER BY created_at').map((r) => this.catalog.get(String(r.id)));
    const collections = this.cols.list().map((c) => ({ ...c, items: this.cols.items(c.id).map((i) => ({ entityId: i.entity.id, position: i.position, note: i.note })) }));
    return { format: 'ranker-export', version: 1, exportedAt: new Date().toISOString(), entities, relationships: this.rels.all(), collections, notes: this.cols.allNotes() };
  }

  // dryRun: validate and report without writing anything.
  importAll(raw: unknown, opts: { dryRun?: boolean } = {}): ImportReport {
    if (!raw || typeof raw !== 'object') throw new ValidationError('expected an export file');
    const f = raw as Partial<ExportFile>;
    if (f.format !== 'ranker-export' || f.version !== 1) throw new ValidationError('not a ranker export (format "ranker-export", version 1)');
    const report: ImportReport = { entities: { added: 0, skipped: 0 }, relationships: { added: 0, skipped: 0 }, collections: { added: 0, skipped: 0 }, notes: { added: 0, skipped: 0 }, problems: [] };
    const run = () => {
      const idMap = new Map<string, string>();     // export id -> local id (same unless the thing already existed)
      for (const e of Array.isArray(f.entities) ? f.entities : []) {
        try {
          const id = str((e as { id?: unknown }).id, 'entity id', 64, true);
          const input = entityInput({ ...e, origin: (e as { origin?: string }).origin ?? 'import' });
          if (one(this.db.query('SELECT id FROM entities WHERE id = ?', [id]))) { idMap.set(id, id); report.entities.skipped++; continue; }
          const dup = this.catalog.findDuplicates(input).find((d) => d.strength === 'exact');
          if (dup) { idMap.set(id, dup.entity.id); report.entities.skipped++; report.problems.push(`"${input.name}" already here as ${dup.entity.id} (${dup.reason}); kept the existing one`); continue; }
          if (!opts.dryRun) this.catalog.create(input, { id, allowDuplicate: true });
          idMap.set(id, id); report.entities.added++;
        } catch (err) { report.problems.push(`entity: ${(err as Error).message}`); }
      }
      for (const r of Array.isArray(f.relationships) ? f.relationships : []) {
        try {
          const input = relationshipInput(r);
          const fromId = idMap.get(input.fromId) ?? input.fromId, toId = idMap.get(input.toId) ?? input.toId;
          if (one(this.db.query('SELECT id FROM relationships WHERE from_id = ? AND to_id = ? AND type = ?', [fromId, toId, input.type]))) { report.relationships.skipped++; continue; }
          if (opts.dryRun) { if (!idMap.has(input.fromId) && !one(this.db.query('SELECT id FROM entities WHERE id = ?', [fromId]))) throw new ValidationError(`unknown entity ${fromId}`); }
          else this.rels.create({ ...input, fromId, toId });
          report.relationships.added++;
        } catch (err) { report.problems.push(`relationship: ${(err as Error).message}`); }
      }
      for (const c of Array.isArray(f.collections) ? f.collections : []) {
        try {
          const cc = c as unknown as Record<string, unknown>;
          const id = str(cc.id, 'collection id', 64, true);
          if (one(this.db.query('SELECT id FROM collections WHERE id = ?', [id]))) { report.collections.skipped++; continue; }
          const title = str(cc.title, 'collection title', 200, true);
          if (!opts.dryRun) {
            this.cols.create({ title, description: str(cc.description, 'description', 5000), visibility: visibility(cc.visibility) }, id);
            const items = (Array.isArray(cc.items) ? cc.items : []) as { entityId: string; position: number; note?: string }[];
            for (const it of [...items].sort((a, b) => a.position - b.position)) {
              const eid = idMap.get(it.entityId) ?? it.entityId;
              try { this.cols.addItem(id, eid, str(it.note, 'item note', 5000)); } catch (err) { report.problems.push(`collection "${title}": ${(err as Error).message}`); }
            }
          }
          report.collections.added++;
        } catch (err) { report.problems.push(`collection: ${(err as Error).message}`); }
      }
      for (const n of Array.isArray(f.notes) ? f.notes : []) {
        try {
          const nn = n as unknown as Record<string, unknown>;
          const id = str(nn.id, 'note id', 64, true);
          if (one(this.db.query('SELECT id FROM notes WHERE id = ?', [id]))) { report.notes.skipped++; continue; }
          const eid = idMap.get(str(nn.entityId, 'note entity', 64, true)) ?? String(nn.entityId);
          if (!opts.dryRun) this.cols.addNote(eid, str(nn.body, 'note', NOTE_MAX, true), id);
          report.notes.added++;
        } catch (err) { report.problems.push(`note: ${(err as Error).message}`); }
      }
    };
    if (opts.dryRun) run(); else this.db.transaction(run);
    return report;
  }
}
