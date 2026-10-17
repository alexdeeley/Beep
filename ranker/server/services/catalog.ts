// The catalog service: canonical entities, their aliases, attributes,
// external ids and sources. Duplicate detection lives here too.

import type { SqlDriver, Row } from '../db/driver.ts';
import { one } from '../db/driver.ts';
import type { Entity, EntityInput, EntitySummary, Source } from '../domain/types.ts';
import { entityInput, normalize, ValidationError } from '../domain/validate.ts';
import { mediaType } from '../domain/media-types.ts';
import { newId, now } from './ids.ts';

export class NotFound extends Error { status = 404; }

export interface DuplicateCandidate { entity: EntitySummary; reason: string; strength: 'exact' | 'strong' | 'possible' }

export class CatalogService {
  private db: SqlDriver;
  private audit: (action: string, subjectType: string, subjectId: string, detail?: string) => void;
  constructor(db: SqlDriver, audit: (action: string, subjectType: string, subjectId: string, detail?: string) => void = () => {}) { this.db = db; this.audit = audit; }

  summary(r: Row): EntitySummary {
    return { id: String(r.id), type: String(r.type), name: String(r.name), year: r.year == null ? null : Number(r.year), imageUrl: r.image_url == null ? null : String(r.image_url) };
  }

  get(id: string): Entity {
    const r = one(this.db.query('SELECT * FROM entities WHERE id = ?', [id]));
    if (!r) throw new NotFound('no such entity');
    return this.hydrate(r);
  }

  private hydrate(r: Row): Entity {
    const id = String(r.id);
    const aliases = this.db.query('SELECT alias FROM entity_aliases WHERE entity_id = ? ORDER BY alias', [id]).map((a) => String(a.alias));
    const attributes: Record<string, unknown> = {};
    for (const a of this.db.query('SELECT key, value FROM entity_attributes WHERE entity_id = ?', [id])) { try { attributes[String(a.key)] = JSON.parse(String(a.value)); } catch { /* skip a bad row rather than fail the entity */ } }
    const externalIds = this.db.query('SELECT provider, value FROM external_ids WHERE entity_id = ? ORDER BY provider', [id]).map((x) => ({ provider: String(x.provider), value: String(x.value) }));
    const sources: Source[] = this.db.query('SELECT id, url, label, retrieved_at FROM sources WHERE entity_id = ? AND relationship_id IS NULL ORDER BY retrieved_at', [id]).map((s) => ({ id: String(s.id), url: String(s.url), label: String(s.label), retrievedAt: String(s.retrieved_at) }));
    return {
      id, type: String(r.type), name: String(r.name), description: String(r.description), year: r.year == null ? null : Number(r.year),
      imageUrl: r.image_url == null ? null : String(r.image_url), origin: String(r.origin), aliases, attributes, externalIds, sources,
      createdAt: String(r.created_at), updatedAt: String(r.updated_at),
    };
  }

  // Create. Refuses an exact duplicate (same type + same normalized name or
  // same external id) unless `allowDuplicate` says the caller has looked.
  create(raw: EntityInput, opts: { allowDuplicate?: boolean; id?: string } = {}): Entity {
    const input = entityInput(raw);              // every entry path validates, not only the API
    const dups = this.findDuplicates(input);
    const exact = dups.find((d) => d.strength === 'exact');
    if (exact && !opts.allowDuplicate) throw new DuplicateError(exact, dups);
    const id = opts.id ?? newId('ent');
    const t = now();
    this.db.transaction(() => {
      this.db.query('INSERT INTO entities (id, type, name, sort_name, description, year, image_url, origin, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [id, input.type, input.name, sortName(input.name), input.description ?? '', input.year ?? null, input.imageUrl ?? null, input.origin ?? 'manual', t, t]);
      this.writeChildren(id, input, true);
    });
    this.audit('entity.create', 'entity', id, input.name);
    return this.get(id);
  }

  update(id: string, rawPatch: EntityInput): Entity {
    const cur = this.get(id);
    let patch = entityInput({ ...rawPatch, type: rawPatch.type || cur.type }, true);
    const type = patch.type || cur.type;
    if (patch.type && patch.type !== cur.type && Object.keys(cur.attributes).length && !patch.attributes) {
      // attributes are typed per media type: changing type means re-stating them
      const keep = Object.fromEntries(Object.entries(cur.attributes).filter(([k]) => mediaType(type)?.attributes.some((a) => a.key === k)));
      patch = { ...patch, attributes: keep };
    }
    this.db.transaction(() => {
      this.db.query('UPDATE entities SET type = ?, name = ?, sort_name = ?, description = ?, year = ?, image_url = ?, updated_at = ? WHERE id = ?',
        [type, patch.name || cur.name, sortName(patch.name || cur.name), patch.description ?? cur.description, patch.year === undefined ? cur.year : patch.year, patch.imageUrl === undefined ? cur.imageUrl : patch.imageUrl, now(), id]);
      this.writeChildren(id, patch, false);
    });
    this.audit('entity.update', 'entity', id);
    return this.get(id);
  }

  private writeChildren(id: string, input: EntityInput, creating: boolean): void {
    if (input.aliases !== undefined || creating) {
      this.db.query('DELETE FROM entity_aliases WHERE entity_id = ?', [id]);
      for (const a of input.aliases ?? []) this.db.query('INSERT OR IGNORE INTO entity_aliases (entity_id, alias, alias_norm) VALUES (?,?,?)', [id, a, normalize(a)]);
    }
    if (input.attributes !== undefined || creating) {
      this.db.query('DELETE FROM entity_attributes WHERE entity_id = ?', [id]);
      for (const [k, v] of Object.entries(input.attributes ?? {})) this.db.query('INSERT INTO entity_attributes (entity_id, key, value) VALUES (?,?,?)', [id, k, JSON.stringify(v)]);
    }
    if (input.externalIds !== undefined || creating) {
      this.db.query('DELETE FROM external_ids WHERE entity_id = ?', [id]);
      for (const x of input.externalIds ?? []) {
        const taken = one(this.db.query('SELECT entity_id FROM external_ids WHERE provider = ? AND value = ?', [x.provider, x.value]));
        if (taken && taken.entity_id !== id) throw new ValidationError(`${x.provider} id ${x.value} already belongs to another entity`);
        this.db.query('INSERT OR REPLACE INTO external_ids (entity_id, provider, value) VALUES (?,?,?)', [id, x.provider, x.value]);
      }
    }
    if (input.sources !== undefined || creating) {
      this.db.query('DELETE FROM sources WHERE entity_id = ? AND relationship_id IS NULL', [id]);
      for (const s of input.sources ?? []) this.db.query('INSERT INTO sources (id, entity_id, url, label, retrieved_at) VALUES (?,?,?,?,?)', [newId('src'), id, s.url, s.label ?? '', now()]);
    }
  }

  remove(id: string): void {
    this.get(id);
    this.db.query('DELETE FROM entities WHERE id = ?', [id]);   // children cascade
    this.audit('entity.delete', 'entity', id);
  }

  count(): number { return Number(one(this.db.query('SELECT COUNT(*) AS n FROM entities'))?.n ?? 0); }

  // Search by name or alias, optionally within a type or a genre tag.
  // sort: 'name' (default; prefix matches first when searching), 'new'
  // (latest added first) or 'popular' (highest popularity estimate first,
  // unrated last).
  search(q: string, opts: { type?: string; tag?: string; sort?: 'name' | 'new' | 'popular'; limit?: number; offset?: number } = {}): { items: EntitySummary[]; total: number } {
    const limit = Math.min(Math.max(1, opts.limit ?? 50), 200), offset = Math.max(0, opts.offset ?? 0);
    const n = normalize(q);
    const where: string[] = [], params: unknown[] = [];
    if (opts.type) { where.push('e.type = ?'); params.push(opts.type); }
    if (opts.tag) { where.push("EXISTS (SELECT 1 FROM entity_attributes g WHERE g.entity_id = e.id AND g.key = 'genres' AND g.value LIKE ?)"); params.push(`%${JSON.stringify(opts.tag).slice(1, -1).replace(/[%_]/g, '')}%`); }
    if (n) {
      where.push('(e.sort_name LIKE ? OR EXISTS (SELECT 1 FROM entity_aliases a WHERE a.entity_id = e.id AND a.alias_norm LIKE ?))');
      params.push(`%${n}%`, `%${n}%`);
    }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = Number(one(this.db.query(`SELECT COUNT(*) AS n FROM entities e ${w}`, params))?.n ?? 0);
    const pop = "(SELECT CAST(p.value AS REAL) FROM entity_attributes p WHERE p.entity_id = e.id AND p.key = 'popularity')";
    const order = opts.sort === 'new' ? 'e.created_at DESC, e.rowid DESC' : opts.sort === 'popular' ? `${pop} IS NULL, ${pop} DESC, e.sort_name` : n ? 'CASE WHEN e.sort_name LIKE ? THEN 0 ELSE 1 END, e.sort_name' : 'e.sort_name';
    const extra = opts.sort !== 'new' && opts.sort !== 'popular' && n ? [`${n}%`] : [];
    const rows = this.db.query(`SELECT e.id, e.type, e.name, e.year, e.image_url FROM entities e ${w} ORDER BY ${order} LIMIT ? OFFSET ?`, [...params, ...extra, limit, offset]);
    return { items: rows.map((r) => this.summary(r)), total };
  }

  // Every genre tag in use, most used first.
  tags(type?: string): { tag: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const r of this.db.query(`SELECT a.value FROM entity_attributes a JOIN entities e ON e.id = a.entity_id WHERE a.key = 'genres'${type ? ' AND e.type = ?' : ''}`, type ? [type] : [])) {
      try { for (const g of JSON.parse(String(r.value)) as string[]) { const k = String(g).trim().toLowerCase(); if (k) counts.set(k, (counts.get(k) ?? 0) + 1); } } catch { /* skip */ }
    }
    return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  recent(limit = 12): EntitySummary[] {
    return this.db.query('SELECT id, type, name, year, image_url FROM entities ORDER BY created_at DESC LIMIT ?', [limit]).map((r) => this.summary(r));
  }

  typeCounts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.db.query('SELECT type, COUNT(*) AS n FROM entities GROUP BY type')) out[String(r.type)] = Number(r.n);
    return out;
  }

  // Duplicate detection: exact = same type and same normalized name/alias,
  // or a shared external id; strong = same name in another type (a film and
  // the book it adapts share a title, so this is a hint, not a block);
  // possible = same normalized name ignoring a leading article.
  findDuplicates(input: EntityInput, excludeId?: string): DuplicateCandidate[] {
    const out: DuplicateCandidate[] = [];
    const seen = new Set<string>();
    const push = (r: Row, reason: string, strength: DuplicateCandidate['strength']) => {
      const id = String(r.id);
      if (id === excludeId || seen.has(id)) return;
      seen.add(id); out.push({ entity: this.summary(r), reason, strength });
    };
    for (const x of input.externalIds ?? []) {
      for (const r of this.db.query('SELECT e.* FROM external_ids x JOIN entities e ON e.id = x.entity_id WHERE x.provider = ? AND x.value = ?', [x.provider, x.value])) push(r, `same ${x.provider} id`, 'exact');
    }
    const names = [input.name, ...(input.aliases ?? [])].map(normalize).filter(Boolean);
    for (const n of names) {
      for (const r of this.db.query('SELECT * FROM entities WHERE sort_name = ? OR id IN (SELECT entity_id FROM entity_aliases WHERE alias_norm = ?)', [n, n])) {
        push(r, String(r.type) === input.type ? 'same name and type' : `same name, but a ${String(r.type)}`, String(r.type) === input.type ? 'exact' : 'strong');
      }
      const bare = n.replace(/^(the|a|an) /, '');
      if (bare !== n) for (const r of this.db.query('SELECT * FROM entities WHERE sort_name = ? AND type = ?', [bare, input.type])) push(r, 'same name apart from "the"', 'possible');
    }
    return out;
  }
}

export class DuplicateError extends Error {
  status = 409;
  match: DuplicateCandidate;
  candidates: DuplicateCandidate[];
  constructor(match: DuplicateCandidate, candidates: DuplicateCandidate[]) {
    super(`"${match.entity.name}" already exists (${match.reason}). Send allowDuplicate: true if it really is a different thing.`);
    this.match = match; this.candidates = candidates;
  }
}

export const sortName = (name: string): string => normalize(name);
