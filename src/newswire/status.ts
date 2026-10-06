import type Database from "better-sqlite3";
import { getRecentPosts } from "./db/postsRepo.js";
import { getLastHourlyRun, getRecentHourlyRuns } from "./db/researchRunsRepo.js";
import { getFestivalPosterCount, getRecentFestivalPosterPosts } from "./db/festivalPostersRepo.js";

export interface NewswireStatus {
  lastRun: {
    id: number;
    startedAt: string;
    finishedAt: string | null;
    status: string;
    publishStatus: string | null;
  } | null;
  /** Total festival posters ever posted (all time). */
  totalFestivalPostersPosted: number;
  recentFestivalPosters: { festivalName: string; postedAt: string }[];
  latestPosts: { text: string; createdAt: string; uri: string | null }[];
  recentFailures: { id: number; startedAt: string; errorMessage: string | null }[];
}

/** Read-only summary against an already-open (or freshly-downloaded, read-only) story DB - the data behind `news:status`. */
export function getNewswireStatus(db: Database.Database): NewswireStatus {
  const lastRun = getLastHourlyRun(db);
  const recentPosts = getRecentPosts(db, 5);
  const recentRuns = getRecentHourlyRuns(db, 20);
  const totalFestivalPostersPosted = getFestivalPosterCount(db);
  const recentFestivalPosters = getRecentFestivalPosterPosts(db, 5);

  return {
    lastRun: lastRun
      ? {
          id: lastRun.id,
          startedAt: lastRun.started_at,
          finishedAt: lastRun.finished_at,
          status: lastRun.status,
          publishStatus: lastRun.publish_status,
        }
      : null,
    totalFestivalPostersPosted,
    recentFestivalPosters: recentFestivalPosters.map((p) => ({ festivalName: p.festival_name, postedAt: p.created_at })),
    latestPosts: recentPosts.map((p) => ({ text: p.text, createdAt: p.created_at, uri: p.uri })),
    recentFailures: recentRuns
      .filter((r) => r.status === "failed")
      .map((r) => ({ id: r.id, startedAt: r.started_at, errorMessage: r.error_message })),
  };
}
