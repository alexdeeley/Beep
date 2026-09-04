import type { UnpostedReleaseRow } from "../db/releasesRepo.js";

export interface RankedRelease {
  release: UnpostedReleaseRow;
  /** Spotify popularity (0-100) normalized to 0-1, used only to gate quiet-hours caution - never to reorder the FIFO queue. */
  importanceScore: number;
}

/**
 * Orders this cycle's candidate pool FIFO (oldest-discovered-first, as
 * `getUnpostedReleases` already returns it) and caps it to
 * maxPostsPerEdition. Deliberately NOT popularity-ordered - a release
 * from a smaller artist discovered three days ago should never be
 * starved indefinitely behind a stream of newer releases from more
 * popular artists. Popularity still feeds `importanceScore` so the
 * quiet-hours policy can decide whether an unusually notable release
 * justifies breaking a slow window, but it never changes queue order.
 */
export function rankReleases(releases: UnpostedReleaseRow[], maxPerEdition: number): RankedRelease[] {
  return releases.slice(0, maxPerEdition).map((release) => ({
    release,
    importanceScore: Math.max(0, Math.min(1, (release.artist_popularity ?? 0) / 100)),
  }));
}
