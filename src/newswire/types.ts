import type { EntityType, RelationshipType } from "./db/entitiesRepo.js";
import type { SourceTier } from "./db/sourcesRepo.js";

export type FactLabel = "FACT" | "ANALYSIS" | "UNCONFIRMED" | "BACKGROUND" | "PREDICTION";
export type QuietHoursOutcome = "normal" | "slow" | "silent";

/** A single "here's a URL I found via web search" claim from the model - unverified until an independent stage re-checks it. */
export interface ReportedSource {
  url: string;
  title: string;
  domain: string;
}

/** One raw item surfaced by discoverCandidates, before clustering/dedup. */
export interface DiscoveryCandidate {
  headline: string;
  summary: string;
  topicKey: string;
  eventTimeIso: string | null;
  eventTimeConfidence: "exact" | "approximate" | "unknown";
  sources: ReportedSource[];
}

/** A group of candidates judged to be about the same underlying event (syndication/duplicate collapse). */
export interface CandidateCluster {
  id: string;
  topicKey: string;
  representativeHeadline: string;
  representativeSummary: string;
  memberCandidates: DiscoveryCandidate[];
}

export interface VerifiedFact {
  claim: string;
  factLabel: FactLabel;
  eventTimeIso: string | null;
  eventTimeConfidence: "exact" | "approximate" | "unknown";
  articlePublishedAtIso: string | null;
  sources: (ReportedSource & { sourceTier: SourceTier; isPrimary: boolean })[];
}

/** Output of verifyClusters: a cluster that survived independent re-research with the 2-source rule applied. */
export interface VerifiedCluster {
  clusterId: string;
  topicKey: string;
  headline: string;
  facts: VerifiedFact[];
  /** False if fewer than 2 independent domains corroborate the core claim - caller should reject or downgrade to UNCONFIRMED. */
  meetsSourceBar: boolean;
}

export type StoryMemoryDecision =
  | { kind: "new_story"; slug: string; headline: string; summary: string }
  | { kind: "new_event"; storyId: number }
  | { kind: "no_material_change"; storyId: number };

export interface RankedStoryEvent {
  storyId: number;
  storyEventId: number;
  headline: string;
  importanceScore: number;
  topicKey: string;
  isNewStory: boolean;
  /** The verified facts backing this item - what the writer and fact-checker work from. */
  facts: VerifiedFact[];
}

export interface ExtractedEntity {
  name: string;
  entityType: EntityType;
}

export interface ExtractedRelationship {
  fromEntity: ExtractedEntity;
  toEntity: ExtractedEntity;
  relationshipType: RelationshipType;
  /** Quoted or closely-paraphrased text from a verified fact that grounds this relationship - never invented. */
  evidenceQuote: string;
}

/** An evidence-based link between two stories the connections stage found, for the writer to optionally reference. */
export interface StoryConnection {
  storyId: number;
  relatedStoryId: number;
  sharedEntityNames: string[];
  explanation: string;
}

/** One post in a thread - text has already been checked against the Bluesky grapheme limit by the time this exists. */
export interface DraftPost {
  text: string;
  /** Which story_event ids this post draws on, so they can be marked posted_in_run_id on success. */
  sourceEventIds: number[];
}

/** The writer stage's output: either a thread worth posting, or null - silence is a valid, expected outcome. */
export type DraftEdition = { posts: DraftPost[] } | null;

export interface CopyEditIssue {
  postIndex: number;
  phrase: string;
  reason: string;
}

export interface CopyEditResult {
  edition: DraftEdition;
  issuesFixed: CopyEditIssue[];
}

export type ClaimVerdict = "SUPPORTED" | "PARTIALLY_SUPPORTED" | "UNSUPPORTED" | "CONTRADICTED";

export interface FactCheckedClaim {
  postIndex: number;
  claim: string;
  verdict: ClaimVerdict;
  explanation: string;
}

export interface FactCheckResult {
  claims: FactCheckedClaim[];
  /** True only if every material claim is SUPPORTED - the sole condition under which publishing may proceed. */
  allMaterialClaimsSupported: boolean;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  reason: string | null;
}

export interface PublishedPost {
  text: string;
  uri: string;
  cid: string;
}

export interface PublishResult {
  posts: PublishedPost[];
  dryRun: boolean;
}
