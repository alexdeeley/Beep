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
import { getUnpostedReleases } from "./db/releasesRepo.js";
import { getAccessToken } from "./spotify/client.js";
import { importArtistList } from "./artists/importArtistList.js";
import { resolvePendingArtists } from "./artists/resolveArtists.js";
import { checkForNewReleases } from "./releases/checkForReleases.js";
import { rankReleases, type RankedRelease } from "./releases/rankReleases.js";
import { resolveQuietHoursOutcome } from "./quietHours/quietHoursPolicy.js";
import { writeEdition } from "./writing/writeEdition.js";
import { buildReleaseFacts, type WritingItem } from "./writing/prompts.js";
import { copyEditEdition } from "./copyEdit/copyEditEdition.js";
import { factCheckEdition } from "./factCheck/factCheckEdition.js";
import { duplicateCheckEdition } from "./duplicateCheck/duplicateCheckEdition.js";
import { publishReleases } from "./publishing/publishReleases.js";
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

/** Cap on how many unposted releases get carried into writing, regardless of maxPostsPerEdition - this just bounds cost; the writer/quiet-hours filter decide the final cut. */
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

function toWritingItem(ranked: RankedRelease): WritingItem {
  const r = ranked.release;
  const genres: string[] = r.artist_genres_json ? (JSON.parse(r.artist_genres_json) as string[]) : [];
  const base = {
    artistName: r.artist_name,
    releaseType: r.release_type,
    title: r.title,
    releaseDate: r.release_date,
    totalTracks: r.total_tracks,
    genres,
    spotifyUrl: r.spotify_url,
  };
  return { releaseId: r.id, ...base, facts: buildReleaseFacts(base) };
}

/**
 * The hourly master orchestrator (V3 - music release-announcement wire):
 *   download DB from R2 -> import/update artist watchlist -> resolve
 *   pending artists against Spotify -> check a rotation batch of resolved
 *   artists for new releases -> rank/cap the unposted backlog -> quiet-
 *   hours check -> write -> copy-edit -> fact-check (mandatory gate) ->
 *   duplicate-check -> publish (each release as its own post) -> upload DB.
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

  // Fetched before touching the DB so a missing/invalid Spotify credential fails fast, without
  // downloading/uploading anything - this pipeline's core release-detection depends on it entirely.
  const spotifyToken = await getAccessToken(config);

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
      spotifyToken,
      editorialFocus,
      hourlyRunId: hourlyRun.id,
      dryRun: options.dryRun,
      now,
    };

    logger.info("orchestrator", `Starting newswire cycle ${hourlyRun.id}`, { dryRun: options.dryRun, forceRun: options.forceRun });

    const imported = importArtistList(db, config.news.artistListPath);
    if (imported > 0) logger.info("artist-import", `Imported ${imported} new artist name(s) from the watchlist`);

    await resolvePendingArtists(ctx);
    const releaseCheck = await checkForNewReleases(ctx);

    const unposted = getUnpostedReleases(db);
    const eligiblePool = rankReleases(unposted, MAX_ELIGIBLE_ITEMS);
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
      return silentResult(hourlyRun.id, quietDecision.outcome, releaseCheck.newReleasesFound, 0, db);
    }

    const filtered = eligiblePool.filter((r) => r.importanceScore >= minScore).slice(0, config.news.maxPostsPerEdition);
    if (filtered.length === 0) {
      return silentResult(hourlyRun.id, quietDecision.outcome, releaseCheck.newReleasesFound, eligiblePool.length, db);
    }

    const writingItems: WritingItem[] = filtered.map(toWritingItem);

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
        candidates_found: releaseCheck.newReleasesFound,
        candidates_rejected: eligiblePool.length - filtered.length,
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
        candidates_found: releaseCheck.newReleasesFound,
        candidates_rejected: eligiblePool.length - filtered.length,
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

    const publishResult = await publishReleases(ctx, edition);
    const publishStatus: NewswireCycleSummary["publishStatus"] = options.dryRun
      ? "dry_run"
      : publishResult.posts.length > 0
        ? "published"
        : "failed";

    finishHourlyRun(db, hourlyRun.id, {
      status: "success",
      quiet_hours_outcome: quietDecision.outcome,
      candidates_found: releaseCheck.newReleasesFound,
      candidates_rejected: eligiblePool.length - filtered.length,
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
