import { DateTime } from "luxon";
import { createBlueskySession, postThreadMessage, BLUESKY_MAX_POST_GRAPHEMES, type PostRef } from "../../bluesky/threadPublish.js";
import { insertBlueskyPost } from "../db/postsRepo.js";
import { getUnpostedAlbumItems, markMusicItemPosted, normalizeHeadline } from "../db/musicItemsRepo.js";
import {
  getUnpostedIndustryReleaseItems,
  insertIndustryReleaseItem,
  markIndustryReleaseItemPosted,
} from "../db/industryReleaseItemsRepo.js";
import { hasRoundupForDate, recordRoundupRun } from "../db/weeklyRoundupRepo.js";
import { contentHash } from "../duplicateCheck/duplicateCheckEdition.js";
import { countGraphemes } from "../publishing/threadSplitter.js";
import { discoverIndustryReleases } from "../discovery/discoverIndustryReleases.js";
import { verifyIndustryReleases } from "../verification/verifyIndustryReleases.js";
import type { NewsRunContext } from "../runContext.js";
import type { VerifiedIndustryRelease } from "../types.js";

const HEADER = "WEEKLY NEW RELEASES";
const FRIDAY_ISO_WEEKDAY = 5;

/** One roundup-eligible item, from either pool - carries just enough to build a line and mark it posted afterward. */
interface RoundupItem {
  source: "watchlist" | "industry";
  id: number;
  artistName: string;
  line: string;
}

/** Chunks the roundup into grapheme-safe physical posts - the header only on the first post, one album per line, never splitting a line across posts. Throws if a single line alone exceeds the limit (should never happen for a headline-length line, but fail loudly rather than truncate). */
export function buildRoundupPosts(header: string, lines: string[], maxGraphemes: number = BLUESKY_MAX_POST_GRAPHEMES): string[] {
  if (countGraphemes(header) > maxGraphemes) {
    throw new Error(`The roundup header alone exceeds ${maxGraphemes} graphemes: "${header}"`);
  }

  const posts: string[] = [];
  let current = header;

  for (const line of lines) {
    if (countGraphemes(line) > maxGraphemes) {
      throw new Error(`A single roundup line exceeds ${maxGraphemes} graphemes: "${line.slice(0, 80)}..."`);
    }
    const candidate = `${current}\n${line}`;
    if (countGraphemes(candidate) <= maxGraphemes) {
      current = candidate;
    } else {
      posts.push(current);
      current = line;
    }
  }
  posts.push(current);
  return posts;
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
 * Once a week - the first hourly cycle on a Friday, local time, at or
 * after NEWS_WEEKLY_ROUNDUP_HOUR_LOCAL, that finds at least one unposted
 * major release - compiles everything accumulated since the last roundup
 * into one WEEKLY NEW RELEASES thread, rather than posting each album
 * individually as the hourly per-item flow does for singles/news.
 *
 * The roundup is industry-wide, not limited to watched-artists.txt: on
 * top of any watchlist album/EP/compilation items accumulated this week
 * (getUnpostedAlbumItems), it runs its own independent web-search sweep
 * (discoverIndustryReleases/verifyIndustryReleases) for major releases
 * across the whole music industry, New-Music-Friday style.
 *
 * A no-op on any other day, before the configured hour, if a roundup
 * already posted today, or if there's simply nothing to report yet (in
 * which case no roundup is recorded, so a later hour the same Friday can
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
    ...watchlistItems.map((i) => ({ source: "watchlist" as const, id: i.id, artistName: i.artist_name, line: `- ${i.artist_name}: ${i.headline}` })),
    ...dedupedIndustry.map((i) => ({ source: "industry" as const, id: i.id, artistName: i.artist_name, line: `- ${i.artist_name}: ${i.headline}` })),
  ];

  if (items.length === 0) {
    ctx.logger.info(
      "weekly-roundup",
      "Friday, but no major releases found (watchlist or industry-wide) - staying silent, will keep checking later today"
    );
    return;
  }

  const posts = buildRoundupPosts(HEADER, items.map((i) => i.line));

  if (ctx.dryRun) {
    ctx.logger.info("weekly-roundup", `Dry run: would publish WEEKLY NEW RELEASES (${items.length} item(s), ${posts.length} post(s))`, {
      posts,
    });
    let position = 0;
    for (const text of posts) {
      insertBlueskyPost(ctx.db, {
        runId: ctx.hourlyRunId,
        threadPosition: position++,
        text,
        contentHash: contentHash(text),
        uri: null,
        cid: null,
        rootUri: null,
        parentUri: null,
        dryRun: true,
      });
    }
    markAllPosted(ctx, items);
    recordRoundupRun(ctx.db, { roundupDate, postedInRunId: ctx.hourlyRunId, itemCount: items.length });
    return;
  }

  if (!ctx.config.bluesky.identifier || !ctx.config.bluesky.appPassword) {
    ctx.logger.warn("weekly-roundup", "BLUESKY_IDENTIFIER / BLUESKY_APP_PASSWORD not configured; skipping WEEKLY NEW RELEASES");
    return;
  }

  const session = await createBlueskySession(ctx.config);
  let root: PostRef | null = null;
  let parent: PostRef | null = null;
  let position = 0;
  let publishedAny = false;

  for (const text of posts) {
    try {
      const ref = await postThreadMessage(ctx.config, ctx.logger, session, {
        text,
        reply: root && parent ? { root, parent } : null,
      });
      root = root ?? ref;
      parent = ref;
      publishedAny = true;

      insertBlueskyPost(ctx.db, {
        runId: ctx.hourlyRunId,
        threadPosition: position++,
        text,
        contentHash: contentHash(text),
        uri: ref.uri,
        cid: ref.cid,
        rootUri: root.uri,
        parentUri: parent.uri,
        dryRun: false,
      });
      ctx.logger.info("weekly-roundup", `Published: ${ref.uri}`);
    } catch (err) {
      ctx.logger.error("weekly-roundup", "WEEKLY NEW RELEASES thread stopped partway through after a failure", {
        error: err instanceof Error ? err.message : String(err),
      });
      break;
    }
  }

  if (publishedAny) {
    markAllPosted(ctx, items);
    recordRoundupRun(ctx.db, { roundupDate, postedInRunId: ctx.hourlyRunId, itemCount: items.length });
    ctx.logger.info("weekly-roundup", `WEEKLY NEW RELEASES posted: ${items.length} item(s) across ${posts.length} post(s)`);
  }
}
