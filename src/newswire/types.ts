import type { LinkFacet } from "../bluesky/threadPublish.js";

export type FactLabel = "FACT" | "ANALYSIS" | "UNCONFIRMED" | "BACKGROUND" | "PREDICTION";
export type QuietHoursOutcome = "normal" | "slow" | "silent";
export type MusicItemType = "release" | "news";
/** Only set when itemType is "release" - what kind of release it is. Singles post immediately as a mechanical "NEW SINGLE: Artist - Title" post; albums/EPs/compilations are held and batched into the Friday NEW MUSIC FRIDAY roundup instead of posting individually. */
export type ReleaseFormat = "single" | "album" | "ep" | "compilation";

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
  releaseFormat: ReleaseFormat | null;
  /** The clean single/album/EP/compilation title (e.g. "Speyside"), null when itemType is "news". Used to build the mechanical "NEW SINGLE: Artist - Title" post text directly, without going through the writer. */
  releaseTitle: string | null;
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
  releaseFormat: ReleaseFormat | null;
  releaseTitle: string | null;
  headline: string;
  facts: VerifiedFact[];
  /** False if fewer than 2 independent domains corroborate the core claim - caller should reject it. */
  meetsSourceBar: boolean;
}

/** release_format values eligible for the Friday NEW MUSIC FRIDAY roundup (never a single). */
export type RoundupReleaseFormat = "album" | "ep" | "compilation";

/**
 * One major-release candidate from discoverIndustryReleases - the industry-wide sweep that finds
 * notable album/EP/compilation releases across the whole music industry (not just watched-artists.txt)
 * for the Friday NEW MUSIC FRIDAY roundup. Deliberately not tied to a watchedArtistId, unlike
 * MusicNewsCandidate.
 */
export interface IndustryReleaseCandidate {
  artistName: string;
  releaseFormat: RoundupReleaseFormat;
  headline: string;
  summary: string;
  eventTimeIso: string | null;
  eventTimeConfidence: "exact" | "approximate" | "unknown";
  sources: ReportedSource[];
}

/** Output of verifyIndustryReleases: an industry-wide release candidate that survived independent re-research with the 2-source rule applied. */
export interface VerifiedIndustryRelease {
  artistName: string;
  releaseFormat: RoundupReleaseFormat;
  headline: string;
  facts: VerifiedFact[];
  meetsSourceBar: boolean;
}

/** One post in the edition - text has already been checked against the Bluesky grapheme limit by the time this exists. */
export interface DraftPost {
  text: string;
  /** Which music_item id(s) this post is about, so they can be marked posted_in_run_id on success. Always exactly one item per post in practice - kept as an array for symmetry with the copy-edit/fact-check stages, which operate on posts generically. */
  sourceItemIds: number[];
  /**
   * Optional rich-text link facet(s) - currently only ever set by the
   * mechanical single-post path (see spotify/lookupTrack.ts), never by
   * the writer/copy-edit path. Only applied when this draft survives as
   * a single physical post (see toPhysicalItems in publishMusicItems.ts)
   * - a facet's byte offsets are only valid against the exact text they
   * were computed from, so one that got split across a reply-chain would
   * be silently wrong rather than just missing.
   */
  facets?: LinkFacet[];
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

/** One raw candidate surfaced by discoverMusicHistory, before independent verification - "on this day in music history" for today's calendar date (any year). */
export interface HistoryFactCandidate {
  year: number;
  /** A short, factual description of what happened, e.g. "Fleetwood Mac releases Rumours" - no editorializing. */
  eventDescription: string;
  sources: ReportedSource[];
}

/** Output of verifyMusicHistory: a historical candidate that survived independent re-research with the 2-source rule applied. */
export interface VerifiedHistoryFact {
  year: number;
  eventDescription: string;
  facts: VerifiedFact[];
  meetsSourceBar: boolean;
}

/**
 * One raw birth-date candidate surfaced by discoverBirthDates, before independent verification. Only
 * ever produced for a watchlist entry that's an individual person - a band/group is skipped outright at
 * discovery (a group has a formation date, not a birthday).
 */
export interface BirthDateCandidate {
  watchedArtistId: number;
  artistName: string;
  birthYear: number | null;
  birthMonth: number | null;
  birthDay: number | null;
  sources: ReportedSource[];
}

/** Output of verifyBirthDates: a birth-date candidate independently re-confirmed with the 2-source rule. birthMonth/birthDay are always present when meetsSourceBar is true; birthYear may still be null if only the month/day could be confirmed. */
export interface VerifiedBirthDate {
  watchedArtistId: number;
  artistName: string;
  birthMonth: number | null;
  birthDay: number | null;
  birthYear: number | null;
  facts: VerifiedFact[];
  meetsSourceBar: boolean;
}

/**
 * One raw upcoming-show candidate surfaced by discoverShows, before independent verification - scoped
 * to Portland, Oregon and the broader Pacific Northwest, and to any artist (not just watched-artists.txt),
 * for the weekly SHOWS post.
 */
export interface ShowCandidate {
  artistName: string;
  venueName: string | null;
  eventDateIso: string | null;
  eventDateConfidence: "exact" | "approximate" | "unknown";
  sources: ReportedSource[];
}

/** Output of verifyShows: a show candidate independently re-confirmed with the 2-source rule - eventDateIso/eventDateConfidence come from the verified fact, not discovery's initial guess. */
export interface VerifiedShow {
  artistName: string;
  venueName: string | null;
  eventDateIso: string;
  facts: VerifiedFact[];
  meetsSourceBar: boolean;
}
