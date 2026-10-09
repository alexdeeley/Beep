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
import { createBlueskySession, postImageMessage } from "../../bluesky/threadPublish.js";
import { extractPosterImage } from "./extractPosterImage.js";
import { buildAltText } from "./postFestivalPosters.js";
import type { VerifiedFestivalPoster } from "../types.js";

export interface SampleFestivalInput {
  festivalName: string;
  eventYear: number | null;
  /** A short, factual, already-corroborated sentence - the account owner's own manual research stands in for verifyFestivalPosters.ts here, since discovery/verification are skipped entirely. */
  blurb: string;
  lineupArtists: string[];
  /** The page extractPosterImage mechanically fetches and parses - never a hand-picked image URL. Should be a real, already-corroborated announcement page (the festival's own site, or press coverage), same bar verifyFestivalPosters.ts would apply. */
  primarySourceUrl: string;
}

export interface PostSampleFestivalResult {
  published: boolean;
  uri: string | null;
  reason?: string;
}

/**
 * Manually posts a single, already-researched festival poster, bypassing discovery/verification -
 * for curating specific sample/demo posts (e.g. "use Primavera Sound for our first poster-only-style
 * post") rather than waiting on the autonomous pipeline's own web search to happen to surface it.
 *
 * Deliberately NOT a shortcut around the pipeline's own integrity rules: the poster image is still only
 * ever the real, mechanically-extracted bytes from extractPosterImage.ts (never a hand-picked image
 * URL), and this still participates in the same per-edition idempotency (db/festivalPostersRepo.ts) and
 * audit trail (db/postsRepo.ts) as a normal cycle, so the autonomous pipeline won't later re-discover
 * and duplicate-post the same festival edition.
 */
export async function postSampleFestival(
  config: AppConfig,
  input: SampleFestivalInput,
  options: { dryRun: boolean }
): Promise<PostSampleFestivalResult> {
  const runDir = join(config.paths.runsDir, "news", `post-sample-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const logger = new RunLogger(runDir);

  const tempDir = mkdtempSync(join(tmpdir(), "newswire-db-"));
  const dbPath = join(tempDir, "story.db");
  const handle = await downloadStoryDb(config, logger, dbPath);
  const db = openStoryDb(dbPath);

  try {
    const hourlyRun = startHourlyRun(db, options.dryRun);

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
      const reason = `"${item.festivalName}"${item.eventYear ? ` ${item.eventYear}` : ""} is already recorded as posted - skipping to avoid a duplicate`;
      logger.warn("post-sample", reason);
      finishHourlyRun(db, hourlyRun.id, {
        status: "success",
        quiet_hours_outcome: null,
        candidates_found: 1,
        candidates_rejected: 1,
        publish_status: "skipped",
      });
      return { published: false, uri: null, reason };
    }

    const image = await extractPosterImage(logger, input.primarySourceUrl, item.festivalName);
    if (!image) {
      const reason = `Could not mechanically extract a poster image for "${item.festivalName}" from ${input.primarySourceUrl}`;
      finishHourlyRun(db, hourlyRun.id, {
        status: "success",
        quiet_hours_outcome: null,
        candidates_found: 1,
        candidates_rejected: 1,
        publish_status: "skipped",
      });
      return { published: false, uri: null, reason };
    }

    const altText = buildAltText(item);

    if (options.dryRun) {
      logger.info(
        "post-sample",
        `Dry run: would publish poster image for "${item.festivalName}" (${image.imageBytes.length} bytes from ${image.imageUrl})`,
        { altText }
      );
      finishHourlyRun(db, hourlyRun.id, {
        status: "success",
        quiet_hours_outcome: null,
        candidates_found: 1,
        candidates_rejected: 0,
        publish_status: "dry_run",
      });
      return { published: false, uri: null };
    }

    const session = await createBlueskySession(config);
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
    logger.info("post-sample", `Published: ${ref.uri}`);
    finishHourlyRun(db, hourlyRun.id, {
      status: "success",
      quiet_hours_outcome: null,
      candidates_found: 1,
      candidates_rejected: 0,
      publish_status: "published",
    });

    return { published: true, uri: ref.uri };
  } finally {
    closeStoryDb(db);
    if (!options.dryRun) {
      await uploadStoryDb(handle, logger, dbPath);
    } else {
      logger.info("post-sample", "Dry run: not persisting story database changes back to R2");
    }
  }
}
