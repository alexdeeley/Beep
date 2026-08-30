/**
 * Shared structured types for the On This Day pipeline.
 * Every stage reads/writes JSON that conforms to these shapes so the
 * pipeline stays auditable end to end (research -> verification ->
 * selection -> render -> QA -> caption -> publish).
 */

export type Category =
  | "war_conflict"
  | "politics_government"
  | "science_discovery"
  | "invention_technology"
  | "space_exploration"
  | "disaster_natural"
  | "disaster_manmade"
  | "music"
  | "film_television"
  | "literature_arts"
  | "sports"
  | "culture_society"
  | "strange_incident"
  | "birth"
  | "death"
  | "anniversary_other";

export type EventKind = "event" | "birth" | "death";

export interface SourceRef {
  title: string;
  publisher: string;
  url: string;
  /** True if this is a government archive, national library, museum, university, or similarly authoritative institution. */
  authoritative: boolean;
}

/** A single fact as produced by the research stage. Not yet trusted. */
export interface CandidateFact {
  /** Stable id for this candidate within the run, e.g. "c001". */
  id: string;
  kind: EventKind;
  /** Month-day the fact is claimed to have occurred on, ISO "MM-DD". */
  monthDay: string;
  year: number;
  category: Category;
  headline: string;
  description: string;
  people: string[];
  location: string | null;
  historicalImportance: "low" | "medium" | "high";
  sources: SourceRef[];
  confidence: number; // 0-1, research agent's own confidence
  notes: string;
  primarySource: boolean;
  /** Always "unverified" when produced by the research stage. */
  verificationStatus: "unverified";
}

export type VerificationStatus = "verified" | "rejected" | "needs_review";

/** A candidate fact after the independent verification pass. */
export interface VerifiedFact extends Omit<CandidateFact, "verificationStatus"> {
  verificationStatus: VerificationStatus;
  verificationConfidence: number; // 0-1, verifier's own confidence
  verifierNotes: string;
  /** Specific checks the verifier performed and their outcome. */
  checks: {
    dateConfirmed: boolean;
    yearConfirmed: boolean;
    personOrOrgConfirmed: boolean;
    kindConfirmed: boolean; // birth really a birth, death really a death, etc.
    notPublicationDateConfusion: boolean;
    notExaggerated: boolean;
    sufficientlyNotable: boolean;
    corroboratingSources: boolean;
    /** The headline describes the exact same specific occurrence as the description - not a related-but-different event (e.g. an arrest vs. its later sentencing). */
    headlineMatchesDescription: boolean;
  };
  rejectionReason: string | null;
}

export type SelectedFact = VerifiedFact & {
  /** Rank score assigned during selection (higher = stronger). */
  selectionScore: number;
  anniversaryYears: number | null;
};

export interface SelectedContent {
  date: string; // YYYY-MM-DD (local publish date)
  monthDay: string; // MM-DD
  displayDate: string; // "AUGUST 29"
  subtitle: string;
  majorEvents: SelectedFact[];
  births: SelectedFact[];
  deaths: SelectedFact[];
  incidents: SelectedFact[];
  sourceCreditLine: string;
  theme: ThemeName;
}

export type ThemeName = "classic_gold" | "deep_navy" | "museum_burgundy";

export interface DecorativeAsset {
  id: string;
  description: string;
  filePath: string;
  usedFor: "major_events" | "births" | "deaths" | "incidents" | "header" | "background";
}

export interface QAIssue {
  severity: "blocking" | "warning";
  message: string;
}

export interface QAResult {
  status: "PASS" | "FAIL";
  issues: QAIssue[];
  programmaticChecks: {
    name: string;
    passed: boolean;
    detail?: string;
  }[];
  visionCheck: {
    ran: boolean;
    status?: "PASS" | "FAIL";
    issues?: string[];
  };
  checkedAt: string;
}

export interface CaptionResult {
  caption: string;
  hashtags: string[];
}

export interface PublishRecord {
  date: string;
  attemptedAt: string;
  publicImageUrl: string | null;
  /** The published post's AT Protocol URI (at://did/app.bsky.feed.post/<rkey>), once posted. */
  postUri: string | null;
  status: "SKIPPED_DRY_RUN" | "SKIPPED_NO_CREDENTIALS" | "SKIPPED_ALREADY_PUBLISHED" | "SUCCESS" | "FAILED";
  error: string | null;
  caption: string | null;
}

export interface RunRecord {
  date: string;
  startedAt: string;
  finishedAt: string | null;
  stages: Record<
    string,
    {
      status: "PENDING" | "OK" | "FAILED" | "SKIPPED";
      detail?: string;
      startedAt?: string;
      finishedAt?: string;
    }
  >;
  candidateCount: number;
  verifiedCount: number;
  rejectedCount: number;
  publishStatus: PublishRecord["status"] | null;
  failureStage: string | null;
}
