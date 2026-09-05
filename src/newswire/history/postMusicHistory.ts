import { DateTime } from "luxon";
import { hasHistoryPostForDate, recordHistoryPost } from "../db/historyPostsRepo.js";
import { buildMultiLinePost } from "../publishing/multiPostChunker.js";
import { publishStandalonePostThread } from "../publishing/publishStandalonePostThread.js";
import { discoverMusicHistory } from "../discovery/discoverMusicHistory.js";
import { verifyMusicHistory } from "../verification/verifyMusicHistory.js";
import type { NewsRunContext } from "../runContext.js";

const HEADER_LABEL = "TODAY IN HISTORY";
const TAG = "music-history";

/**
 * Once a day - the first cycle that finds at least one independently
 * verifiable "on this day in music history" event - posts a
 * "TODAY IN HISTORY <date>" thread, one `<year>: <event>` line per entry,
 * sorted chronologically. Built directly from verified facts (like the
 * Friday roundup), so it skips the writer/copy-edit/fact-check stages
 * entirely.
 *
 * A no-op if a history post already went out today, or if nothing turns
 * up independently verifiable for today's date (in which case no post is
 * recorded, so a later cycle the same day can retry - accuracy comes
 * before "always post something").
 */
export async function postMusicHistory(ctx: NewsRunContext): Promise<void> {
  const dt = DateTime.fromJSDate(ctx.now, { zone: ctx.editorialFocus.quietHours.timezone });
  const postDate = dt.toISODate()!;
  if (hasHistoryPostForDate(ctx.db, postDate)) return;

  const candidates = await discoverMusicHistory(ctx, dt);
  const verified = await verifyMusicHistory(ctx, candidates);

  if (verified.length === 0) {
    ctx.logger.info(TAG, "No independently verifiable music-history events found for today - staying silent, will retry later today");
    return;
  }

  const sorted = [...verified].sort((a, b) => a.year - b.year);
  const header = `${HEADER_LABEL} ${dt.toFormat("M/d")}`;
  const lines = sorted.map((v) => `${v.year}: ${v.eventDescription}`);
  const posts = buildMultiLinePost(header, lines);

  const publishedAny = await publishStandalonePostThread(ctx, TAG, posts);
  if (publishedAny) {
    recordHistoryPost(ctx.db, { postDate, postedInRunId: ctx.hourlyRunId, itemCount: sorted.length });
    ctx.logger.info(TAG, `${HEADER_LABEL} posted: ${sorted.length} item(s) across ${posts.length} post(s)`);
  }
}
