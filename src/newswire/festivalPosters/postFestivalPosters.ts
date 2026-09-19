import { discoverFestivalPosters } from "../discovery/discoverFestivalPosters.js";
import { verifyFestivalPosters } from "../verification/verifyFestivalPosters.js";
import { extractPosterImage } from "./extractPosterImage.js";
import { buildFestivalKey, hasPostedFestivalPoster, recordFestivalPosterPost } from "../db/festivalPostersRepo.js";
import { createBlueskySession, postImageMessage, type BlueskySession } from "../../bluesky/threadPublish.js";
import { insertBlueskyPost } from "../db/postsRepo.js";
import { contentHash } from "../duplicateCheck/duplicateCheckEdition.js";
import { countGraphemes } from "../publishing/threadSplitter.js";
import { BLUESKY_MAX_POST_GRAPHEMES } from "../../bluesky/threadPublish.js";
import type { NewsRunContext } from "../runContext.js";
import type { VerifiedFestivalPoster } from "../types.js";

const TAG = "festival-posters";

/** Exported for unit testing. Truncates the blurb (never the header) if the combined text would exceed Bluesky's post limit - real festival lineups can list many headliners. */
export function buildPostText(item: VerifiedFestivalPoster): string {
  const label = item.eventYear ? `${item.festivalName} ${item.eventYear}` : item.festivalName;
  const header = `FESTIVAL LINEUP: ${label}\n\n`;
  const blurb = item.blurb!;
  const full = `${header}${blurb}`;
  if (countGraphemes(full) <= BLUESKY_MAX_POST_GRAPHEMES) return full;

  const budget = BLUESKY_MAX_POST_GRAPHEMES - countGraphemes(header) - 1; // -1 for the trailing ellipsis char
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(blurb)].map((s) => s.segment);
  return `${header}${graphemes.slice(0, Math.max(0, budget)).join("")}…`;
}

/**
 * Every cycle, searches industry-wide for major music festivals that have just announced their
 * lineup/poster - "major" is an LLM judgment call (see discovery/festivalPostersPrompts.ts's high bar
 * and calibration examples), not a fixed watchlist. Unlike the daily recaps above, this is NOT a
 * once-a-day digest: each distinct festival edition (see db/festivalPostersRepo.ts's festival_key) gets
 * its own standalone post as soon as it's found, and there is no cap on how many can post in one cycle.
 *
 * Posts the festival's OWN official poster image, not a generated graphic. The image is never sourced
 * from anything the model reports directly - verifyFestivalPosters.ts only confirms the announcement is
 * real and picks the single most authoritative source URL (preferring the festival's own site);
 * extractPosterImage.ts then does a plain HTTP fetch of that exact URL and mechanically parses its
 * og:image/twitter:image meta tag, so the image that gets posted is always something that genuinely,
 * verifiably exists at a URL a real page actually links to - never a hallucinated one. If no image can
 * be mechanically extracted (missing meta tag, wrong content-type, too large for Bluesky, network
 * failure), that item is simply skipped and left unrecorded, so a later cycle can retry rather than
 * posting nothing or posting something guessed.
 *
 * Reposting a festival's own promotional artwork is a deliberate choice made explicitly by the account
 * owner (this pipeline never posts anything without independent 2-source verification that the
 * announcement itself is real) - see README §18.15.
 *
 * A no-op (0, no Bluesky calls) when nothing new is found. Returns the number of physical posts actually
 * published.
 */
export async function postFestivalPosters(ctx: NewsRunContext): Promise<number> {
  const candidates = await discoverFestivalPosters(ctx);
  const verified = await verifyFestivalPosters(ctx, candidates);
  if (verified.length === 0) return 0;

  const newItems = verified.filter((v) => !hasPostedFestivalPoster(ctx.db, buildFestivalKey(v.festivalName, v.eventYear)));
  if (newItems.length === 0) return 0;

  ctx.logger.info(TAG, `${newItems.length} new major festival lineup announcement(s) found`);

  if (!ctx.dryRun && (!ctx.config.bluesky.identifier || !ctx.config.bluesky.appPassword)) {
    ctx.logger.warn(TAG, "BLUESKY_IDENTIFIER / BLUESKY_APP_PASSWORD not configured; skipping");
    return 0;
  }

  let session: BlueskySession | null = null;
  let published = 0;

  for (const item of newItems) {
    if (!item.primarySourceUrl) {
      ctx.logger.warn(TAG, `No primary source URL for "${item.festivalName}" - can't extract a poster image, skipping`);
      continue;
    }

    const image = await extractPosterImage(ctx.logger, item.primarySourceUrl);
    if (!image) continue; // already logged inside extractPosterImage; left unrecorded so a later cycle retries

    const key = buildFestivalKey(item.festivalName, item.eventYear);
    const text = buildPostText(item);

    if (ctx.dryRun) {
      ctx.logger.info(
        TAG,
        `Dry run: would publish poster image for "${item.festivalName}" (${image.imageBytes.length} bytes from ${image.imageUrl})`,
        { text }
      );
      insertBlueskyPost(ctx.db, {
        runId: ctx.hourlyRunId,
        threadPosition: 0,
        text,
        contentHash: contentHash(text),
        uri: null,
        cid: null,
        rootUri: null,
        parentUri: null,
        dryRun: true,
      });
      recordFestivalPosterPost(ctx.db, { festivalKey: key, festivalName: item.festivalName, postedInRunId: ctx.hourlyRunId });
      published++;
      continue;
    }

    try {
      session = session ?? (await createBlueskySession(ctx.config));
      const ref = await postImageMessage(ctx.config, ctx.logger, session, {
        text,
        altText: text,
        imageBytes: image.imageBytes,
        mimeType: image.mimeType,
      });
      insertBlueskyPost(ctx.db, {
        runId: ctx.hourlyRunId,
        threadPosition: 0,
        text,
        contentHash: contentHash(text),
        uri: ref.uri,
        cid: ref.cid,
        rootUri: ref.uri,
        parentUri: ref.uri,
        dryRun: false,
      });
      recordFestivalPosterPost(ctx.db, { festivalKey: key, festivalName: item.festivalName, postedInRunId: ctx.hourlyRunId });
      ctx.logger.info(TAG, `Published: ${ref.uri}`);
      published++;
    } catch (err) {
      ctx.logger.error(TAG, `Failed to publish poster for "${item.festivalName}" - will retry next cycle`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return published;
}
