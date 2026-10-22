import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeOpenAIClient, MissingApiKeyError } from "../utils/openaiClient.js";
import { RunLogger } from "../utils/logger.js";
import type { AppConfig } from "../config/index.js";
import { loadEditorialFocus } from "./editorialFocus.js";
import { downloadStoryDb, uploadStoryDb } from "./db/sync.js";
import { openStoryDb, closeStoryDb } from "./db/connection.js";
import { startHourlyRun, finishHourlyRun } from "./db/researchRunsRepo.js";
import { postClassicPoster } from "./festivalPosters/postClassicPoster.js";
import type { NewsRunContext } from "./runContext.js";

export interface ClassicPosterCycleOptions {
  /** True for `news:classic-preview` - runs every stage for real but never publishes and never persists DB changes back to R2. */
  dryRun: boolean;
}

export interface ClassicPosterCycleSummary {
  hourlyRunId: number;
  publishStatus: "published" | "skipped" | "dry_run";
  publishedPostCount: number;
}

/**
 * Classic Poster: one cycle = one search for a single real, famous piece of music graphic design (poster,
 * album cover, or single sleeve) from any past year, chosen for color/typography/simplicity as design,
 * independent verification of its attribution, and a real image repost if it clears the bar. Runs once a
 * day (see .github/workflows/news.yml's dedicated cron). Separate entry point from runNewswireCycle.ts
 * (which only ever looks for current-week announcements) but an identical DB-download/open/finally-upload
 * shape - see festivalPosters/postClassicPoster.ts for the actual discovery/verification/posting logic.
 */
export async function runClassicPosterCycle(config: AppConfig, options: ClassicPosterCycleOptions): Promise<ClassicPosterCycleSummary> {
  const runDir = join(config.paths.runsDir, "news", `classic-poster-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const logger = new RunLogger(runDir);

  const editorialFocus = loadEditorialFocus(config.news.editorialFocusPath);
  const now = new Date();

  const openai = makeOpenAIClient(config);
  if (!openai) throw new MissingApiKeyError("classic-poster-cycle");

  const tempDir = mkdtempSync(join(tmpdir(), "newswire-db-"));
  const dbPath = join(tempDir, "story.db");
  const handle = await downloadStoryDb(config, logger, dbPath);
  const db = openStoryDb(dbPath);

  try {
    const hourlyRun = startHourlyRun(db, options.dryRun);
    const ctx: NewsRunContext = {
      config,
      logger,
      db,
      openai,
      editorialFocus,
      hourlyRunId: hourlyRun.id,
      dryRun: options.dryRun,
      now,
    };

    logger.info("orchestrator", `Starting classic poster cycle ${hourlyRun.id}`, { dryRun: options.dryRun });

    const publishedPostCount = await postClassicPoster(ctx);
    const publishStatus: ClassicPosterCycleSummary["publishStatus"] = options.dryRun
      ? "dry_run"
      : publishedPostCount > 0
        ? "published"
        : "skipped";

    finishHourlyRun(db, hourlyRun.id, {
      status: "success",
      quiet_hours_outcome: null,
      candidates_found: 0,
      candidates_rejected: 0,
      publish_status: publishStatus,
    });

    logger.info("orchestrator", `Classic poster cycle ${hourlyRun.id} complete`, { publishedPosts: publishedPostCount, dryRun: options.dryRun });

    return { hourlyRunId: hourlyRun.id, publishStatus, publishedPostCount };
  } finally {
    closeStoryDb(db);
    if (!options.dryRun) {
      await uploadStoryDb(handle, logger, dbPath);
    } else {
      logger.info("orchestrator", "Dry run (news:classic-preview): not persisting story database changes back to R2");
    }
  }
}
