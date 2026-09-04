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
import { getUnpostedIndividualItems, insertMusicItem } from "./db/musicItemsRepo.js";
import { importArtistList } from "./artists/importArtistList.js";
import { getArtistsDueForCheck, markArtistsChecked } from "./db/watchedArtistsRepo.js";
import { discoverArtistNews } from "./discovery/discoverArtistNews.js";
import { verifyArtistNews } from "./verification/verifyArtistNews.js";
import { rankMusicItems, type RankedMusicItem } from "./ranking/rankMusicItems.js";
import { resolveQuietHoursOutcome } from "./quietHours/quietHoursPolicy.js";
import { writeEdition } from "./writing/writeEdition.js";
import type { WritingItem } from "./writing/prompts.js";
import { copyEditEdition } from "./copyEdit/copyEditEdition.js";
import { factCheckEdition } from "./factCheck/factCheckEdition.js";
import { duplicateCheckEdition } from "./duplicateCheck/duplicateCheckEdition.js";
import { publishMusicItems } from "./publishing/publishMusicItems.js";
import { postWeeklyRoundup } from "./weeklyRoundup/postWeeklyRoundup.js";
import type { NewsRunContext } from "./runContext.js";
import type { DraftEdition, VerifiedMusicItem } from "./types.js";

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

/** Cap on how many unposted items get carried into writing, regardless of maxPostsPerEdition - this just bounds cost; the writer/quiet-hours filter decide the final cut. */
const MAX_ELIGIBLE_ITEMS = 12;

function silentResult(hourlyRunId: number, quietHoursOutcome: string, candidatesFound: number, candidatesRejected: number, db: ReturnType<typeof openStoryDb>): NewswireCycleSummary {
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

/** Persists a verified candidate as a music_items row, using the first fact's timing/label and every distinct source across all facts. */
function persistVerifiedItem(ctx: NewsRunContext, verified: VerifiedMusicItem): number | null {
  const primaryFact = verified.facts.find((f) => f.sources.some((s) => s.isPrimary)) ?? verified.facts[0];
  if (!primaryFact) return null;
  const primarySource = primaryFact.sources.find((s) => s.isPrimary) ?? primaryFact.sources[0];
  if (!primarySource) return null;

  const domains = new Set<string>();
  for (const fact of verified.facts) for (const s of fact.sources) domains.add(s.domain.toLowerCase());

  const row = insertMusicItem(ctx.db, {
    watchedArtistId: verified.watchedArtistId,
    itemType: verified.itemType,
    releaseFormat: verified.releaseFormat,
    headline: verified.headline,
    summary: verified.facts.map((f) => f.claim).join(" "),
    factLabel: primaryFact.factLabel,
    eventTime: primaryFact.eventTimeIso,
    eventTimeConfidence: primaryFact.eventTimeConfidence,
    articlePublishedAt: primaryFact.articlePublishedAtIso,
    primarySourceUrl: primarySource.url,
    sourceDomains: [...domains],
    facts: verified.facts,
    discoveredInRunId: ctx.hourlyRunId,
  });
  return row.id;
}

/**
 * The hourly master orchestrator (V3.1 - music news/release-announcement
 * wire): download DB from R2 -> import/update artist watchlist -> pick a
 * rotation batch of artists due for checking -> discover candidates via
 * web search -> independently re-verify each one (2-corroborating-source
 * rule, mandatory) -> persist verified items -> rank/cap the unposted
 * backlog -> quiet-hours check -> write -> copy-edit -> fact-check
 * (mandatory gate) -> duplicate-check -> publish (each item as its own
 * post) -> upload DB.
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

    const imported = importArtistList(db, config.news.artistListPath);
    if (imported > 0) logger.info("artist-import", `Imported ${imported} new artist name(s) from the watchlist`);

    const batch = getArtistsDueForCheck(db, config.news.artistBatchSize);
    const candidates = await discoverArtistNews(ctx, batch);
    const verified = await verifyArtistNews(ctx, candidates);
    const candidatesRejected = candidates.length - verified.length;
    for (const item of verified) persistVerifiedItem(ctx, item);
    markArtistsChecked(db, batch.map((a) => a.id));

    // Independent of the hourly per-item flow below (which only ever handles singles/news) - runs its own
    // internal eligibility check (Friday, past the configured hour, not already posted today) and is a
    // no-op most hours. Placed before every early-return path so it always gets a chance to run.
    await postWeeklyRoundup(ctx);

    const unposted = getUnpostedIndividualItems(db);
    const eligiblePool = rankMusicItems(unposted, MAX_ELIGIBLE_ITEMS);
    const topScore = eligiblePool.reduce<number | null>((max, r) => (max === null || r.importanceScore > max ? r.importanceScore : max), null);
    const quietDecision = resolveQuietHoursOutcome(editorialFocus, now, topScore);
    const effectiveOutcome = options.forceRun ? "normal" : quietDecision.outcome;
    const minScore = options.forceRun ? 0 : quietDecision.minImportanceScore;

    logger.info(
      "orchestrator",
      `Quiet-hours outcome: ${effectiveOutcome} (local hour ${quietDecision.localHour}, min importance score ${minScore})`
    );

    if (effectiveOutcome === "silent" || eligiblePool.length === 0) {
      logger.info("orchestrator", "Staying silent this hour - nothing to post, which is expected and healthy most hours");
      return silentResult(hourlyRun.id, quietDecision.outcome, candidates.length, candidatesRejected, db);
    }

    const filtered = eligiblePool.filter((r) => r.importanceScore >= minScore).slice(0, config.news.maxPostsPerEdition);
    if (filtered.length === 0) {
      return silentResult(hourlyRun.id, quietDecision.outcome, candidates.length, candidatesRejected, db);
    }

    const writingItems: WritingItem[] = filtered.map((r) => toWritingItem(r));

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

    const publishResult = await publishMusicItems(ctx, edition);
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

function toWritingItem(ranked: RankedMusicItem): WritingItem {
  const item = ranked.item;
  return {
    musicItemId: item.id,
    artistName: item.artist_name,
    itemType: item.item_type,
    releaseFormat: item.release_format,
    headline: item.headline,
    facts: JSON.parse(item.facts_json),
  };
}
