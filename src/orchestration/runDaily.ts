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
import { renderInfographic, type RenderResult } from "../render/renderInfographic.js";
import { runQualityChecks } from "../qa/runQA.js";
import { generateCaption, composeFinalCaptionText } from "../caption/generateCaption.js";
import { deriveContentHashtags } from "../caption/hashtagExtraction.js";
import { uploadImage } from "../storage/storage.js";
import { publishToBluesky } from "../bluesky/publish.js";
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

/** Stage: deterministic HTML/CSS render to PNG/JPG. */
export async function runRenderStage(
  ctx: RunContext,
  selected: SelectedContent,
  assets: DecorativeAsset[]
): Promise<RenderResult> {
  const { config, logger, store } = ctx;
  const result = await renderInfographic(config, logger, store.dir, selected, assets);
  store.writeJson("render.json", result);
  return result;
}

/** Stage: automated QA over data + pixels. */
export async function runQAStage(ctx: RunContext, selected: SelectedContent, render: RenderResult): Promise<QAResult> {
  const { config, logger, store, resolved } = ctx;
  const result = await runQualityChecks(config, logger, resolved.isoDate, selected, render.feed);
  store.writeJson("qa.json", result);
  return result;
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
  dryRun: boolean
): Promise<PublishRecord> {
  const { config, logger, store, resolved } = ctx;
  const alreadyPublished = isAlreadyPublished(config, resolved.isoDate);

  let publicUrl: string | null = null;
  if (!dryRun && !alreadyPublished) {
    const upload = await uploadImage(config, logger, render.feed.imagePath, resolved.isoDate);
    publicUrl = upload.publicUrl;
  }

  // Content-derived tags (people, places, event topics, categories - all
  // ranked by each fact's own importance) get first claim on the 8 tag
  // slots; the LLM's own hashtag guesses and the evergreen brand pool
  // only fill in whatever room is left. See src/caption/hashtagExtraction.ts.
  const tags = [...deriveContentHashtags(selected), ...caption.hashtags, ...config.brand.hashtags];

  const record = await publishToBluesky(config, logger, {
    date: resolved.isoDate,
    localImagePath: render.feed.imagePath,
    publicImageUrl: publicUrl,
    altText: caption.caption,
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
 * The master orchestrator described in the project spec:
 *   resolveLocalDate -> checkAlreadyPublished -> researchDate ->
 *   verifyCandidates -> selectContent -> generateSupportingAssets ->
 *   renderInfographic -> runQualityChecks -> generateCaption ->
 *   uploadImage -> publishToBluesky -> saveRunRecord
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

  if (isAlreadyPublished(config, resolved.isoDate)) {
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

    const assets = await runAssetsStage(ctx, selected);
    markStage(record, "assets", "OK", `${assets.length} decorative asset(s)`);

    render = await runRenderStage(ctx, selected, assets);
    markStage(record, "render", "OK", `scale=${render.feed.scale.toFixed(3)}`);

    const qa = await runQAStage(ctx, selected, render);
    markStage(record, "qa", qa.status === "PASS" ? "OK" : "FAILED", `${qa.issues.length} issue(s)`);
    if (qa.status !== "PASS") {
      throw new StageFailure("qa", `QA failed with ${qa.issues.filter((i) => i.severity === "blocking").length} blocking issue(s): ${qa.issues.map((i) => i.message).join(" | ")}`);
    }

    const caption = await runCaptionStage(ctx, selected);
    markStage(record, "caption", "OK");

    const publish = await runPublishStage(ctx, selected, render, caption, options.dryRun);
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
