import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../config/index.js";
import { RunLogger } from "../utils/logger.js";
import { RunStore, isAlreadyPublished } from "../utils/stateStore.js";
import { resolveLocalDate, nowIso, type ResolvedDate } from "../utils/dateUtils.js";
import type {
  CandidateFact,
  CaptionResult,
  DecorativeAsset,
  PublishRecord,
  QAResult,
  RunRecord,
  SelectedContent,
  VerifiedFact,
} from "../utils/types.js";
import { researchDate, type ResearchOutput } from "../research/researchAgent.js";
import { verifyCandidates, type VerificationOutput } from "../verification/verifyAgent.js";
import { selectContent } from "../selection/selectContent.js";
import { generateSupportingAssets } from "../assets/generateAssets.js";
import type { RenderResult } from "../render/renderInfographic.js";
import { generateDailyArt } from "../art/generateArt.js";
import { curateTrends, curateHistoricalContent, type CuratedTrendItem } from "../art/trendCuration.js";
import { runQualityChecks } from "../qa/runQA.js";
import { generateCaption, composeFinalCaptionText, buildArtAltText } from "../caption/generateCaption.js";
import { deriveContentHashtags } from "../caption/hashtagExtraction.js";
import { uploadImage } from "../storage/storage.js";
import { publishToBluesky, selectBlueskyTags, isAlreadyPublishedOnBluesky } from "../bluesky/publish.js";
import { fetchTrendingTopics, trendingTopicsToTags, type TrendingTopic } from "../bluesky/trending.js";
import { loadFixture } from "./fixtures.js";

export interface RunContext {
  config: AppConfig;
  logger: RunLogger;
  store: RunStore;
  resolved: ResolvedDate;
}

export function makeRunContext(config: AppConfig, dateOverride?: string): RunContext {
  const resolved = resolveLocalDate(config.timezone, dateOverride);
  const store = new RunStore(config, resolved.isoDate);
  const logger = new RunLogger(store.dir);
  return { config, logger, store, resolved };
}

function newRunRecord(date: string): RunRecord {
  return {
    date,
    startedAt: nowIso(),
    finishedAt: null,
    stages: {},
    candidateCount: 0,
    verifiedCount: 0,
    rejectedCount: 0,
    publishStatus: null,
    failureStage: null,
  };
}

function markStage(record: RunRecord, stage: string, status: "OK" | "FAILED" | "SKIPPED", detail?: string): void {
  record.stages[stage] = { status, detail, finishedAt: nowIso() };
}

/** Stage: research (or fixture load for offline/dev/test use). */
export async function runResearchStage(ctx: RunContext, useFixture: boolean): Promise<ResearchOutput> {
  const { config, logger, store, resolved } = ctx;
  if (useFixture) {
    const fixture = loadFixture(resolved.monthDay);
    logger.info("research", `Loaded ${fixture.research.candidates.length} fixture candidates for ${resolved.monthDay} (--fixture mode, no API call)`);
    store.writeJson("research.json", fixture.research);
    return fixture.research;
  }
  const output = await researchDate(config, logger, resolved.monthDay, resolved.displayDate);
  store.writeJson("research.json", output);
  return output;
}

/** Stage: independent verification (or fixture load). */
export async function runVerificationStage(
  ctx: RunContext,
  candidates: CandidateFact[],
  useFixture: boolean
): Promise<VerificationOutput> {
  const { config, logger, store, resolved } = ctx;
  if (useFixture) {
    const fixture = loadFixture(resolved.monthDay);
    logger.info("verification", `Loaded fixture verification results for ${resolved.monthDay} (--fixture mode, no API call)`);
    store.writeJson("verified.json", fixture.verified);
    return fixture.verified;
  }
  const output = await verifyCandidates(config, logger, resolved.displayDate, resolved.monthDay, candidates);
  store.writeJson("verified.json", output);
  return output;
}

/** Stage: selection (pure logic, always runs the same way). */
export function runSelectionStage(ctx: RunContext, verified: VerifiedFact[]): SelectedContent {
  const { config, logger, store, resolved } = ctx;
  const selected = selectContent(config, logger, resolved.year, resolved.displayDate, resolved.monthDay, verified);
  store.writeJson("selected.json", selected);
  return selected;
}

/** Stage: optional decorative asset generation. */
export async function runAssetsStage(ctx: RunContext, selected: SelectedContent): Promise<DecorativeAsset[]> {
  const { config, logger, store } = ctx;
  const assets = await generateSupportingAssets(config, logger, store.dir, selected);
  store.writeJson("assets.json", assets);
  return assets;
}

/**
 * Stage: fetches Bluesky's live trending topics ONCE per run, so the same
 * data thematically informs the art (render stage) and fills the tag
 * slots (publish stage) - what inspired the image and what it's tagged
 * with always agree. Best-effort: see bluesky/trending.ts for why a
 * failure here returns [] rather than blocking the run.
 *
 * Only fetched when the run's date is actually today (ctx.resolved.isToday)
 * - live trending topics are only meaningful as "what's happening right
 * now," which is only true for real daily production. A --date override
 * pointing at a different day gets [] here and its art content comes from
 * that day's own independently researched historical facts instead (see
 * runTrendCurationStage) rather than today's unrelated real-world news.
 */
export async function runTrendingStage(ctx: RunContext): Promise<TrendingTopic[]> {
  const { logger, store, resolved } = ctx;
  if (!resolved.isToday) {
    logger.info("bluesky", `${resolved.isoDate} is not today; skipping live trending topics (art will use this day's own historical facts instead)`);
    store.writeJson("trending.json", []);
    return [];
  }
  const topics = await fetchTrendingTopics(logger);
  store.writeJson("trending.json", topics);
  return topics;
}

/**
 * Stage: builds the curated "raw clay" package the art prompt is built
 * from. For real daily production (date is today) this curates today's
 * live trending topics; for a --date override pointing at a different day
 * it curates that day's own verified historical facts instead - see
 * generateArt.ts's generateDailyArt doc comment for why.
 */
export async function runTrendCurationStage(
  ctx: RunContext,
  selected: SelectedContent,
  trendingTopics: TrendingTopic[]
): Promise<CuratedTrendItem[]> {
  const { config, logger, store, resolved } = ctx;
  const curated = resolved.isToday ? await curateTrends(config, logger, trendingTopics) : await curateHistoricalContent(config, logger, selected);
  store.writeJson("curatedTrends.json", curated);
  return curated;
}

/**
 * Stage: generates the day's published image - a comic mashup painting
 * (see art/generateArt.ts) rather than the deterministic HTML/CSS
 * infographic - the old renderer (render/renderInfographic.ts) stays in
 * the codebase but is no longer called here.
 */
export async function runRenderStage(
  ctx: RunContext,
  selected: SelectedContent,
  curatedTrends: CuratedTrendItem[]
): Promise<RenderResult> {
  const { config, logger, store } = ctx;
  const result = await generateDailyArt(config, logger, store.dir, selected, curatedTrends);
  store.writeJson("render.json", result);
  return result;
}

/** Stage: automated QA over data + pixels. */
export async function runQAStage(ctx: RunContext, selected: SelectedContent, render: RenderResult): Promise<QAResult> {
  const { config, logger, store, resolved } = ctx;
  const result = await runQualityChecks(config, logger, resolved.isoDate, selected, render.feed, "art");
  store.writeJson("qa.json", result);
  return result;
}

/**
 * Runs render + QA together, regenerating a fresh image (not just
 * re-checking the same one) up to config.art.maxQaRegenerationAttempts
 * times when QA rejects it purely for an image-content problem the
 * vision check flags (hallucinated text, a recognizable real
 * likeness/logo) - a fresh generation can plausibly avoid the same
 * mistake since image generation is stochastic. A QA failure caused by a
 * DATA problem (e.g. unverified facts, wrong dimensions) is never worth
 * burning an image-generation attempt on - regenerating the image can't
 * fix that, so it returns immediately on the first attempt instead.
 */
export async function runRenderAndQAStage(
  ctx: RunContext,
  selected: SelectedContent,
  curatedTrends: CuratedTrendItem[]
): Promise<{ render: RenderResult; qa: QAResult }> {
  const { config, logger } = ctx;
  const maxAttempts = config.art.maxQaRegenerationAttempts;

  let render: RenderResult | undefined;
  let qa: QAResult | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    render = await runRenderStage(ctx, selected, curatedTrends);
    qa = await runQAStage(ctx, selected, render);
    if (qa.status === "PASS") return { render, qa };

    const blocking = qa.issues.filter((i) => i.severity === "blocking");
    const onlyImageContentIssues = blocking.length > 0 && blocking.every((i) => i.message.startsWith("[vision-qa]"));
    if (!onlyImageContentIssues) {
      logger.warn("qa", "QA failure is a data problem, not an image-content problem; regenerating the image would not help - not retrying", {
        issues: blocking.map((i) => i.message),
      });
      return { render, qa };
    }
    if (attempt < maxAttempts) {
      logger.warn("qa", `Image rejected by vision QA (attempt ${attempt}/${maxAttempts}); regenerating a fresh image`, {
        issues: blocking.map((i) => i.message),
      });
    }
  }
  return { render: render!, qa: qa! };
}

/** Stage: caption generation. */
export async function runCaptionStage(ctx: RunContext, selected: SelectedContent): Promise<CaptionResult> {
  const { config, logger, store } = ctx;
  const result = await generateCaption(config, logger, selected);
  store.writeText("caption.txt", composeFinalCaptionText(result));
  store.writeJson("caption.json", result);
  return result;
}

/**
 * Stage: upload + publish. The R2/S3 upload is kept as the permanent
 * public archival copy (and a record of what was published) even though
 * Bluesky itself uploads the image bytes directly rather than fetching
 * a URL - the two are independent.
 */
export async function runPublishStage(
  ctx: RunContext,
  selected: SelectedContent,
  render: RenderResult,
  caption: CaptionResult,
  trendingTopics: TrendingTopic[],
  dryRun: boolean
): Promise<PublishRecord> {
  const { config, logger, store, resolved } = ctx;
  // Local file check first (cheap, sync); the Bluesky check only runs when
  // needed, since it's the one that catches cross-run cases the local
  // file can't (see isAlreadyPublishedOnBluesky for why that matters).
  const alreadyPublished =
    isAlreadyPublished(config, resolved.isoDate) || (await isAlreadyPublishedOnBluesky(config, logger, resolved.isoDate));

  let publicUrl: string | null = null;
  if (!dryRun && !alreadyPublished) {
    // The archival upload is best-effort: Bluesky uploads the image bytes
    // directly and does not need this URL, so a storage failure (bad
    // credentials, DNS, network) must not block publishing - it only means
    // losing the durable public archival copy for this run.
    try {
      const upload = await uploadImage(config, logger, render.feed.imagePath, resolved.isoDate);
      publicUrl = upload.publicUrl;
    } catch (err) {
      logger.error("storage", "Archival upload failed; continuing without a public archival URL", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Per explicit direction, Bluesky's own live platform-wide trending
  // topics get first claim on the 8 tag slots (maximum discovery reach
  // over thematic relevance - see src/bluesky/trending.ts for the
  // tradeoffs). Content-derived tags (people, places, event topics,
  // categories - ranked by each fact's own importance), the LLM's own
  // hashtag guesses, and the evergreen brand pool fill in whatever room
  // is left, in that order. See src/caption/hashtagExtraction.ts.
  // Resolved to the same final 8-tag list used both as Bluesky's separate
  // discovery tags AND inline in the alt text, so the two never disagree.
  const trendingTags = trendingTopicsToTags(trendingTopics);
  const tagPool = [...trendingTags, ...deriveContentHashtags(selected), ...caption.hashtags, ...config.brand.hashtags];
  const tags = selectBlueskyTags(tagPool);
  const altText = buildArtAltText(caption.title, selected, tags);

  const record = await publishToBluesky(config, logger, {
    date: resolved.isoDate,
    localImagePath: render.feed.imagePath,
    publicImageUrl: publicUrl,
    altText,
    tags,
    dryRun,
    alreadyPublished,
  });
  store.writeJson("publish.json", record);
  return record;
}

export interface DailyRunOptions {
  dateOverride?: string;
  dryRun: boolean;
  fixture: boolean;
}

export interface DailyRunSummary {
  record: RunRecord;
  selected: SelectedContent | null;
  publish: PublishRecord | null;
}

/**
 * The master orchestrator:
 *   resolveLocalDate -> checkAlreadyPublished -> researchDate ->
 *   verifyCandidates -> selectContent -> generateDailyArt ->
 *   runQualityChecks -> generateCaption -> uploadImage ->
 *   publishToBluesky -> saveRunRecord
 *
 * Any critical failure (research, insufficient verified facts, render,
 * QA) stops the pipeline before publish. No post is better than a wrong
 * post.
 */
export async function runDailyHistoricalPost(config: AppConfig, options: DailyRunOptions): Promise<DailyRunSummary> {
  const ctx = makeRunContext(config, options.dateOverride);
  const { logger, store, resolved } = ctx;
  const record = newRunRecord(resolved.isoDate);

  logger.info("orchestrator", `Starting daily run for ${resolved.isoDate} (${resolved.displayDate}, ${resolved.weekday})`, {
    timezone: resolved.timezone,
    dryRun: options.dryRun,
    fixture: options.fixture,
  });

  // Local file check first (cheap, sync); only hit Bluesky's API if the
  // local check doesn't already know. This is what catches the case a
  // local-only check can't: two separate GitHub Actions runs (e.g. the
  // schedule's two DST-safe cron triggers, ~1 hour apart) each start from
  // a fresh checkout with no local runs/ history to compare against.
  const alreadyPublished =
    isAlreadyPublished(config, resolved.isoDate) || (await isAlreadyPublishedOnBluesky(config, logger, resolved.isoDate));
  if (alreadyPublished) {
    logger.info("orchestrator", `${resolved.isoDate} was already published successfully; exiting without doing any work`);
    markStage(record, "idempotency_check", "SKIPPED", "already published");
    record.finishedAt = nowIso();
    record.publishStatus = "SKIPPED_ALREADY_PUBLISHED";
    store.writeJson("run.json", record);
    return { record, selected: null, publish: null };
  }
  markStage(record, "idempotency_check", "OK");

  let selected: SelectedContent | null = null;
  let render: RenderResult | null = null;

  try {
    const research = await runResearchStage(ctx, options.fixture);
    record.candidateCount = research.candidates.length;
    markStage(record, "research", "OK", `${research.candidates.length} candidates`);

    const verification = await runVerificationStage(ctx, research.candidates, options.fixture);
    record.verifiedCount = verification.summary.verifiedCount;
    record.rejectedCount = verification.summary.rejectedCount;
    markStage(record, "verification", "OK", JSON.stringify(verification.summary));

    if (verification.summary.verifiedCount === 0) {
      throw new StageFailure("verification", "Zero candidates passed verification; refusing to publish an empty or fabricated post");
    }

    selected = runSelectionStage(ctx, verification.verified);
    const totalSelected = selected.majorEvents.length + selected.births.length + selected.deaths.length + selected.incidents.length;
    markStage(record, "selection", "OK", `${totalSelected} items selected`);
    if (totalSelected === 0) {
      throw new StageFailure("selection", "No verified items met selection criteria for this date");
    }

    const trendingTopics = await runTrendingStage(ctx);
    markStage(record, "trending", "OK", `${trendingTopics.length} topic(s)`);

    const curatedTrends = await runTrendCurationStage(ctx, selected, trendingTopics);
    markStage(record, "trend_curation", "OK", `${curatedTrends.length} item(s)`);

    const renderAndQa = await runRenderAndQAStage(ctx, selected, curatedTrends);
    render = renderAndQa.render;
    const qa = renderAndQa.qa;
    markStage(record, "render", "OK", `${render.feed.width}x${render.feed.height}`);
    markStage(record, "qa", qa.status === "PASS" ? "OK" : "FAILED", `${qa.issues.length} issue(s)`);
    if (qa.status !== "PASS") {
      throw new StageFailure("qa", `QA failed with ${qa.issues.filter((i) => i.severity === "blocking").length} blocking issue(s): ${qa.issues.map((i) => i.message).join(" | ")}`);
    }

    const caption = await runCaptionStage(ctx, selected);
    markStage(record, "caption", "OK");

    const publish = await runPublishStage(ctx, selected, render, caption, trendingTopics, options.dryRun);
    markStage(record, "publish", publish.status === "FAILED" ? "FAILED" : "OK", publish.status);
    record.publishStatus = publish.status;

    record.finishedAt = nowIso();
    store.writeJson("run.json", record);
    logger.info("orchestrator", `Run complete for ${resolved.isoDate}: publishStatus=${publish.status}`);
    return { record, selected, publish };
  } catch (err) {
    const stage = err instanceof StageFailure ? err.stage : "unknown";
    const message = err instanceof Error ? err.message : String(err);
    logger.error("orchestrator", `Run FAILED at stage "${stage}": ${message}`);
    record.failureStage = stage;
    markStage(record, stage, "FAILED", message);
    record.finishedAt = nowIso();
    store.writeJson("run.json", record);
    // Never publish on a critical failure. Diagnostics are already saved
    // to disk (run.log, run.jsonl, run.json, and whatever partial JSON
    // artifacts made it to disk before the failure).
    return { record, selected, publish: null };
  }
}

class StageFailure extends Error {
  constructor(public readonly stage: string, message: string) {
    super(message);
    this.name = "StageFailure";
  }
}

export function runDirExists(config: AppConfig, date: string): boolean {
  return existsSync(join(config.paths.runsDir, date));
}
