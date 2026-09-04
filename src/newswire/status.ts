import type Database from "better-sqlite3";
import { getRecentPosts } from "./db/postsRepo.js";
import { getLastHourlyRun, getRecentHourlyRuns } from "./db/researchRunsRepo.js";
import { getArtistResolutionCounts } from "./db/watchedArtistsRepo.js";
import { getRecentlyPostedReleases, getUnpostedReleases } from "./db/releasesRepo.js";

export interface NewswireStatus {
  lastRun: {
    id: number;
    startedAt: string;
    finishedAt: string | null;
    status: string;
    quietHoursOutcome: string | null;
    publishStatus: string | null;
  } | null;
  artistResolution: { pending: number; resolved: number; unresolved: number };
  unpostedReleaseCount: number;
  recentReleases: { artistName: string; title: string; releaseDate: string; releaseType: string }[];
  latestPosts: { text: string; createdAt: string; uri: string | null }[];
  recentFailures: { id: number; startedAt: string; errorMessage: string | null }[];
}

/** Read-only summary against an already-open (or freshly-downloaded, read-only) story DB - the data behind `news:status`. */
export function getNewswireStatus(db: Database.Database): NewswireStatus {
  const lastRun = getLastHourlyRun(db);
  const recentPosts = getRecentPosts(db, 5);
  const recentRuns = getRecentHourlyRuns(db, 20);
  const artistResolution = getArtistResolutionCounts(db);
  const unposted = getUnpostedReleases(db);
  const recentReleases = getRecentlyPostedReleases(db, 5);

  return {
    lastRun: lastRun
      ? {
          id: lastRun.id,
          startedAt: lastRun.started_at,
          finishedAt: lastRun.finished_at,
          status: lastRun.status,
          quietHoursOutcome: lastRun.quiet_hours_outcome,
          publishStatus: lastRun.publish_status,
        }
      : null,
    artistResolution,
    unpostedReleaseCount: unposted.length,
    recentReleases: recentReleases.map((r) => ({
      artistName: r.artist_name,
      title: r.title,
      releaseDate: r.release_date,
      releaseType: r.release_type,
    })),
    latestPosts: recentPosts.map((p) => ({ text: p.text, createdAt: p.created_at, uri: p.uri })),
    recentFailures: recentRuns
      .filter((r) => r.status === "failed")
      .map((r) => ({ id: r.id, startedAt: r.started_at, errorMessage: r.error_message })),
  };
}
