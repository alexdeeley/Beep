// Domain types shared by the services, the API and the browser client.
// Plain data, JSON-safe. No database or framework types leak through here.

export type Visibility = 'public' | 'unlisted' | 'private';
export type ClaimKind = 'factual' | 'editorial' | 'inferred';

export interface Entity {
  id: string;
  type: string;
  name: string;
  description: string;
  year: number | null;
  imageUrl: string | null;
  origin: string;                       // manual | import | sample | provider:<id>
  aliases: string[];
  attributes: Record<string, unknown>;  // typed by the media-type registry
  externalIds: { provider: string; value: string }[];
  sources: Source[];
  createdAt: string;
  updatedAt: string;
}

export interface EntitySummary { id: string; type: string; name: string; year: number | null; imageUrl: string | null }

export interface Source { id: string; url: string; label: string; retrievedAt: string }

export interface Relationship {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  kind: ClaimKind;
  note: string;
  confidence: number | null;
  createdAt: string;
}

// A relationship as seen from one entity: the other end resolved, and the
// label the right way round.
export interface RelationshipView extends Relationship {
  direction: 'out' | 'in';
  label: string;
  other: EntitySummary;
}

export interface Collection {
  id: string;
  title: string;
  description: string;
  visibility: Visibility;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}
export interface CollectionItem { entity: EntitySummary; position: number; note: string; addedAt: string }

export interface Note { id: string; entityId: string; body: string; createdAt: string; updatedAt: string }

// Every recommendation is a first-class, traceable object (spec part V.9).
export interface Recommendation {
  entity: EntitySummary;
  strategy: string;
  explanation: string;          // what it is and why it was picked, in words
  connection: string;           // the specific link to the user or start entity
  relevance: number;            // 0..1 estimates, never shown as objective quality
  novelty: number;
  confidence: number;
  evidence: { kind: ClaimKind; text: string; relationshipId?: string }[];
  caveats: string[];            // reasons it might not fit
  nextAction: string;
  createdAt: string;
}

export interface EntityInput {
  type: string;
  name: string;
  description?: string;
  year?: number | null;
  imageUrl?: string | null;
  origin?: string;
  aliases?: string[];
  attributes?: Record<string, unknown>;
  externalIds?: { provider: string; value: string }[];
  sources?: { url: string; label?: string }[];
}

export interface ExportFile {
  format: 'ranker-export';
  version: 1;
  exportedAt: string;
  entities: Entity[];
  relationships: Relationship[];
  collections: (Collection & { items: { entityId: string; position: number; note: string }[] })[];
  notes: Note[];
}
