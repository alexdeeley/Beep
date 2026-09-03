import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeOpenAIClient, MissingApiKeyError } from "../utils/openaiClient.js";
import { RunLogger } from "../utils/logger.js";
import type { AppConfig } from "../config/index.js";
import { loadEditorialFocus } from "./editorialFocus.js";
import { downloadStoryDb, uploadStoryDb } from "./db/sync.js";
import { openStoryDb, closeStoryDb } from "./db/connection.js";
import { startHourlyRun, finishHourlyRun } from "./db/researchRunsRepo.js";
import { archiveStaleStories } from "./db/storiesRepo.js";
import { discoverCandidates } from "./discovery/discoverCandidates.js";
import { clusterCandidates } from "./clustering/clusterCandidates.js";
import { verifyClusters } from "./verification/verifyClusters.js";
import { updateStoryMemory } from "./storyMemory/updateStoryMemory.js";
import { rankStories, type RankableItem } from "./ranking/rankStories.js";
import { buildConnections } from "./connections/findConnections.js";
import { resolveQuietHoursOutcome } from "./quietHours/quietHoursPolicy.js";
import { writeEdition } from "./writing/writeEdition.js";
import type { WritingItem } from "./writing/prompts.js";
import { copyEditEdition } from "./copyEdit/copyEditEdition.js";
import { factCheckEdition } from "./factCheck/factCheckEdition.js";
import { duplicateCheckEdition } from "./duplicateCheck/duplicateCheckEdition.js";
import { publishThread } from "./publishing/publishThread.js";
import type { NewsRunContext } from "./runContext.js";
import type { DraftEdition } from "./types.js";

export interface NewswireCycleOptions {
  /** True for `news:preview` - runs every stage for real but never publishes and never persists DB changes back to R2. */
  dryRun: boolean;
  /** Bypasses quiet-hours silence, for manual testing (`news:publish --force`). */
  forceRun?: boolean;
}

export interface NewswireCycleSummary {
  hourlyRunId: number;
  quietHoursOutcome: string;
  publishedPostCount: number;
  publishStatus: "published" | "skipped" | "failed" | "dry_run";
  editionPreview: { text: string }[] | null;
}

/** Archive stories untouched for this many days - "archive, don't delete" per the long-term-memory requirement. */
const STALE_STORY_DAYS = 30;

/** Cap on how many top-ranked items get carried into connection-finding/writing, regardless of maxPostsPerEdition - the writer decides the final cut, this just bounds cost. */
const MAX_ELIGIBLE_ITEMS = 12;

function silentResult(
  db: ReturnType<typeof openStoryDb>,
  hourlyRunId: number,
  quietHoursOutcome: string,
  candidatesFound: number,
  candidatesRejected: number
): NewswireCycleSummary {
  finishHourlyRun(db, hourlyRunId, {
    status: "silent",
    quiet_hours_outcome: quietHoursOutcome as "normal" | "slow" | "silent",
    candidates_found: candidatesFound,
    candidates_rejected: candidatesRejected,
    publish_status: "skipped",
  });
  return {
    hourlyRunId,
    quietHoursOutcome,
    publishedPostCount: 0,
    publishStatus: "skipped",
    editionPreview: null,
  };
}

/**
 * The hourly master orchestrator:
 *   download DB from R2 -> discover -> cluster -> verify -> story-memory ->
 *   rank -> quiet-hours check -> connections -> write -> copy-edit ->
 *   fact-check (mandatory gate) -> duplicate-check -> publish -> upload DB.
 *
 * The DB is always closed and (outside dry-run) uploaded back to R2 in a
 * finally block, even on failure - the audit trail must survive a failed
 * run, and a preview run must never leave any trace in the shared state.
 */
export async function runNewswireCycle(config: AppConfig, options: NewswireCycleOptions): Promise<NewswireCycleSummary> {
  const runDir = join(config.paths.runsDir, "news", new Date().toISOString().replace(/[:.]/g, "-"));
  const logger = new RunLogger(runDir);

  const openai = makeOpenAIClient(config);
  if (!openai) throw new MissingApiKeyError("newswire-cycle");

  const editorialFocus = loadEditorialFocus(config.news.editorialFocusPath);

  const tempDir = mkdtempSync(join(tmpdir(), "newswire-db-"));
  const dbPath = join(tempDir, "story.db");
  const handle = await downloadStoryDb(config, logger, dbPath);
  const db = openStoryDb(dbPath);

  try {
    const hourlyRun = startHourlyRun(db, options.dryRun);
    const now = new Date();
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

    logger.info("orchestrator", `Starting newswire cycle ${hourlyRun.id}`, { dryRun: options.dryRun, forceRun: options.forceRun });

    archiveStaleStories(db, STALE_STORY_DAYS);

    const candidates = await discoverCandidates(ctx);
    const clusters = await clusterCandidates(ctx, candidates);
    const verified = await verifyClusters(ctx, clusters);
    const candidatesRejected = candidates.length - verified.length;

    const rankableItems: RankableItem[] = [];
    for (const cluster of verified) {
      const outcome = await updateStoryMemory(ctx, cluster);
      rankableItems.push({
        cluster,
        decision: outcome.decision,
        newEventIds: outcome.newEventIds,
        newEventFacts: outcome.newEventFacts,
      });
    }

    const ranked = rankStories(ctx, rankableItems);
    const topScore = ranked[0]?.importanceScore ?? null;
    const quietDecision = resolveQuietHoursOutcome(editorialFocus, now, topScore);
    const effectiveOutcome = options.forceRun ? "normal" : quietDecision.outcome;
    const minScore = options.forceRun ? 0 : quietDecision.minImportanceScore;

    logger.info(
      "orchestrator",
      `Quiet-hours outcome: ${effectiveOutcome} (local hour ${quietDecision.localHour}, min importance score ${minScore})`
    );

    if (effectiveOutcome === "silent" || ranked.length === 0) {
      logger.info("orchestrator", "Staying silent this hour - nothing clears the bar, which is expected and healthy");
      return silentResult(db, hourlyRun.id, quietDecision.outcome, candidates.length, candidatesRejected);
    }

    const eligible = ranked.filter((r) => r.importanceScore >= minScore).slice(0, MAX_ELIGIBLE_ITEMS);
    if (eligible.length === 0) {
      return silentResult(db, hourlyRun.id, quietDecision.outcome, candidates.length, candidatesRejected);
    }

    const connectionsByStory = await buildConnections(ctx, eligible);
    const writingItems: WritingItem[] = eligible.map((r) => ({
      ranked: r,
      facts: r.facts,
      isNewStory: r.isNewStory,
      connections: connectionsByStory.get(r.storyId) ?? [],
    }));

    let edition: DraftEdition = await writeEdition(ctx, writingItems);
    const copyEdited = await copyEditEdition(ctx, edition);
    edition = copyEdited.edition;

    const factCheck = await factCheckEdition(ctx, edition, writingItems);
    if (!factCheck.allMaterialClaimsSupported) {
      logger.error("orchestrator", "Fact-check gate blocked publishing - one or more claims did not come back SUPPORTED", {
        claims: factCheck.claims,
      });
      finishHourlyRun(db, hourlyRun.id, {
        status: "failed",
        quiet_hours_outcome: quietDecision.outcome,
        candidates_found: candidates.length,
        candidates_rejected: candidatesRejected,
        final_edition_json: JSON.stringify(edition),
        publish_status: "failed",
        error_message: "fact-check gate: not all material claims SUPPORTED",
      });
      return {
        hourlyRunId: hourlyRun.id,
        quietHoursOutcome: quietDecision.outcome,
        publishedPostCount: 0,
        publishStatus: "failed",
        editionPreview: edition?.posts.map((p) => ({ text: p.text })) ?? null,
      };
    }

    const dupeCheck = duplicateCheckEdition(ctx, edition);
    if (dupeCheck.isDuplicate) {
      logger.warn("orchestrator", `Duplicate-check blocked publishing: ${dupeCheck.reason}`);
      finishHourlyRun(db, hourlyRun.id, {
        status: "success",
        quiet_hours_outcome: quietDecision.outcome,
        candidates_found: candidates.length,
        candidates_rejected: candidatesRejected,
        final_edition_json: JSON.stringify(edition),
        publish_status: "skipped",
        error_message: dupeCheck.reason,
      });
      return {
        hourlyRunId: hourlyRun.id,
        quietHoursOutcome: quietDecision.outcome,
        publishedPostCount: 0,
        publishStatus: "skipped",
        editionPreview: edition?.posts.map((p) => ({ text: p.text })) ?? null,
      };
    }

    const publishResult = await publishThread(ctx, edition);
    const publishStatus: NewswireCycleSummary["publishStatus"] = options.dryRun
      ? "dry_run"
      : publishResult.posts.length > 0
        ? "published"
        : "failed";

    finishHourlyRun(db, hourlyRun.id, {
      status: "success",
      quiet_hours_outcome: quietDecision.outcome,
      candidates_found: candidates.length,
      candidates_rejected: candidatesRejected,
      final_edition_json: JSON.stringify(edition),
      publish_status: publishStatus,
    });

    logger.info("orchestrator", `Newswire cycle ${hourlyRun.id} complete`, {
      publishedPosts: publishResult.posts.length,
      dryRun: options.dryRun,
    });

    return {
      hourlyRunId: hourlyRun.id,
      quietHoursOutcome: quietDecision.outcome,
      publishedPostCount: publishResult.posts.length,
      publishStatus,
      editionPreview: edition?.posts.map((p) => ({ text: p.text })) ?? null,
    };
  } finally {
    closeStoryDb(db);
    if (!options.dryRun) {
      await uploadStoryDb(handle, logger, dbPath);
    } else {
      logger.info("orchestrator", "Dry run (news:preview): not persisting story database changes back to R2");
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}
