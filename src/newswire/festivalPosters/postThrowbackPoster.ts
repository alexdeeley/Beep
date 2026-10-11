import { discoverThrowbackPoster } from "../discovery/discoverThrowbackPoster.js";
import { verifyThrowbackPoster } from "../verification/verifyThrowbackPoster.js";
import { extractPosterImage } from "./extractPosterImage.js";
import { buildAltText } from "./postFestivalPosters.js";
import { buildThrowbackKey, hasPostedFestivalPoster, recordFestivalPosterPost, getRecentThrowbackPosts } from "../db/festivalPostersRepo.js";
import { createBlueskySession, postImageMessage, type BlueskySession } from "../../bluesky/threadPublish.js";
import { insertBlueskyPost } from "../db/postsRepo.js";
import { contentHash } from "../contentHash.js";
import type { NewsRunContext } from "../runContext.js";
import type { VerifiedFestivalPoster } from "../types.js";

const TAG = "throwback-poster";

const RECENT_THROWBACK_LOOKBACK = 25;

/**
 * Weekly ("Throwback Thursday") counterpart to postFestivalPosters.ts: instead of hunting for a lineup
 * just announced in the last 7 days, this picks ONE real, historically notable festival poster from any
 * past year and reposts its own original artwork - same image-only posting convention, same mechanical
 * (never LLM-reported) image extraction via extractPosterImage.ts, same 2-source verification bar, but a
 * separate dedup namespace (db/festivalPostersRepo.ts's buildThrowbackKey) so this never collides with the
 * live announcement pipeline's own record of the same festival/year.
 *
 * A no-op (0, no Bluesky calls) when nothing clears the bar this week - never guesses. Returns the number
 * of physical posts actually published (0 or 1; there is only ever one throwback candidate per cycle).
 */
export async function postThrowbackPoster(ctx: NewsRunContext): Promise<number> {
  const alreadyFeatured = getRecentThrowbackPosts(ctx.db, RECENT_THROWBACK_LOOKBACK).map((r) => r.festival_name);

  const candidate = await discoverThrowbackPoster(ctx, alreadyFeatured);
  if (!candidate) return 0;

  const verified = await verifyThrowbackPoster(ctx, candidate);
  if (!verified) return 0;

  const key = buildThrowbackKey(verified.festivalName, verified.eventYear);
  if (hasPostedFestivalPoster(ctx.db, key)) {
    ctx.logger.info(TAG, `"${verified.festivalName}" ${verified.eventYear} already featured as a throwback - skipping`);
    return 0;
  }

  if (!verified.primarySourceUrl) {
    ctx.logger.warn(TAG, `No primary source URL for "${verified.festivalName}" ${verified.eventYear} - can't extract a poster image, skipping`);
    return 0;
  }

  const image = await extractPosterImage(ctx.logger, verified.primarySourceUrl, verified.festivalName);
  if (!image) return 0; // already logged inside extractPosterImage; left unrecorded so a later cycle retries

  // Reuses VerifiedFestivalPoster's shape purely so buildAltText can be shared - headline/facts aren't
  // used by buildAltText and are meaningless for a throwback post, so they're left blank.
  const item: VerifiedFestivalPoster = {
    festivalName: verified.festivalName,
    eventYear: verified.eventYear,
    headline: "",
    blurb: verified.blurb,
    lineupArtists: verified.lineupArtists,
    primarySourceUrl: verified.primarySourceUrl,
    facts: [],
    meetsSourceBar: true,
  };
  const altText = buildAltText(item, "THROWBACK THURSDAY");

  if (ctx.dryRun) {
    ctx.logger.info(
      TAG,
      `Dry run: would publish throwback poster for "${verified.festivalName}" ${verified.eventYear} (${image.imageBytes.length} bytes from ${image.imageUrl})`,
      { altText }
    );
    insertBlueskyPost(ctx.db, {
      runId: ctx.hourlyRunId,
      threadPosition: 0,
      text: altText,
      contentHash: contentHash(altText),
      uri: null,
      cid: null,
      rootUri: null,
      parentUri: null,
      dryRun: true,
    });
    recordFestivalPosterPost(ctx.db, { festivalKey: key, festivalName: verified.festivalName, postedInRunId: ctx.hourlyRunId });
    return 1;
  }

  if (!ctx.config.bluesky.identifier || !ctx.config.bluesky.appPassword) {
    ctx.logger.warn(TAG, "BLUESKY_IDENTIFIER / BLUESKY_APP_PASSWORD not configured; skipping");
    return 0;
  }

  let session: BlueskySession | null = null;
  try {
    session = await createBlueskySession(ctx.config);
    const ref = await postImageMessage(ctx.config, ctx.logger, session, {
      text: "",
      altText,
      imageBytes: image.imageBytes,
      mimeType: image.mimeType,
    });
    insertBlueskyPost(ctx.db, {
      runId: ctx.hourlyRunId,
      threadPosition: 0,
      text: altText,
      contentHash: contentHash(altText),
      uri: ref.uri,
      cid: ref.cid,
      rootUri: ref.uri,
      parentUri: ref.uri,
      dryRun: false,
    });
    recordFestivalPosterPost(ctx.db, { festivalKey: key, festivalName: verified.festivalName, postedInRunId: ctx.hourlyRunId });
    ctx.logger.info(TAG, `Published: ${ref.uri}`);
    return 1;
  } catch (err) {
    ctx.logger.error(TAG, `Failed to publish throwback poster for "${verified.festivalName}" ${verified.eventYear} - will retry next cycle`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}
