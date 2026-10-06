/** A single "here's a URL I found via web search" claim from the model - unverified until an independent stage re-checks it. */
export interface ReportedSource {
  url: string;
  title: string;
  domain: string;
}

export type FactLabel = "FACT" | "ANALYSIS" | "UNCONFIRMED" | "BACKGROUND" | "PREDICTION";

export interface VerifiedFact {
  claim: string;
  factLabel: FactLabel;
  eventTimeIso: string | null;
  eventTimeConfidence: "exact" | "approximate" | "unknown";
  articlePublishedAtIso: string | null;
  sources: (ReportedSource & { sourceTier: string; isPrimary: boolean })[];
}

/**
 * One raw candidate surfaced by discoverFestivalPosters, before independent verification - a major
 * music festival that has JUST announced its lineup/poster, anywhere in the world (LLM-judged "major" -
 * internationally/nationally recognized festivals only, not local shows). eventYear is the festival's
 * own edition year (e.g. 2027 for "Coachella 2027"), used as part of the dedup key alongside
 * festivalName so next year's poster for the same festival isn't treated as a duplicate.
 */
export interface FestivalPosterCandidate {
  festivalName: string;
  eventYear: number | null;
  headline: string;
  eventTimeIso: string | null;
  eventTimeConfidence: "exact" | "approximate" | "unknown";
  sources: ReportedSource[];
}

/**
 * Output of verifyFestivalPosters: a festival-poster candidate independently re-confirmed with the
 * 2-source rule. `blurb` is verification's own short caption (never discovery's wording), and
 * `primarySourceUrl` is verification's own most-authoritative source for the announcement (an official
 * festival page preferred) - festivalPosters/extractPosterImage.ts fetches THIS specific URL's og:image
 * to get the real poster image, never an LLM-reported image URL (which could be hallucinated).
 */
export interface VerifiedFestivalPoster {
  festivalName: string;
  eventYear: number | null;
  headline: string;
  blurb: string | null;
  /** Lineup/headliner artist names verification's own independent search actually confirmed - empty if none could be confirmed. Never discovery's (unverified) claims. */
  lineupArtists: string[];
  primarySourceUrl: string | null;
  facts: VerifiedFact[];
  meetsSourceBar: boolean;
}
