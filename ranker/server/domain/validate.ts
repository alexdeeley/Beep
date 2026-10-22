// Input validation for everything that enters the catalog. Returns a clean
// value or throws a ValidationError with a message meant for a person.

import { MEDIA_TYPES, mediaType, relationshipType } from './media-types.ts';
import type { AttributeDef } from './media-types.ts';
import type { EntityInput, Visibility } from './types.ts';

export class ValidationError extends Error { status = 400; }
const fail = (m: string): never => { throw new ValidationError(m); };

export const NAME_MAX = 200, DESC_MAX = 5000, NOTE_MAX = 10000, LIST_MAX = 100, ALIAS_MAX = 30;

export const normalize = (s: string): string => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export const str = (v: unknown, field: string, max: number, required = false): string => {
  if (v == null) { if (required) fail(`${field} is required`); return ''; }
  if (typeof v !== 'string') fail(`${field} must be text`);
  const s = (v as string).trim();
  if (required && !s) fail(`${field} is required`);
  if (s.length > max) fail(`${field} is too long (max ${max} characters)`);
  return s;
};

export function yearOf(v: unknown, field = 'year'): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < -5000 || n > 3000) fail(`${field} must be a whole year`);
  return n;
}

export function url(v: unknown, field = 'url'): string {
  const s = str(v, field, 2000, true);
  let u: URL;
  try { u = new URL(s); } catch { return fail(`${field} must be a full web address`); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') fail(`${field} must start with http or https`);
  return u.toString();
}

export function visibility(v: unknown): Visibility {
  if (v == null) return 'private';
  if (v === 'public' || v === 'unlisted' || v === 'private') return v;
  return fail('visibility must be public, unlisted or private');
}

export function attributeValue(def: AttributeDef, v: unknown): unknown {
  if (v == null || v === '') return undefined;
  switch (def.kind) {
    case 'text': return str(v, def.label, 500);
    case 'url': return url(v, def.label);
    case 'year': return yearOf(v, def.label);
    case 'date': { const s = str(v, def.label, 40); if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(s)) fail(`${def.label} must look like 2024-05-17`); return s; }
    case 'number': { const n = Number(v); if (!Number.isFinite(n)) fail(`${def.label} must be a number`); return n; }
    case 'list': {
      const arr = Array.isArray(v) ? v : String(v).split(/\n|,/);
      const out = arr.map((x) => String(x).trim()).filter(Boolean).slice(0, LIST_MAX);
      if (out.some((x) => x.length > 200)) fail(`${def.label}: an item is too long`);
      return out;
    }
  }
}

export function entityInput(raw: unknown, partial = false): EntityInput {
  if (!raw || typeof raw !== 'object') fail('expected an object');
  const r = raw as Record<string, unknown>;
  const out: EntityInput = { type: '', name: '' };
  if (!partial || r.type !== undefined) {
    const t = str(r.type, 'type', 40, true);
    if (!mediaType(t)) fail(`unknown media type "${t}" (known: ${MEDIA_TYPES.map((m) => m.id).join(', ')})`);
    out.type = t;
  }
  if (!partial || r.name !== undefined) out.name = str(r.name, 'name', NAME_MAX, true);
  if (r.description !== undefined) out.description = str(r.description, 'description', DESC_MAX);
  if (r.year !== undefined) out.year = yearOf(r.year);
  if (r.imageUrl !== undefined) out.imageUrl = r.imageUrl ? url(r.imageUrl, 'image') : null;
  if (r.origin !== undefined) { const o = str(r.origin, 'origin', 60); if (!/^(manual|import|sample|provider:[a-z0-9_-]+)$/.test(o)) fail('origin must be manual, import, sample or provider:<name>'); out.origin = o; }
  if (r.aliases !== undefined) {
    if (!Array.isArray(r.aliases)) throw new ValidationError('aliases must be a list');
    out.aliases = [...new Set(r.aliases.map((a: unknown) => str(a, 'alias', NAME_MAX)).filter(Boolean))].slice(0, ALIAS_MAX);
  }
  if (r.externalIds !== undefined) {
    if (!Array.isArray(r.externalIds)) throw new ValidationError('externalIds must be a list');
    out.externalIds = r.externalIds.map((x: unknown) => {
      const e = (x || {}) as Record<string, unknown>;
      const provider = str(e.provider, 'external id provider', 40, true).toLowerCase();
      if (!/^[a-z0-9_-]+$/.test(provider)) fail('external id provider must be a short lowercase name');
      return { provider, value: str(e.value, 'external id', 500, true) };
    });
  }
  if (r.sources !== undefined) {
    if (!Array.isArray(r.sources)) throw new ValidationError('sources must be a list');
    out.sources = r.sources.map((x: unknown) => { const s = (x || {}) as Record<string, unknown>; return { url: url(s.url, 'source url'), label: str(s.label, 'source label', 200) }; });
  }
  if (r.attributes !== undefined) {
    if (!r.attributes || typeof r.attributes !== 'object' || Array.isArray(r.attributes)) fail('attributes must be an object');
    const t = out.type || (typeof r.type === 'string' ? r.type : '');
    out.attributes = attributesFor(t, r.attributes as Record<string, unknown>);
  }
  return out;
}

export function attributesFor(type: string, raw: Record<string, unknown>): Record<string, unknown> {
  const mt = mediaType(type);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const def = mt?.attributes.find((a) => a.key === k);
    if (!def) throw new ValidationError(`"${k}" is not an attribute of ${mt?.label ?? type}`);
    const clean = attributeValue(def, v);
    if (clean !== undefined) out[k] = clean;
  }
  return out;
}

export function relationshipInput(raw: unknown): { fromId: string; toId: string; type: string; kind?: 'factual' | 'editorial' | 'inferred'; note: string; confidence: number | null } {
  if (!raw || typeof raw !== 'object') fail('expected an object');
  const r = raw as Record<string, unknown>;
  const type = str(r.type, 'relationship type', 40, true);
  if (!relationshipType(type)) fail(`unknown relationship type "${type}"`);
  const fromId = str(r.fromId, 'fromId', 64, true), toId = str(r.toId, 'toId', 64, true);
  if (fromId === toId) fail('a thing cannot be related to itself');
  let kind: 'factual' | 'editorial' | 'inferred' | undefined;
  if (r.kind !== undefined) { if (r.kind !== 'factual' && r.kind !== 'editorial' && r.kind !== 'inferred') throw new ValidationError('kind must be factual, editorial or inferred'); kind = r.kind; }
  let confidence: number | null = null;
  if (r.confidence != null && r.confidence !== '') { const c = Number(r.confidence); if (!(c >= 0 && c <= 1)) fail('confidence must be between 0 and 1'); confidence = c; }
  return { fromId, toId, type, kind, note: str(r.note, 'note', DESC_MAX), confidence };
}
