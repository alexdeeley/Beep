import type { AppConfig } from "../config/index.js";
import { RunLogger } from "../utils/logger.js";
import { RunStore, isAlreadyPublished } from "../utils/stateStore.js";
import { resolveLocalDate, nowIso } from "../utils/dateUtils.js";
import { pickWeeklyCard } from "./pickCard.js";
import { isDecadeWeek } from "./decadeCheck.js";
import { generateCardArt } from "./generateCardArt.js";
import { runCardQualityChecks } from "./runCardQA.js";
import { buildCardAltText, buildCardTags } from "./generateCardCaption.js";
import { isCardAlreadyPublishedOnBluesky } from "./publishCard.js";
import { publishToBluesky, selectBlueskyTags } from "../bluesky/publish.js";
import { uploadImage } from "../storage/storage.js";
import { isWeeklyCardRetired, writeRetirementMarker } from "./retirement.js";
import type { PublishRecord, QAResult } from "../utils/types.js";
import type { SizeRenderResult } from "../render/renderInfographic.js";

/**
 * Orchestrator for the independent weekly "card draw" pipeline. Deliberately
 * NOT part of orchestration/runDaily.ts and shares no state, schedule, or
 * concurrency group with it (see .github/workflows/weekly-card.yml) - a
 * bug or outage here can never block, corrupt, or delay the daily "On
 * This Day" app. The two pipelines' only shared code is the low-level
 * OpenAI/Bluesky/storage plumbing (art/imageGeneration.ts,
 * bluesky/publish.ts's publishToBluesky, storage/storage.ts), none of
 * which carries any daily-pipeline-specific state.
 *
 * The local run-state directory and the Bluesky-post idempotency check
 * are both namespaced (a "weekly-<date>" synthetic key, and a distinct
 * "Card Draw" alt-text marker) so they can never collide with the daily
 * pipeline's own "<date>" directories or "<Month Day, Year>" idempotency
 * matching, even though both pipelines publish to the same account.
 */

export interface WeeklyRunOptions {
  dateOverride?: string;
  dryRun: boolean;
  /** Test-only: force the decade-special branch regardless of the anchor-date math. Never set by the scheduled workflow. */
  forceDecade: boolean;
}

export interface WeeklyRunSummary {
  isoDate: string;
  isDecade: boolean;
  card: string;
  qa: QAResult | null;
  publish: PublishRecord | null;
  retired: boolean;
}

function storeKeyFor(isoDate: string): string {
  return `weekly-${isoDate}`;
}

export async function runWeeklyCardPost(config: AppConfig, options: WeeklyRunOptions): Promise<WeeklyRunSummary> {
  const resolved = resolveLocalDate(config.timezone, options.dateOverride);

  // Permanent, one-way shutdown: once the once-a-decade special edition
  // has ever been successfully published, this pipeline never runs
  // again - checked first, before any other work, so a retired pipeline
  // costs nothing (see retirement.ts for why this is a git-committed
  // marker file rather than a Bluesky post-history check).
  if (isWeeklyCardRetired()) {
    console.log(`Weekly card pipeline is retired; ${resolved.isoDate}'s run does nothing. See state/weekly-card-retired.json.`);
    return { isoDate: resolved.isoDate, isDecade: false, card: "", qa: null, publish: null, retired: true };
  }

  const storeKey = storeKeyFor(resolved.isoDate);
  const store = new RunStore(config, storeKey);
  const logger = new RunLogger(store.dir);

  const card = pickWeeklyCard(resolved.isoDate);
  const isDecade = options.forceDecade || isDecadeWeek(resolved.isoDate, config.weeklyCard.anchorDate);

  logger.info("weekly-card", `Starting weekly card run for ${resolved.isoDate}`, {
    card: card.label,
    isDecade,
    dryRun: options.dryRun,
  });

  const alreadyPublished = isAlreadyPublished(config, storeKey) || (await isCardAlreadyPublishedOnBluesky(config, logger, resolved.isoDate));
  if (alreadyPublished) {
    logger.info("weekly-card", `${resolved.isoDate} already has a successful weekly card post; exiting without doing any work`);
    return { isoDate: resolved.isoDate, isDecade, card: card.label, qa: null, publish: null, retired: false };
  }

  const maxAttempts = config.weeklyCard.maxQaRegenerationAttempts;
  let render: SizeRenderResult | undefined;
  let qa: QAResult | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    render = await generateCardArt(config, logger, store.dir, resolved.isoDate, card, isDecade);
    store.writeJson("render.json", render);

    qa = await runCardQualityChecks(config, logger, render, isDecade);
    store.writeJson("qa.json", qa);
    if (qa.status === "PASS") break;

    const blocking = qa.issues.filter((i) => i.severity === "blocking");
    const onlyImageContentIssues = blocking.length > 0 && blocking.every((i) => i.message.startsWith("[vision-qa]"));
    if (!onlyImageContentIssues) break;
    if (attempt < maxAttempts) {
      logger.warn("weekly-card", `Image rejected by vision QA (attempt ${attempt}/${maxAttempts}); regenerating a fresh image`, {
        issues: blocking.map((i) => i.message),
      });
    }
  }

  if (!render || !qa) {
    throw new Error("Weekly card run failed before producing a render/QA result");
  }

  if (qa.status !== "PASS") {
    logger.error("weekly-card", `Run FAILED at QA: ${qa.issues.map((i) => i.message).join(" | ")}`);
    store.writeJson("run.json", { isoDate: resolved.isoDate, isDecade, card: card.label, qaStatus: qa.status, finishedAt: nowIso() });
    return { isoDate: resolved.isoDate, isDecade, card: card.label, qa, publish: null, retired: false };
  }

  let publicUrl: string | null = null;
  if (!options.dryRun) {
    try {
      const upload = await uploadImage(config, logger, render.imagePath, storeKey);
      publicUrl = upload.publicUrl;
    } catch (err) {
      logger.error("storage", "Archival upload failed; continuing without a public archival URL", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const tags = selectBlueskyTags(buildCardTags(card, isDecade));
  const altText = buildCardAltText(resolved.isoDate, card, isDecade, tags);

  const publish = await publishToBluesky(config, logger, {
    date: storeKey,
    localImagePath: render.imagePath,
    publicImageUrl: publicUrl,
    altText,
    tags,
    dryRun: options.dryRun,
    alreadyPublished: false,
  });
  store.writeJson("publish.json", publish);
  store.writeJson("run.json", {
    isoDate: resolved.isoDate,
    isDecade,
    card: card.label,
    qaStatus: qa.status,
    publishStatus: publish.status,
    finishedAt: nowIso(),
  });

  let retired = false;
  if (isDecade && publish.status === "SUCCESS") {
    // The special edition actually went out - per explicit direction,
    // this pipeline retires permanently now, not just for this week. The
    // marker written here only takes effect for future runs once
    // .github/workflows/weekly-card.yml commits it back to the repo
    // (this run's own checkout doesn't need it - it's already done).
    writeRetirementMarker({
      retiredAt: nowIso(),
      retiredForRunDate: resolved.isoDate,
      card: card.label,
      reason: 'The once-a-decade "LIFE IS BEAUTIFUL. GOODBYE." special edition was published; the weekly card pipeline is now permanently retired.',
    });
    retired = true;
    logger.info("weekly-card", "Decade special published successfully; writing permanent retirement marker. No further weekly card posts will ever be made.");
  }

  logger.info("weekly-card", `Run complete for ${resolved.isoDate}: publishStatus=${publish.status}`);
  return { isoDate: resolved.isoDate, isDecade, card: card.label, qa, publish, retired };
}
