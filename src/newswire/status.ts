import type Database from "better-sqlite3";
import { getRecentPosts } from "./db/postsRepo.js";
import { getLastHourlyRun, getRecentHourlyRuns } from "./db/researchRunsRepo.js";
import { getWatchedArtistCount } from "./db/watchedArtistsRepo.js";
import { getRecentlyPostedMusicItems, getUnpostedIndividualItems, getUnpostedAlbumItems } from "./db/musicItemsRepo.js";
import { getUnpostedIndustryReleaseItems } from "./db/industryReleaseItemsRepo.js";
import { getLastRoundupRun } from "./db/weeklyRoundupRepo.js";

export interface NewswireStatus {
  lastRun: {
    id: number;
    startedAt: string;
    finishedAt: string | null;
    status: string;
    quietHoursOutcome: string | null;
    publishStatus: string | null;
  } | null;
  watchedArtistCount: number;
  unpostedItemCount: number;
  /** Watchlist album/EP/compilation releases accumulated and waiting for the next Friday WEEKLY NEW RELEASES roundup. */
  albumsQueuedForRoundup: number;
  /** Industry-wide (non-watchlist) major releases discovered so far and waiting for the next roundup - only populated after a Friday sweep has run. */
  industryReleasesQueuedForRoundup: number;
  lastRoundup: { date: string; itemCount: number } | null;
  recentItems: { artistName: string; headline: string; itemType: string }[];
  latestPosts: { text: string; createdAt: string; uri: string | null }[];
  recentFailures: { id: number; startedAt: string; errorMessage: string | null }[];
}

/** Read-only summary against an already-open (or freshly-downloaded, read-only) story DB - the data behind `news:status`. */
export function getNewswireStatus(db: Database.Database): NewswireStatus {
  const lastRun = getLastHourlyRun(db);
  const recentPosts = getRecentPosts(db, 5);
  const recentRuns = getRecentHourlyRuns(db, 20);
  const watchedArtistCount = getWatchedArtistCount(db);
  const unposted = getUnpostedIndividualItems(db);
  const queuedAlbums = getUnpostedAlbumItems(db);
  const queuedIndustryReleases = getUnpostedIndustryReleaseItems(db);
  const recentItems = getRecentlyPostedMusicItems(db, 5);
  const lastRoundup = getLastRoundupRun(db);

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
    watchedArtistCount,
    unpostedItemCount: unposted.length,
    albumsQueuedForRoundup: queuedAlbums.length,
    industryReleasesQueuedForRoundup: queuedIndustryReleases.length,
    lastRoundup: lastRoundup ? { date: lastRoundup.roundup_date, itemCount: lastRoundup.item_count } : null,
    recentItems: recentItems.map((r) => ({ artistName: r.artist_name, headline: r.headline, itemType: r.item_type })),
    latestPosts: recentPosts.map((p) => ({ text: p.text, createdAt: p.created_at, uri: p.uri })),
    recentFailures: recentRuns
      .filter((r) => r.status === "failed")
      .map((r) => ({ id: r.id, startedAt: r.started_at, errorMessage: r.error_message })),
  };
}
