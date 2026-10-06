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
import { postFestivalPosters } from "./festivalPosters/postFestivalPosters.js";
import type { NewsRunContext } from "./runContext.js";

export interface NewswireCycleOptions {
  /** True for `news:preview` - runs every stage for real but never publishes and never persists DB changes back to R2. */
  dryRun: boolean;
}

export interface NewswireCycleSummary {
  hourlyRunId: number;
  publishStatus: "published" | "skipped" | "dry_run";
  publishedPostCount: number;
}

/**
 * The festival-poster finder: one cycle = one search for major music festivals (anywhere in the world)
 * that have just announced their lineup/poster, independent 2-source verification, and a real image
 * post for each one that clears the bar. This is the pipeline's only job - see
 * festivalPosters/postFestivalPosters.ts for the actual discovery/verification/posting logic.
 *
 * The DB is always closed and (outside dry-run) uploaded back to R2 in a finally block, even on
 * failure - the audit trail must survive a failed run, and a preview run must never leave any trace in
 * the shared state.
 */
export async function runNewswireCycle(config: AppConfig, options: NewswireCycleOptions): Promise<NewswireCycleSummary> {
  const runDir = join(config.paths.runsDir, "news", new Date().toISOString().replace(/[:.]/g, "-"));
  const logger = new RunLogger(runDir);

  const editorialFocus = loadEditorialFocus(config.news.editorialFocusPath);
  const now = new Date();

  const openai = makeOpenAIClient(config);
  if (!openai) throw new MissingApiKeyError("newswire-cycle");

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

    logger.info("orchestrator", `Starting newswire cycle ${hourlyRun.id}`, { dryRun: options.dryRun });

    const publishedPostCount = await postFestivalPosters(ctx);
    const publishStatus: NewswireCycleSummary["publishStatus"] = options.dryRun
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

    logger.info("orchestrator", `Newswire cycle ${hourlyRun.id} complete`, { publishedPosts: publishedPostCount, dryRun: options.dryRun });

    return { hourlyRunId: hourlyRun.id, publishStatus, publishedPostCount };
  } finally {
    closeStoryDb(db);
    if (!options.dryRun) {
      await uploadStoryDb(handle, logger, dbPath);
    } else {
      logger.info("orchestrator", "Dry run (news:preview): not persisting story database changes back to R2");
    }
  }
}
