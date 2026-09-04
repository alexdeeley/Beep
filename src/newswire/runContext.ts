import type Database from "better-sqlite3";
import type OpenAI from "openai";
import type { AppConfig } from "../config/index.js";
import type { RunLogger } from "../utils/logger.js";
import type { EditorialFocus } from "./editorialFocus.js";

/**
 * Everything a pipeline stage needs, threaded through every stage
 * function - mirrors runDaily.ts's RunContext pattern. `dryRun` gates
 * both Bluesky publishing (threadPublish.ts) and DB persistence back to
 * R2 (runNewswireCycle.ts), never the stages' own logic - a preview run
 * still exercises every stage for real so its report is trustworthy.
 */
export interface NewsRunContext {
  config: AppConfig;
  logger: RunLogger;
  db: Database.Database;
  openai: OpenAI;
  editorialFocus: EditorialFocus;
  hourlyRunId: number;
  dryRun: boolean;
  now: Date;
}
