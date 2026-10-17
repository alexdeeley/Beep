// The discovery engine's foundation: a shared strategy interface, the
// recommendation object, and the three strategies that make sense before
// there is a taste profile (Phase 4) - connection trails, adjacent-by-graph
// and controlled randomness. Each strategy is deterministic given a seed,
// explains itself, and cites the relationships it used as evidence.
//
// Strategies that need preferences (direct, contrarian, historical, taste
// experiments) and community signals come in later phases and plug in here
// without changing the interface - see docs/RECOMMENDATIONS.md.

import type { SqlDriver, Row } from '../db/driver.ts';
import type { EntitySummary, Recommendation } from '../domain/types.ts';
import { relationshipType } from '../domain/media-types.ts';
import { CatalogService } from './catalog.ts';
import { RelationshipService } from './relationships.ts';

export interface DiscoveryInput { startId?: string; type?: string; limit?: number; seed?: number; depth?: number; exclude?: string[] }

export interface DiscoveryStrategy {
  id: string;
  name: string;
  description: string;
  needs: ('start' | 'profile' | 'community')[];
  run(input: DiscoveryInput): Recommendation[];
}

// Deterministic PRNG so "random" is reproducible in tests.
export const mulberry32 = (seed: number) => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

interface Edge { id: string; from: string; to: string; type: string; kind: 'factual' | 'editorial' | 'inferred'; note: string }

export class DiscoveryService {
  readonly strategies: DiscoveryStrategy[];
  private db: SqlDriver; private catalog: CatalogService; private rels: RelationshipService;
  constructor(db: SqlDriver, catalog: CatalogService, rels: RelationshipService) {
    this.db = db; this.catalog = catalog; this.rels = rels;
    this.strategies = [
      { id: 'trail', name: 'Connection trail', description: 'Follow relationships outward from a starting point into territory two or three steps away, and say how you got there.', needs: ['start'], run: (i) => this.trail(i) },
      { id: 'adjacent', name: 'Adjacent', description: 'Things one step removed from what you started with that are not directly linked to it: the neighbours of its neighbours.', needs: ['start'], run: (i) => this.adjacent(i) },
      { id: 'random', name: 'Controlled randomness', description: 'A genuine surprise, optionally held to one media type. The explanation is honest about being chance.', needs: [], run: (i) => this.random(i) },
    ];
  }

  strategy(id: string): DiscoveryStrategy | undefined { return this.strategies.find((s) => s.id === id); }

  run(strategyId: string, input: DiscoveryInput): Recommendation[] {
    const s = this.strategy(strategyId);
    if (!s) throw new Error('unknown strategy ' + strategyId);
    if (s.needs.includes('start') && !input.startId) throw new Error(`${s.name} needs a starting entity`);
    return s.run(input);
  }

  private edges(): Edge[] {
    return this.db.query('SELECT id, from_id, to_id, type, kind, note FROM relationships').map((r: Row) => ({ id: String(r.id), from: String(r.from_id), to: String(r.to_id), type: String(r.type), kind: r.kind as Edge['kind'], note: String(r.note) }));
  }

  private describe(e: Edge, fromSide: string): string {
    const rt = relationshipType(e.type);
    return e.from === fromSide ? (rt?.label ?? e.type) : (rt?.inverse ?? e.type);
  }

  private summary(id: string): EntitySummary | null {
    try { const e = this.catalog.get(id); return { id: e.id, type: e.type, name: e.name, year: e.year, imageUrl: e.imageUrl }; } catch { return null; }
  }

  // Breadth-first walk out to `depth` steps; recommend what sits at the far
  // end, ordered by distance (farther = more novel), citing the path.
  private trail(input: DiscoveryInput): Recommendation[] {
    const start = this.catalog.get(input.startId!);
    const depth = Math.min(4, Math.max(1, input.depth ?? 3)), limit = Math.min(50, input.limit ?? 8);
    const edges = this.edges();
    const byNode = new Map<string, Edge[]>();
    for (const e of edges) { byNode.set(e.from, [...(byNode.get(e.from) ?? []), e]); byNode.set(e.to, [...(byNode.get(e.to) ?? []), e]); }
    const path = new Map<string, Edge[]>([[start.id, []]]);
    const queue = [start.id];
    while (queue.length) {
      const cur = queue.shift()!;
      const p = path.get(cur)!;
      if (p.length >= depth) continue;
      for (const e of byNode.get(cur) ?? []) {
        const next = e.from === cur ? e.to : e.from;
        if (path.has(next)) continue;
        path.set(next, [...p, e]); queue.push(next);
      }
    }
    const exclude = new Set([start.id, ...(input.exclude ?? [])]);
    const out: Recommendation[] = [];
    const sorted = [...path.entries()].filter(([id]) => !exclude.has(id)).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    for (const [id, p] of sorted) {
      const entity = this.summary(id);
      if (!entity || (input.type && entity.type !== input.type)) continue;
      const steps: string[] = [];
      let at = start.id;
      const evidence: Recommendation['evidence'] = [];
      for (const e of p) {
        const next = e.from === at ? e.to : e.from;
        const nextName = this.summary(next)?.name ?? next;
        const atName = this.summary(at)?.name ?? at;
        steps.push(`${atName} ${this.describe(e, at)} ${nextName}`);
        evidence.push({ kind: e.kind, text: `${atName} ${this.describe(e, at)} ${nextName}${e.note ? ' - ' + e.note : ''}`, relationshipId: e.id });
        at = next;
      }
      const editorial = p.filter((e) => e.kind !== 'factual').length;
      out.push({
        entity, strategy: 'trail',
        explanation: `${entity.name} is ${p.length} step${p.length === 1 ? '' : 's'} from ${start.name}: ${steps.join('; ')}.`,
        connection: `Reached from ${start.name} through ${p.length === 1 ? 'a direct link' : p.length + ' links'}.`,
        relevance: Math.max(0.2, 1 - 0.22 * (p.length - 1)), novelty: Math.min(1, 0.25 * p.length + 0.1), confidence: Math.max(0.3, 0.9 - 0.2 * editorial),
        evidence, caveats: editorial ? [`${editorial} of the ${p.length} links ${editorial === 1 ? 'is an editorial comparison' : 'are editorial comparisons'}, not a documented fact.`] : [],
        nextAction: 'Open it and see where its own connections lead.', createdAt: new Date().toISOString(),
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  // Neighbours of neighbours that are not neighbours: the classic "you came
  // here via X, you might not know Y which also connects to X".
  private adjacent(input: DiscoveryInput): Recommendation[] {
    const start = this.catalog.get(input.startId!);
    const edges = this.edges();
    const direct = new Map<string, Edge>();
    for (const e of edges) { if (e.from === start.id) direct.set(e.to, e); else if (e.to === start.id) direct.set(e.from, e); }
    const via = new Map<string, { through: string; e1: Edge; e2: Edge }[]>();
    for (const [mid, e1] of direct) {
      for (const e2 of edges) {
        if (e2.id === e1.id) continue;
        const other = e2.from === mid ? e2.to : e2.to === mid ? e2.from : null;
        if (!other || other === start.id || direct.has(other)) continue;
        via.set(other, [...(via.get(other) ?? []), { through: mid, e1, e2 }]);
      }
    }
    const exclude = new Set(input.exclude ?? []);
    const limit = Math.min(50, input.limit ?? 8);
    const out: Recommendation[] = [];
    for (const [id, routes] of [...via.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
      if (exclude.has(id)) continue;
      const entity = this.summary(id);
      if (!entity || (input.type && entity.type !== input.type)) continue;
      const evidence = routes.slice(0, 3).map((r) => { const t = this.summary(r.through)?.name ?? r.through; return { kind: r.e2.kind, text: `${start.name} ${this.describe(r.e1, start.id)} ${t}; ${t} ${this.describe(r.e2, r.through)} ${entity.name}`, relationshipId: r.e2.id }; });
      const throughNames = [...new Set(routes.map((r) => this.summary(r.through)?.name ?? r.through))];
      out.push({
        entity, strategy: 'adjacent',
        explanation: `${entity.name} shares ${routes.length === 1 ? 'a connection' : routes.length + ' connections'} with ${start.name} through ${throughNames.slice(0, 3).join(', ')}${throughNames.length > 3 ? ' and others' : ''}, but is not linked to it directly.`,
        connection: `Two steps from ${start.name}, via ${throughNames[0]}.`,
        relevance: Math.min(1, 0.45 + 0.15 * routes.length), novelty: 0.5, confidence: Math.min(0.9, 0.5 + 0.1 * routes.length),
        evidence, caveats: routes.every((r) => r.e2.kind !== 'factual') ? ['Every link in this connection is an editorial comparison.'] : [],
        nextAction: 'Add the direct link if you think it belongs, or keep exploring.', createdAt: new Date().toISOString(),
      });
      if (out.length >= limit) break;
    }
    return out;
  }

  private random(input: DiscoveryInput): Recommendation[] {
    const limit = Math.min(50, input.limit ?? 5);
    const rng = mulberry32(input.seed ?? (Date.now() & 0xffffffff));
    const rows = this.db.query(input.type ? 'SELECT id, type, name, year, image_url FROM entities WHERE type = ?' : 'SELECT id, type, name, year, image_url FROM entities', input.type ? [input.type] : []);
    const exclude = new Set([...(input.exclude ?? []), ...(input.startId ? [input.startId] : [])]);
    const pool = rows.map((r) => this.catalog.summary(r)).filter((e) => !exclude.has(e.id));
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    return pool.slice(0, limit).map((entity) => {
      const links = this.rels.forEntity(entity.id).length;
      return {
        entity, strategy: 'random',
        explanation: `${entity.name} came up by chance${input.type ? ` among the ${entity.type.replace('_', ' ')}s` : ''}. It has ${links} connection${links === 1 ? '' : 's'} in the catalog to follow from here.`,
        connection: 'No connection to you was used: this is a deliberate surprise.',
        relevance: 0.3, novelty: 0.9, confidence: 0.2,
        evidence: [], caveats: ['Chosen at random; nothing about your taste went into it.'],
        nextAction: links ? 'Open it and follow a connection.' : 'Open it and add what it connects to.', createdAt: new Date().toISOString(),
      };
    });
  }
}
