import { getPlaylistTracks } from "./getPlaylistTracks.js";
import { getSeenPlaylistTrackCount, hasSeenPlaylistTrack, recordSeenPlaylistTrack } from "../db/spotifyPlaylistRepo.js";
import { createBlueskySession, postThreadMessage, buildLinkFacet } from "../../bluesky/threadPublish.js";
import { insertBlueskyPost } from "../db/postsRepo.js";
import { contentHash } from "../duplicateCheck/duplicateCheckEdition.js";
import type { NewsRunContext } from "../runContext.js";
import type { PlaylistTrack } from "./getPlaylistTracks.js";

const TAG = "playlist-watch";

/** Exported for unit testing. */
export function buildPostText(track: PlaylistTrack): string {
  return `NEW SINGLE: ${track.artistCredit} - ${track.name}\n\n${track.url}`;
}

interface PendingPost {
  playlistId: string;
  track: PlaylistTrack;
}

/**
 * Reads one playlist and returns the tracks that should post this cycle. Handles the first-ever-check
 * baseline seeding itself (records everything currently present as "seen" without returning any of it),
 * so the caller only ever sees genuinely new additions.
 */
function collectNewTracks(ctx: NewsRunContext, playlistId: string, tracks: PlaylistTrack[]): PlaylistTrack[] {
  const isFirstCheck = getSeenPlaylistTrackCount(ctx.db, playlistId) === 0;
  if (isFirstCheck) {
    for (const track of tracks) {
      recordSeenPlaylistTrack(ctx.db, { playlistId, trackId: track.trackId, postedInRunId: null });
    }
    ctx.logger.info(TAG, `First check for playlist ${playlistId} - seeded ${tracks.length} existing track(s) as baseline, nothing posted`);
    return [];
  }
  return tracks.filter((t) => !hasSeenPlaylistTrack(ctx.db, playlistId, t.trackId));
}

/**
 * Monitors every playlist in config.news.newSinglesPlaylistIds and posts a mechanical "NEW SINGLE" for
 * each track added to any of them since its last check - directly built from the track's own Spotify
 * metadata, never through the writer/copy-edit/fact-check pipeline, since "this track is now on the
 * playlist" is a fact directly checkable against Spotify's own data, not a news claim needing
 * independent web-search corroboration the way everything else in this pipeline does.
 *
 * Each playlist is read via getPlaylistTracks.ts's embed-page scrape, NOT the official Spotify Web API -
 * this account's Spotify developer account no longer has access to self-serve API credentials, so the
 * Client Credentials flow lookupTrack.ts uses isn't an option here. No API key of any kind is needed
 * for this feature.
 *
 * Each playlist's first-ever check seeds every currently-present track as a "seen" baseline WITHOUT
 * posting anything - the point is catching new additions going forward, not retroactively announcing
 * the playlist's entire existing history. From the next check on, only genuinely new tracks post.
 * Playlists are tracked independently (the seen-table is keyed by playlist + track ID), so adding a
 * second playlist doesn't touch the first one's history.
 *
 * Every new track across every playlist posts as its own independent post (never threaded together -
 * unrelated singles sharing a reply chain would read as a non-sequitur, same reasoning as
 * publishMusicItems.ts), and is recorded as seen immediately after a successful post, so a mid-batch
 * failure leaves an accurate record and the next cycle only retries what didn't go out.
 *
 * A no-op (0, no DB/network beyond the initial playlist reads) when newSinglesPlaylistIds is empty.
 * Returns the number of physical posts actually published.
 */
export async function postPlaylistAdditions(ctx: NewsRunContext): Promise<number> {
  const playlistIds = ctx.config.news.newSinglesPlaylistIds;
  if (playlistIds.length === 0) return 0;

  const pending: PendingPost[] = [];
  for (const playlistId of playlistIds) {
    const tracks = await getPlaylistTracks(ctx.logger, playlistId);
    if (tracks.length === 0) {
      ctx.logger.info(TAG, `No tracks read from playlist ${playlistId} this cycle (empty, unavailable, or not public)`);
      continue;
    }
    for (const track of collectNewTracks(ctx, playlistId, tracks)) {
      pending.push({ playlistId, track });
    }
  }

  if (pending.length === 0) return 0;

  ctx.logger.info(TAG, `${pending.length} new track(s) found across ${playlistIds.length} watched playlist(s) since the last check`);

  if (ctx.dryRun) {
    let position = 0;
    for (const { playlistId, track } of pending) {
      const text = buildPostText(track);
      ctx.logger.info(TAG, `Dry run: would publish "${text}"`);
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
      recordSeenPlaylistTrack(ctx.db, { playlistId, trackId: track.trackId, postedInRunId: ctx.hourlyRunId });
    }
    return pending.length;
  }

  if (!ctx.config.bluesky.identifier || !ctx.config.bluesky.appPassword) {
    ctx.logger.warn(TAG, "BLUESKY_IDENTIFIER / BLUESKY_APP_PASSWORD not configured; skipping");
    return 0;
  }

  const session = await createBlueskySession(ctx.config);
  let published = 0;
  let position = 0;

  for (const { playlistId, track } of pending) {
    const text = buildPostText(track);
    const facet = track.url ? buildLinkFacet(text, track.url) : null;
    try {
      const ref = await postThreadMessage(ctx.config, ctx.logger, session, {
        text,
        reply: null,
        facets: facet ? [facet] : undefined,
      });
      insertBlueskyPost(ctx.db, {
        runId: ctx.hourlyRunId,
        threadPosition: position++,
        text,
        contentHash: contentHash(text),
        uri: ref.uri,
        cid: ref.cid,
        rootUri: ref.uri,
        parentUri: ref.uri,
        dryRun: false,
      });
      recordSeenPlaylistTrack(ctx.db, { playlistId, trackId: track.trackId, postedInRunId: ctx.hourlyRunId });
      ctx.logger.info(TAG, `Published: ${ref.uri}`);
      published++;
    } catch (err) {
      ctx.logger.error(TAG, `Failed to publish "${text}" - will retry next cycle`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return published;
}
