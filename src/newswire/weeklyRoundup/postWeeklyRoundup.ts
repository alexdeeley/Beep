import { DateTime } from "luxon";
import { getUnpostedAlbumItems, markMusicItemPosted, normalizeHeadline } from "../db/musicItemsRepo.js";
import {
  getUnpostedIndustryReleaseItems,
  insertIndustryReleaseItem,
  markIndustryReleaseItemPosted,
} from "../db/industryReleaseItemsRepo.js";
import { hasRoundupForDate, recordRoundupRun } from "../db/weeklyRoundupRepo.js";
import { buildCommaSeparatedPost } from "../publishing/multiPostChunker.js";
import { publishStandalonePostThread } from "../publishing/publishStandalonePostThread.js";
import { discoverIndustryReleases } from "../discovery/discoverIndustryReleases.js";
import { verifyIndustryReleases } from "../verification/verifyIndustryReleases.js";
import type { NewsRunContext } from "../runContext.js";
import type { VerifiedIndustryRelease } from "../types.js";

const HEADER_LABEL = "NEW MUSIC FRIDAY";
const FRIDAY_ISO_WEEKDAY = 5;
const TAG = "weekly-roundup";

/** One roundup-eligible item, from either pool - carries just enough to print its name and mark it posted afterward. */
interface RoundupItem {
  source: "watchlist" | "industry";
  id: number;
  artistName: string;
}

/** Persists a verified industry-wide candidate as an industry_release_items row, mirroring runNewswireCycle.ts's persistVerifiedItem. */
function persistVerifiedIndustryItem(ctx: NewsRunContext, verified: VerifiedIndustryRelease): void {
  const primaryFact = verified.facts.find((f) => f.sources.some((s) => s.isPrimary)) ?? verified.facts[0];
  if (!primaryFact) return;
  const primarySource = primaryFact.sources.find((s) => s.isPrimary) ?? primaryFact.sources[0];
  if (!primarySource) return;

  const domains = new Set<string>();
  for (const fact of verified.facts) for (const s of fact.sources) domains.add(s.domain.toLowerCase());

  insertIndustryReleaseItem(ctx.db, {
    artistName: verified.artistName,
    releaseFormat: verified.releaseFormat,
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
}

function markAllPosted(ctx: NewsRunContext, items: RoundupItem[]): void {
  for (const item of items) {
    if (item.source === "watchlist") markMusicItemPosted(ctx.db, item.id, ctx.hourlyRunId);
    else markIndustryReleaseItemPosted(ctx.db, item.id, ctx.hourlyRunId);
  }
}

/**
 * Once a week - the first cycle on a Friday, local time, at or after
 * NEWS_WEEKLY_ROUNDUP_HOUR_LOCAL, that finds at least one unposted major
 * release - posts a simple "NEW MUSIC FRIDAY <date>" thread listing every
 * artist with a major album/EP/compilation out, comma-separated, rather
 * than posting each one individually as the hourly per-item flow does for
 * singles/news.
 *
 * The roundup is industry-wide, not limited to watched-artists.txt: on
 * top of any watchlist album/EP/compilation items accumulated this week
 * (getUnpostedAlbumItems), it runs its own independent web-search sweep
 * (discoverIndustryReleases/verifyIndustryReleases) for major releases
 * across the whole music industry, New-Music-Friday style.
 *
 * A no-op on any other day, before the configured hour, if a roundup
 * already posted today, or if there's simply nothing to report yet (in
 * which case no roundup is recorded, so a later cycle the same Friday can
 * still pick up anything discovered since - see weeklyRoundupRepo.ts).
 */
export async function postWeeklyRoundup(ctx: NewsRunContext): Promise<void> {
  const dt = DateTime.fromJSDate(ctx.now, { zone: ctx.editorialFocus.quietHours.timezone });
  if (dt.weekday !== FRIDAY_ISO_WEEKDAY || dt.hour < ctx.config.news.weeklyRoundupHourLocal) return;

  const roundupDate = dt.toISODate()!;
  if (hasRoundupForDate(ctx.db, roundupDate)) return;

  const industryCandidates = await discoverIndustryReleases(ctx);
  const verifiedIndustry = await verifyIndustryReleases(ctx, industryCandidates);
  for (const item of verifiedIndustry) persistVerifiedIndustryItem(ctx, item);

  // Priority artists (editorial-focus.json's priorityArtists) never wait for the roundup - the hourly
  // orchestrator posts their albums immediately instead (see runNewswireCycle.ts), so exclude them here
  // from both pools.
  const priorityNames = new Set(ctx.editorialFocus.priorityArtists);
  const watchlistItems = getUnpostedAlbumItems(ctx.db).filter((item) => !priorityNames.has(item.artist_name));
  const industryItems = getUnpostedIndustryReleaseItems(ctx.db).filter((item) => !priorityNames.has(item.artist_name));

  // An artist on the personal watchlist may also turn up via the industry-wide sweep - keep the
  // watchlist version (already independently tracked per-artist) and drop the industry duplicate.
  const watchlistKeys = new Set(watchlistItems.map((i) => `${normalizeHeadline(i.artist_name)}|${normalizeHeadline(i.headline)}`));
  const dedupedIndustry = industryItems.filter(
    (i) => !watchlistKeys.has(`${normalizeHeadline(i.artist_name)}|${normalizeHeadline(i.headline)}`)
  );

  const items: RoundupItem[] = [
    ...watchlistItems.map((i) => ({ source: "watchlist" as const, id: i.id, artistName: i.artist_name })),
    ...dedupedIndustry.map((i) => ({ source: "industry" as const, id: i.id, artistName: i.artist_name })),
  ];

  if (items.length === 0) {
    ctx.logger.info(TAG, "Friday, but no major releases found (watchlist or industry-wide) - staying silent, will keep checking later today");
    return;
  }

  const header = `${HEADER_LABEL} ${dt.toFormat("M/d/yy")}`;
  const posts = buildCommaSeparatedPost(header, items.map((i) => i.artistName));

  const publishedAny = await publishStandalonePostThread(ctx, TAG, posts);
  if (publishedAny) {
    markAllPosted(ctx, items);
    recordRoundupRun(ctx.db, { roundupDate, postedInRunId: ctx.hourlyRunId, itemCount: items.length });
    ctx.logger.info(TAG, `${HEADER_LABEL} posted: ${items.length} item(s) across ${posts.length} post(s)`);
  }
}
