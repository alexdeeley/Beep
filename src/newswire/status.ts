import type Database from "better-sqlite3";
import { getOpenStories } from "./db/storiesRepo.js";
import { getRecentPosts } from "./db/postsRepo.js";
import { getLastHourlyRun, getLatestDeepResearchRun, getRecentHourlyRuns } from "./db/researchRunsRepo.js";

export interface NewswireStatus {
  lastRun: {
    id: number;
    startedAt: string;
    finishedAt: string | null;
    status: string;
    quietHoursOutcome: string | null;
    publishStatus: string | null;
  } | null;
  openStoryCount: number;
  latestPosts: { text: string; createdAt: string; uri: string | null }[];
  recentFailures: { id: number; startedAt: string; errorMessage: string | null }[];
  latestDeepResearchAt: string | null;
}

/** Read-only summary against an already-open (or freshly-downloaded, read-only) story DB - the data behind `news:status`. */
export function getNewswireStatus(db: Database.Database): NewswireStatus {
  const lastRun = getLastHourlyRun(db);
  const openStories = getOpenStories(db);
  const recentPosts = getRecentPosts(db, 5);
  const recentRuns = getRecentHourlyRuns(db, 20);
  const deepResearch = getLatestDeepResearchRun(db);

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
    openStoryCount: openStories.length,
    latestPosts: recentPosts.map((p) => ({ text: p.text, createdAt: p.created_at, uri: p.uri })),
    recentFailures: recentRuns
      .filter((r) => r.status === "failed")
      .map((r) => ({ id: r.id, startedAt: r.started_at, errorMessage: r.error_message })),
    latestDeepResearchAt: deepResearch?.finished_at ?? null,
  };
}
