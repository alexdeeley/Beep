import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunLogger } from "../../utils/logger.js";
import type { AppConfig } from "../../config/index.js";
import { downloadStoryDb, uploadStoryDb } from "../db/sync.js";
import { openStoryDb, closeStoryDb } from "../db/connection.js";
import { startHourlyRun, finishHourlyRun } from "../db/researchRunsRepo.js";
import { buildFestivalKey, hasPostedFestivalPoster, recordFestivalPosterPost } from "../db/festivalPostersRepo.js";
import { insertBlueskyPost } from "../db/postsRepo.js";
import { contentHash } from "../contentHash.js";
import { createBlueskySession, postImageMessage, type BlueskySession } from "../../bluesky/threadPublish.js";
import { extractPosterImage } from "./extractPosterImage.js";
import { buildAltText } from "./postFestivalPosters.js";
import type { SampleFestivalInput } from "./postSampleFestival.js";
import type { VerifiedFestivalPoster } from "../types.js";

export interface PostSampleFestivalBatchItemResult {
  festivalName: string;
  eventYear: number | null;
  published: boolean;
  uri: string | null;
  reason?: string;
}

/** A short pause between live posts - gentle on Bluesky's API when firing off a whole retrospective series back-to-back rather than spread over days. */
const DELAY_BETWEEN_LIVE_POSTS_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Posts a whole batch of already-researched festival posters (e.g. every verifiable year of a
 * festival's retrospective) in one run, back-to-back, rather than one `news:post-sample` invocation per
 * item - the account owner explicitly wants a retrospective series "posted at the same time so it's not
 * spread out", which a loop of separate CLI invocations would still satisfy but far less efficiently (one
 * DB download/upload round-trip per item, serialized through the GitHub Actions concurrency lock).
 *
 * Same integrity guarantees as postSampleFestival.ts for every item: the poster image is still only ever
 * the real, mechanically-extracted bytes from extractPosterImage.ts, and each item still participates in
 * the same per-edition idempotency (db/festivalPostersRepo.ts) and audit trail (db/postsRepo.ts). One
 * item's failure (extraction miss, network error, already-posted) never stops the rest of the batch - the
 * whole point of a large retrospective is that some years will be skippable, not that one bad year should
 * block every other year.
 *
 * The story database is downloaded once and persisted back to R2 after EVERY successfully posted item
 * (not just once at the end) - a batch like this can run long, and losing an in-progress run's dedup
 * records to a mid-batch crash would risk duplicate posts on retry.
 */
export async function postSampleFestivalBatch(
  config: AppConfig,
  inputs: SampleFestivalInput[],
  options: { dryRun: boolean }
): Promise<PostSampleFestivalBatchItemResult[]> {
  const runDir = join(config.paths.runsDir, "news", `post-sample-batch-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const logger = new RunLogger(runDir);

  const tempDir = mkdtempSync(join(tmpdir(), "newswire-db-"));
  const dbPath = join(tempDir, "story.db");
  const handle = await downloadStoryDb(config, logger, dbPath);
  const db = openStoryDb(dbPath);

  const results: PostSampleFestivalBatchItemResult[] = [];
  let session: BlueskySession | null = null;

  try {
    const hourlyRun = startHourlyRun(db, options.dryRun);

    for (const input of inputs) {
      const label = `"${input.festivalName}"${input.eventYear ? ` ${input.eventYear}` : ""}`;
      const item: VerifiedFestivalPoster = {
        festivalName: input.festivalName,
        eventYear: input.eventYear,
        headline: input.blurb,
        blurb: input.blurb,
        lineupArtists: input.lineupArtists,
        primarySourceUrl: input.primarySourceUrl,
        facts: [],
        meetsSourceBar: true,
      };
      const key = buildFestivalKey(item.festivalName, item.eventYear);

      if (hasPostedFestivalPoster(db, key)) {
        const reason = `${label} is already recorded as posted - skipping to avoid a duplicate`;
        logger.warn("post-sample-batch", reason);
        results.push({ festivalName: input.festivalName, eventYear: input.eventYear, published: false, uri: null, reason });
        continue;
      }

      const image = await extractPosterImage(logger, input.primarySourceUrl, input.festivalName);
      if (!image) {
        const reason = `Could not mechanically extract a poster image for ${label} from ${input.primarySourceUrl}`;
        results.push({ festivalName: input.festivalName, eventYear: input.eventYear, published: false, uri: null, reason });
        continue;
      }

      const altText = buildAltText(item);

      if (options.dryRun) {
        logger.info(
          "post-sample-batch",
          `Dry run: would publish poster image for ${label} (${image.imageBytes.length} bytes from ${image.imageUrl})`,
          { altText }
        );
        results.push({ festivalName: input.festivalName, eventYear: input.eventYear, published: false, uri: null });
        continue;
      }

      try {
        session = session ?? (await createBlueskySession(config));
        const ref = await postImageMessage(config, logger, session, {
          text: "",
          altText,
          imageBytes: image.imageBytes,
          mimeType: image.mimeType,
        });
        insertBlueskyPost(db, {
          runId: hourlyRun.id,
          threadPosition: 0,
          text: altText,
          contentHash: contentHash(altText),
          uri: ref.uri,
          cid: ref.cid,
          rootUri: ref.uri,
          parentUri: ref.uri,
          dryRun: false,
        });
        recordFestivalPosterPost(db, { festivalKey: key, festivalName: item.festivalName, postedInRunId: hourlyRun.id });
        logger.info("post-sample-batch", `Published ${label}: ${ref.uri}`);
        results.push({ festivalName: input.festivalName, eventYear: input.eventYear, published: true, uri: ref.uri });

        // Persisted after every successful post, not just at the end - see function doc comment.
        await uploadStoryDb(handle, logger, dbPath);
        await sleep(DELAY_BETWEEN_LIVE_POSTS_MS);
      } catch (err) {
        const reason = `Failed to publish ${label}: ${err instanceof Error ? err.message : String(err)}`;
        logger.error("post-sample-batch", reason);
        results.push({ festivalName: input.festivalName, eventYear: input.eventYear, published: false, uri: null, reason });
      }
    }

    const publishedCount = results.filter((r) => r.published).length;
    finishHourlyRun(db, hourlyRun.id, {
      status: "success",
      quiet_hours_outcome: null,
      candidates_found: inputs.length,
      candidates_rejected: inputs.length - publishedCount,
      publish_status: options.dryRun ? "dry_run" : publishedCount > 0 ? "published" : "skipped",
    });

    return results;
  } finally {
    closeStoryDb(db);
    if (options.dryRun) {
      logger.info("post-sample-batch", "Dry run: not persisting story database changes back to R2");
    }
    // In a live run every successful post already persisted its own progress above; this final upload
    // only matters if the very last item(s) were skips/failures with nothing left to persist since.
  }
}
