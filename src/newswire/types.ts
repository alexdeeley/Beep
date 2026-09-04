export type FactLabel = "FACT" | "ANALYSIS" | "UNCONFIRMED" | "BACKGROUND" | "PREDICTION";
export type QuietHoursOutcome = "normal" | "slow" | "silent";
export type MusicItemType = "release" | "news";

/** A single "here's a URL I found via web search" claim from the model - unverified until an independent stage re-checks it. */
export interface ReportedSource {
  url: string;
  title: string;
  domain: string;
}

/** One raw item surfaced by discoverArtistNews, before independent verification. */
export interface MusicNewsCandidate {
  watchedArtistId: number;
  artistName: string;
  itemType: MusicItemType;
  headline: string;
  summary: string;
  eventTimeIso: string | null;
  eventTimeConfidence: "exact" | "approximate" | "unknown";
  sources: ReportedSource[];
}

export interface VerifiedFact {
  claim: string;
  factLabel: FactLabel;
  eventTimeIso: string | null;
  eventTimeConfidence: "exact" | "approximate" | "unknown";
  articlePublishedAtIso: string | null;
  sources: (ReportedSource & { sourceTier: string; isPrimary: boolean })[];
}

/** Output of verifyArtistNews: a candidate that survived independent re-research with the 2-source rule applied. */
export interface VerifiedMusicItem {
  watchedArtistId: number;
  artistName: string;
  itemType: MusicItemType;
  headline: string;
  facts: VerifiedFact[];
  /** False if fewer than 2 independent domains corroborate the core claim - caller should reject it. */
  meetsSourceBar: boolean;
}

/** One post in the edition - text has already been checked against the Bluesky grapheme limit by the time this exists. */
export interface DraftPost {
  text: string;
  /** Which music_item id(s) this post is about, so they can be marked posted_in_run_id on success. Always exactly one item per post in practice - kept as an array for symmetry with the copy-edit/fact-check stages, which operate on posts generically. */
  sourceItemIds: number[];
}

/** The writer stage's output: either an edition worth posting, or null - silence is a valid, expected outcome (e.g. nothing new this hour). */
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
