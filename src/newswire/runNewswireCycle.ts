import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DateTime } from "luxon";
import { makeOpenAIClient, MissingApiKeyError } from "../utils/openaiClient.js";
import { RunLogger } from "../utils/logger.js";
import type { AppConfig } from "../config/index.js";
import { loadEditorialFocus } from "./editorialFocus.js";
import { downloadStoryDb, uploadStoryDb } from "./db/sync.js";
import { openStoryDb, closeStoryDb } from "./db/connection.js";
import { startHourlyRun, finishHourlyRun } from "./db/researchRunsRepo.js";
import { getUnpostedIndividualItems, getUnpostedAlbumItems, insertMusicItem, type UnpostedMusicItemRow } from "./db/musicItemsRepo.js";
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
import { postMusicHistory } from "./history/postMusicHistory.js";
import { postBirthdays } from "./birthdays/postBirthdays.js";
import type { NewsRunContext } from "./runContext.js";
import type { DraftEdition, VerifiedMusicItem } from "./types.js";

export interface NewswireCycleOptions {
  /** True for `news:preview` - runs every stage for real but never publishes and never persists DB changes back to R2. */
  dryRun: boolean;
  /** Bypasses the posting-hours gate and quiet-hours silence, for manual testing (`news:publish --force`). */
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

/**
 * The writer had nothing left to work with this cycle - but that's not the same as "nothing
 * published": a mechanical single may already have gone out before the writer path was even
 * evaluated (see publishMechanicalSingles below), so mechanicalPublishedCount must still be
 * reflected here rather than hardcoding "skipped"/0, or the run record and CLI summary would
 * misreport a cycle that actually posted something.
 */
function silentResult(
  hourlyRunId: number,
  quietHoursOutcome: string,
  candidatesFound: number,
  candidatesRejected: number,
  mechanicalPublishedCount: number,
  db: ReturnType<typeof openStoryDb>
): NewswireCycleSummary {
  const publishStatus: NewswireCycleSummary["publishStatus"] = mechanicalPublishedCount > 0 ? "published" : "skipped";
  finishHourlyRun(db, hourlyRunId, {
    status: "silent",
    quiet_hours_outcome: quietHoursOutcome as "normal" | "slow" | "silent",
    candidates_found: candidatesFound,
    candidates_rejected: candidatesRejected,
    publish_status: publishStatus,
  });
  return {
    hourlyRunId,
    quietHoursOutcome,
    publishedPostCount: mechanicalPublishedCount,
    publishStatus,
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
    releaseTitle: verified.releaseTitle,
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
 * Non-priority singles post immediately as a mechanical "NEW SINGLE: Artist - Title" line - built
 * directly from already-verified structured fields, never through the writer/copy-edit/fact-check
 * stages (there's no new prose to check). Falls back to the full headline if releaseTitle is somehow
 * missing (only possible for a stale pre-migration backlog row) rather than skipping the item.
 */
async function publishMechanicalSingles(ctx: NewsRunContext, items: UnpostedMusicItemRow[]): Promise<number> {
  if (items.length === 0) return 0;
  const edition: DraftEdition = {
    posts: items.map((item) => ({
      text: `NEW SINGLE: ${item.artist_name} - ${item.release_title ?? item.headline}`,
      sourceItemIds: [item.id],
    })),
  };
  const result = await publishMusicItems(ctx, edition);
  return result.posts.length;
}

/**
 * The master orchestrator (V3.2 - twice-daily, simpler formats): runs at
 * 8am/8pm local time (see config.news.postingHoursLocal - any other hour
 * exits immediately below, before contacting OpenAI or R2 at all) and:
 * download DB from R2 -> import/update artist watchlist -> pick a
 * rotation batch of artists due for checking -> discover candidates via
 * web search -> independently re-verify each one (2-corroborating-source
 * rule, mandatory) -> persist verified items -> mark artists checked ->
 * NEW MUSIC FRIDAY roundup (Fridays only) -> TODAY IN HISTORY (once daily)
 * -> birthday shoutouts for watchlist artists (once a year per artist) ->
 * non-priority singles post immediately as a mechanical one-liner ->
 * remaining news/priority items go through write -> copy-edit ->
 * fact-check (mandatory gate) -> duplicate-check -> publish -> upload DB.
 *
 * The DB is always closed and (outside dry-run) uploaded back to R2 in a
 * finally block, even on failure - the audit trail must survive a failed
 * run, and a preview run must never leave any trace in the shared state.
 */
export async function runNewswireCycle(config: AppConfig, options: NewswireCycleOptions): Promise<NewswireCycleSummary> {
  const runDir = join(config.paths.runsDir, "news", new Date().toISOString().replace(/[:.]/g, "-"));
  const logger = new RunLogger(runDir);

  const editorialFocus = loadEditorialFocus(config.news.editorialFocusPath);
  const now = new Date();
  const localHour = DateTime.fromJSDate(now, { zone: editorialFocus.quietHours.timezone }).hour;

  if (!options.forceRun && !config.news.postingHoursLocal.includes(localHour)) {
    logger.info(
      "orchestrator",
      `Off-hour cycle (local hour ${localHour}, posting hours are ${config.news.postingHoursLocal.join(", ")}) - exiting without contacting OpenAI or the story database`
    );
    return { hourlyRunId: 0, quietHoursOutcome: "off-hours", publishedPostCount: 0, publishStatus: "skipped", editionPreview: null };
  }

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

    logger.info("orchestrator", `Starting newswire cycle ${hourlyRun.id}`, { dryRun: options.dryRun, forceRun: options.forceRun });

    const imported = importArtistList(db, config.news.artistListPath);
    if (imported > 0) logger.info("artist-import", `Imported ${imported} new artist name(s) from the watchlist`);

    const batch = getArtistsDueForCheck(db, config.news.artistBatchSize);
    const candidates = await discoverArtistNews(ctx, batch);
    const verified = await verifyArtistNews(ctx, candidates);
    const candidatesRejected = candidates.length - verified.length;
    for (const item of verified) persistVerifiedItem(ctx, item);
    markArtistsChecked(db, batch.map((a) => a.id));

    // All three are independent of the per-item flow below, run their own internal eligibility checks
    // (roundup: Friday + past the configured hour; history: once a day; birthdays: once a year per
    // artist), and are no-ops most cycles. Placed before every early-return path so they always get a
    // chance to run. Each returns how many physical posts it actually published, since any of them can
    // be the only thing that posts this cycle - that count must feed into the final publishedPostCount/
    // publishStatus below, or a cycle that published only e.g. a birthday post would be misreported as
    // "skipped" (see the mechanicalPublishedCount fix in silentResult's history for why this matters).
    const roundupPublishedCount = await postWeeklyRoundup(ctx);
    const historyPublishedCount = await postMusicHistory(ctx);
    const birthdayPublishedCount = await postBirthdays(ctx);

    // Priority artists (editorial-focus.json's priorityArtists) get VIP treatment: their album/EP/compilation
    // releases skip the Friday-only roundup hold and join the immediate queue like everything else, jumping
    // to the front of it (queue-jump), and their importanceScore is forced to the max below so they always
    // clear quiet hours regardless of the hour.
    const priorityNames = new Set(editorialFocus.priorityArtists);
    const priorityAlbums = getUnpostedAlbumItems(db).filter((item) => priorityNames.has(item.artist_name));
    const individualItems = getUnpostedIndividualItems(db);

    // Non-priority singles bypass the writer entirely - a mechanical "NEW SINGLE: Artist - Title" post.
    const mechanicalSingles = individualItems.filter((item) => item.item_type === "release" && !priorityNames.has(item.artist_name));
    const singlesPublishedCount = await publishMechanicalSingles(ctx, mechanicalSingles);
    const mechanicalPublishedCount = roundupPublishedCount + historyPublishedCount + birthdayPublishedCount + singlesPublishedCount;

    // Everything else that can reach the writer: all news items (priority or not) + priority release
    // items (always singles here, since priority albums were already pulled into priorityAlbums above).
    const writerEligibleIndividual = individualItems.filter((item) => item.item_type === "news" || priorityNames.has(item.artist_name));
    const unposted = [...priorityAlbums, ...writerEligibleIndividual];
    const eligiblePool = rankMusicItems(unposted, MAX_ELIGIBLE_ITEMS).map((r) =>
      priorityNames.has(r.item.artist_name) ? { ...r, importanceScore: 1 } : r
    );
    const topScore = eligiblePool.reduce<number | null>((max, r) => (max === null || r.importanceScore > max ? r.importanceScore : max), null);
    const quietDecision = resolveQuietHoursOutcome(editorialFocus, now, topScore);
    const effectiveOutcome = options.forceRun ? "normal" : quietDecision.outcome;
    const minScore = options.forceRun ? 0 : quietDecision.minImportanceScore;

    logger.info(
      "orchestrator",
      `Quiet-hours outcome: ${effectiveOutcome} (local hour ${quietDecision.localHour}, min importance score ${minScore})`
    );

    if (effectiveOutcome === "silent" || eligiblePool.length === 0) {
      logger.info("orchestrator", "Nothing left for the writer this cycle beyond what already posted mechanically above");
      return silentResult(hourlyRun.id, quietDecision.outcome, candidates.length, candidatesRejected, mechanicalPublishedCount, db);
    }

    const filtered = eligiblePool.filter((r) => r.importanceScore >= minScore).slice(0, config.news.maxPostsPerEdition);
    if (filtered.length === 0) {
      return silentResult(hourlyRun.id, quietDecision.outcome, candidates.length, candidatesRejected, mechanicalPublishedCount, db);
    }

    const writingItems: WritingItem[] = filtered.map((r) => toWritingItem(r, priorityNames));

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
        publishedPostCount: mechanicalPublishedCount,
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
        publishedPostCount: mechanicalPublishedCount,
        publishStatus: "skipped",
        editionPreview: edition?.posts.map((p) => ({ text: p.text })) ?? null,
      };
    }

    const publishResult = await publishMusicItems(ctx, edition);
    const totalPublished = mechanicalPublishedCount + publishResult.posts.length;
    const publishStatus: NewswireCycleSummary["publishStatus"] = options.dryRun
      ? "dry_run"
      : totalPublished > 0
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
      publishedPosts: totalPublished,
      dryRun: options.dryRun,
    });

    return {
      hourlyRunId: hourlyRun.id,
      quietHoursOutcome: quietDecision.outcome,
      publishedPostCount: totalPublished,
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

function toWritingItem(ranked: RankedMusicItem, priorityNames: Set<string>): WritingItem {
  const item = ranked.item;
  return {
    musicItemId: item.id,
    artistName: item.artist_name,
    itemType: item.item_type,
    releaseFormat: item.release_format,
    isPriorityArtist: priorityNames.has(item.artist_name),
    headline: item.headline,
    facts: JSON.parse(item.facts_json),
  };
}
