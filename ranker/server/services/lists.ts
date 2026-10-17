// Lists built from a topic. Two steps, always with a person in between:
//
//   draft(topic)  -> the AI gathers items with context; we clean and type
//                    every value, match each item against the catalog, and
//                    hand back a draft for review. Nothing is written.
//   commit(draft) -> the reviewed draft becomes real entities (origin
//                    provider:<ai>) and one collection built on the template,
//                    linking to things already in the library instead of
//                    doubling them.

import type { SqlDriver } from '../db/driver.ts';
import type { Collection, CollectionItem, EntityInput, Visibility } from '../domain/types.ts';
import { LIST_TEMPLATES, listTemplate, templateAttributes } from '../domain/list-templates.ts';
import type { ListTemplate } from '../domain/list-templates.ts';
import { attributeValue, normalize, str, ValidationError, yearOf, DESC_MAX } from '../domain/validate.ts';
import { CatalogService, DuplicateError } from './catalog.ts';
import type { DuplicateCandidate } from './catalog.ts';
import { CollectionService } from './collections.ts';
import type { AiProvider, RawDraft, RawItem } from './ai.ts';
import { AiUnavailable } from './ai.ts';
import { now } from './ids.ts';

export const LIST_MIN = 1, LIST_MAX_ITEMS = 60, LIST_DEFAULT = 20;

export interface DraftItem {
  name: string;
  type: string;
  year: number | null;
  description: string;
  why: string;
  uncertain: boolean;
  aliases: string[];
  attributes: Record<string, unknown>;    // typed and validated against the registry
  dropped: string[];                      // attribute values that did not validate, in words
  match: DuplicateCandidate | null;       // the best existing match, if any
  action: 'new' | 'existing' | 'skip';    // the default decision, for the reviewer to change
}

export interface Draft {
  topic: string;
  template: string;
  type: string;
  title: string;
  description: string;
  caveats: string[];
  items: DraftItem[];
  generatedBy: string;                    // ai:<provider>/<model>
  generatedAt: string;
  rejected: string[];                     // items the cleaner threw out, in words
}

export interface CommitInput {
  topic: string; template: string; title: string; description: string; visibility: Visibility; generatedBy: string;
  items: { action: 'new' | 'existing' | 'skip'; existingId?: string; name: string; year: number | null; description: string; why: string; aliases: string[]; attributes: Record<string, unknown> }[];
}

export class ListService {
  private db: SqlDriver; private catalog: CatalogService; private cols: CollectionService; private ai: AiProvider | null;
  constructor(db: SqlDriver, catalog: CatalogService, cols: CollectionService, ai: AiProvider | null) { this.db = db; this.catalog = catalog; this.cols = cols; this.ai = ai; }

  templates(): ListTemplate[] { return LIST_TEMPLATES; }
  aiStatus(): { configured: boolean; provider: string | null; model: string | null } { return { configured: !!this.ai, provider: this.ai?.id ?? null, model: this.ai?.model ?? null }; }

  async draft(raw: { topic?: unknown; template?: unknown; count?: unknown; guidance?: unknown }): Promise<Draft> {
    if (!this.ai) throw new AiUnavailable('AI gathering is not set up on this installation: set the ANTHROPIC_API_KEY secret (docs/PROVIDERS.md)');
    const topic = str(raw.topic, 'topic', 200, true);
    const template = raw.template ? listTemplate(str(raw.template, 'template', 40)) ?? null : null;
    if (raw.template && !template) throw new ValidationError(`unknown list template "${String(raw.template)}"`);
    const count = raw.count == null || raw.count === '' ? LIST_DEFAULT : Math.min(LIST_MAX_ITEMS, Math.max(LIST_MIN, Math.floor(Number(raw.count)) || LIST_DEFAULT));
    const guidance = str(raw.guidance, 'guidance', 1000);
    const out = await this.ai.draftList({ topic, template, templates: LIST_TEMPLATES, count, guidance });
    return this.clean(out, { topic, template, count });
  }

  // Turn whatever the gatherer returned into a typed, validated draft.
  clean(out: RawDraft, ctx: { topic: string; template: ListTemplate | null; count: number }): Draft {
    const template = ctx.template ?? listTemplate(String(out?.template ?? '')) ?? LIST_TEMPLATES[0];
    const defs = templateAttributes(template);
    const rejected: string[] = [];
    const seen = new Set<string>();
    const items: DraftItem[] = [];
    for (const it of Array.isArray(out?.items) ? out.items : []) {
      const r = (it ?? {}) as Partial<RawItem>;
      const name = typeof r.name === 'string' ? r.name.trim().slice(0, 200) : '';
      if (!name) { rejected.push('an item without a name'); continue; }
      const key = normalize(name);
      if (seen.has(key)) { rejected.push(`"${name}" listed twice`); continue; }
      seen.add(key);
      if (items.length >= ctx.count) { rejected.push(`"${name}" (over the ${ctx.count} asked for)`); continue; }
      let year: number | null = null;
      try { year = yearOf(r.year); } catch { rejected.push(`"${name}": year "${String(r.year)}" ignored`); }
      const attributes: Record<string, unknown> = {};
      const dropped: string[] = [];
      for (const a of Array.isArray(r.attributes) ? r.attributes : []) {
        const def = defs.find((d) => d.key === a?.key);
        if (!def) { if (a?.key) dropped.push(`${a.key}: not part of this template`); continue; }
        try { const v = attributeValue(def, a.value); if (v !== undefined) attributes[def.key] = v; } catch (e) { dropped.push(`${def.label}: ${(e as Error).message}`); }
      }
      if (r.popularity != null && Number.isFinite(Number(r.popularity)) && defs.some((d) => d.key === 'popularity')) attributes.popularity = Math.max(0, Math.min(100, Math.round(Number(r.popularity))));
      const aliases = [...new Set((Array.isArray(r.aliases) ? r.aliases : []).map((x) => String(x).trim()).filter((x) => x && normalize(x) !== key))].slice(0, 8);
      const input: EntityInput = { type: template.type, name, aliases };
      const dups = this.catalog.findDuplicates(input);
      const match = dups.find((d) => d.strength === 'exact') ?? dups.find((d) => d.strength === 'strong') ?? dups[0] ?? null;
      items.push({
        name, type: template.type, year,
        description: typeof r.description === 'string' ? r.description.trim().slice(0, DESC_MAX) : '',
        why: typeof r.why === 'string' ? r.why.trim().slice(0, 600) : '',
        uncertain: r.uncertain === true, aliases, attributes, dropped, match,
        action: match?.strength === 'exact' ? 'existing' : 'new',
      });
    }
    return {
      topic: ctx.topic, template: template.id, type: template.type,
      title: (typeof out?.title === 'string' && out.title.trim()) ? out.title.trim().slice(0, 200) : ctx.topic,
      description: typeof out?.description === 'string' ? out.description.trim().slice(0, DESC_MAX) : '',
      caveats: (Array.isArray(out?.caveats) ? out.caveats : []).map((c) => String(c).trim()).filter(Boolean).slice(0, 10),
      items, generatedBy: `ai:${this.ai?.id ?? 'unknown'}/${this.ai?.model ?? 'unknown'}`, generatedAt: now(), rejected,
    };
  }

  // Write the reviewed draft: entities first (reusing existing ones), then
  // the collection with the items in list order, each item's "why" as its
  // note. One transaction: all or nothing.
  commit(raw: unknown): { collection: Collection; items: CollectionItem[]; created: number; linked: number; skipped: number } {
    if (!raw || typeof raw !== 'object') throw new ValidationError('expected an object');
    const r = raw as Record<string, unknown>;
    const template = listTemplate(str(r.template, 'template', 40, true));
    if (!template) throw new ValidationError('unknown list template');
    const title = str(r.title, 'title', 200, true);
    const description = str(r.description, 'description', DESC_MAX);
    const topic = str(r.topic, 'topic', 200);
    const generatedBy = str(r.generatedBy, 'generatedBy', 120);
    const vis = r.visibility === 'public' || r.visibility === 'unlisted' ? r.visibility : 'private';
    if (!Array.isArray(r.items)) throw new ValidationError('items must be a list');
    if (r.items.length > LIST_MAX_ITEMS) throw new ValidationError(`a list holds at most ${LIST_MAX_ITEMS} items`);
    const origin = `provider:${(generatedBy.match(/^ai:([a-z0-9_-]+)/)?.[1] ?? 'ai')}`;
    let created = 0, linked = 0, skipped = 0;
    return this.db.transaction(() => {
      const col = this.cols.create({ title, description, visibility: vis, template: template.id, topic, generatedBy });
      const added = new Set<string>();
      for (const x of r.items as Record<string, unknown>[]) {
        const action = x.action === 'existing' || x.action === 'skip' ? x.action : 'new';
        if (action === 'skip') { skipped++; continue; }
        let id: string;
        if (action === 'existing') {
          id = str(x.existingId, 'existingId', 64, true);
          this.catalog.get(id); linked++;
        } else {
          const input: EntityInput = { type: template.type, name: str(x.name, 'name', 200, true), year: x.year == null ? null : yearOf(x.year), description: str(x.description, 'description', DESC_MAX), aliases: Array.isArray(x.aliases) ? x.aliases.map(String) : [], attributes: (x.attributes && typeof x.attributes === 'object' ? x.attributes : {}) as Record<string, unknown>, origin };
          try { id = this.catalog.create(input, { allowDuplicate: x.force === true }).id; created++; }
          catch (e) { if (e instanceof DuplicateError) { id = e.match.entity.id; linked++; } else throw e; }
        }
        if (added.has(id)) { skipped++; continue; }
        added.add(id);
        this.cols.addItem(col.id, id, str(x.why, 'why', 600));
      }
      return { collection: this.cols.get(col.id), items: this.cols.items(col.id), created, linked, skipped };
    });
  }
}
