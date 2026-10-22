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
 * One raw candidate surfaced by discoverFestivalPosters, before independent verification - a notable
 * music event that has JUST announced its poster, anywhere in the world (LLM-judged "notable" -
 * internationally/nationally recognized artists, tours, and festivals only, not local shows). Despite the
 * type/field names (kept for historical reasons - this started as a festival-only pipeline), this is NOT
 * restricted to festivals: an individual artist's tour, a one-off gig, or a residency is an equally valid
 * candidate - see discovery/festivalPostersPrompts.ts. `festivalName` holds the festival OR artist/tour
 * name either way. eventYear is the event's own edition/tour year (e.g. 2027 for "Coachella 2027"), used
 * as part of the dedup key alongside festivalName so next year's poster for the same event isn't treated
 * as a duplicate.
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
 * Output of verifyFestivalPosters: a candidate independently re-confirmed with the 2-source rule. `blurb`
 * is verification's own short caption (never discovery's wording), and `primarySourceUrl` is
 * verification's own most-authoritative source for the announcement (the event's or artist's own official
 * page preferred) - festivalPosters/extractPosterImage.ts fetches THIS specific URL's og:image to get the
 * real poster image, never an LLM-reported image URL (which could be hallucinated).
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

/**
 * One raw candidate surfaced by discoverClassicPoster - a single real, famous piece of music graphic
 * design (poster, album cover, or single sleeve) from ANY past year, chosen for its merit as design
 * (color/typography/simplicity) rather than news value (deliberately the opposite of
 * FestivalPosterCandidate's "just announced" framing - there is no freshness requirement here, and in
 * fact the whole point is that it's old). eventYear is required (not nullable) since a classic-poster post
 * is meaningless without knowing which year the work is from.
 */
export interface ClassicPosterCandidate {
  festivalName: string;
  eventYear: number;
  whyNotable: string;
  sources: ReportedSource[];
}

/**
 * Output of verifyClassicPoster: a classic-poster candidate independently re-confirmed (the work's
 * attribution is genuine and the notable design fact is real) via the same 2-source rule, but with no
 * freshness/staleness check and no requirement that the artwork itself display a date/venue/location -
 * unlike VerifiedFestivalPoster, old and text-minimal are both fine here; this is shown as design history,
 * not an event listing. `primarySourceUrl` is the single best page to mechanically extract the actual
 * artwork image from (an archive, retrospective article, or the artist's/label's own site).
 */
export interface VerifiedClassicPoster {
  festivalName: string;
  eventYear: number;
  blurb: string | null;
  lineupArtists: string[];
  primarySourceUrl: string | null;
  meetsSourceBar: boolean;
}
