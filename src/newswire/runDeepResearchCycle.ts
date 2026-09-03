import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeOpenAIClient, MissingApiKeyError } from "../utils/openaiClient.js";
import { RunLogger } from "../utils/logger.js";
import type { AppConfig } from "../config/index.js";
import { loadEditorialFocus } from "./editorialFocus.js";
import { downloadStoryDb, uploadStoryDb } from "./db/sync.js";
import { openStoryDb, closeStoryDb } from "./db/connection.js";
import { runDeepResearch } from "./dailyDeepResearch/runDeepResearch.js";
import { startHourlyRun } from "./db/researchRunsRepo.js";
import type { NewsRunContext } from "./runContext.js";

/**
 * The once-daily broad-context orchestrator. Shares the same R2-hosted
 * story database and the same GitHub Actions concurrency group as the
 * hourly cycle (see .github/workflows/news-deep-research.yml), so the
 * two can never race each other's download/upload.
 */
export async function runDeepResearchCycle(config: AppConfig, options: { dryRun: boolean }): Promise<{ contextBlob: string | null }> {
  const runDir = join(config.paths.runsDir, "news-deep-research", new Date().toISOString().replace(/[:.]/g, "-"));
  const logger = new RunLogger(runDir);

  const openai = makeOpenAIClient(config);
  if (!openai) throw new MissingApiKeyError("deep-research-cycle");

  const editorialFocus = loadEditorialFocus(config.news.editorialFocusPath);

  const tempDir = mkdtempSync(join(tmpdir(), "newswire-deepresearch-db-"));
  const dbPath = join(tempDir, "story.db");
  const handle = await downloadStoryDb(config, logger, dbPath);
  const db = openStoryDb(dbPath);

  try {
    // Reuses hourly_runs purely as a lightweight audit anchor (dry_run flag, timestamps) - the actual
    // deep-research record lives in deep_research_runs, tracked separately by runDeepResearch itself.
    const run = startHourlyRun(db, options.dryRun);
    const ctx: NewsRunContext = {
      config,
      logger,
      db,
      openai,
      editorialFocus,
      hourlyRunId: run.id,
      dryRun: options.dryRun,
      now: new Date(),
    };

    const contextBlob = await runDeepResearch(ctx);
    return { contextBlob };
  } finally {
    closeStoryDb(db);
    if (!options.dryRun) {
      await uploadStoryDb(handle, logger, dbPath);
    } else {
      logger.info("orchestrator", "Dry run: not persisting story database changes back to R2");
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}
