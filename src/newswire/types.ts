export type FactLabel = "FACT";
export type QuietHoursOutcome = "normal" | "slow" | "silent";

/** One post in the edition - text has already been checked against the Bluesky grapheme limit by the time this exists. */
export interface DraftPost {
  text: string;
  /** Which release id(s) this post is about, so they can be marked posted_in_run_id on success. Always exactly one release per post in practice - kept as an array for symmetry with the copy-edit/fact-check stages, which operate on posts generically. */
  sourceReleaseIds: number[];
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
