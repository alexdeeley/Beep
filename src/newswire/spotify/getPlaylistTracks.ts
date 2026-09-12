import type { RunLogger } from "../../utils/logger.js";

/**
 * Reads a PUBLIC playlist's tracks via Spotify's public embed page
 * (open.spotify.com/embed/playlist/<id>), NOT the official Web API -
 * Spotify's developer platform no longer grants new self-serve API
 * credentials to this account, so the Client Credentials flow
 * spotifyAuth.ts uses for lookupTrack.ts isn't available here.
 *
 * The embed page (the same one sites use to embed a Spotify player) is
 * a Next.js app that hydrates from a `__NEXT_DATA__` <script> tag
 * containing the playlist's track list as plain JSON - no login, no API
 * key, no rate-limit-sensitive OAuth. Confirmed live: this works for any
 * plain public playlist and returns the full list (tested up to 100
 * tracks on a well-known editorial playlist with no truncation observed
 * below that), but does NOT work for a private or
 * personalized/algorithmic playlist (Discover Weekly, Release Radar,
 * etc.) - those need the owner's own login regardless of which endpoint
 * is used.
 *
 * This is an UNOFFICIAL, undocumented endpoint - Spotify makes no
 * stability guarantee for it, unlike the real Web API. It's the same
 * mechanism powering embedded players across the entire web, so it's
 * about as stable as an unofficial endpoint gets, but if Spotify ever
 * changes the embed page's markup this will start failing. That failure
 * is always graceful (see below), never a crash.
 */

const EMBED_URL_PREFIX = "https://open.spotify.com/embed/playlist/";
/** If a fetch ever returns exactly this many tracks, the real playlist may have more - the cap (if any) on this undocumented endpoint hasn't been confirmed beyond this count. Logged as a heads-up, not an error. */
const SUSPECTED_TRUNCATION_THRESHOLD = 100;

export interface PlaylistTrack {
  trackId: string;
  name: string;
  /** Spotify's own already-formatted artist credit (e.g. "Artist A, Artist B") - used as-is rather than re-splitting and rejoining a string. */
  artistCredit: string;
  url: string;
}

interface NextDataTrackListItem {
  uri: string;
  title: string;
  subtitle: string;
}

interface NextDataShape {
  props?: {
    pageProps?: {
      state?: {
        data?: {
          entity?: {
            name?: string;
            trackList?: NextDataTrackListItem[];
          };
        };
      };
    };
  };
}

/** Turns "spotify:track:abc123" into "abc123", or null if the URI doesn't match that shape (a local file or an unavailable track can appear with a different URI format). Exported for unit testing. */
export function extractTrackId(uri: string): string | null {
  const match = /^spotify:track:([A-Za-z0-9]+)$/.exec(uri);
  return match ? match[1]! : null;
}

/**
 * Never throws: any failure (network error, unexpected page shape, playlist not found/not public)
 * resolves to an empty array and logs a warning, so a Spotify hiccup or an upstream markup change can
 * never sink the rest of the cycle - it just means no playlist check this run.
 */
export async function getPlaylistTracks(logger: RunLogger, playlistId: string): Promise<PlaylistTrack[]> {
  try {
    const res = await fetch(`${EMBED_URL_PREFIX}${encodeURIComponent(playlistId)}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const match = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
    if (!match) throw new Error("__NEXT_DATA__ script tag not found in embed page - Spotify may have changed its markup");

    const data = JSON.parse(match[1]!) as NextDataShape;
    const rawTracks = data.props?.pageProps?.state?.data?.entity?.trackList;
    if (!rawTracks) throw new Error("no trackList found in embed page data - Spotify may have changed its response shape");

    if (rawTracks.length >= SUSPECTED_TRUNCATION_THRESHOLD) {
      logger.warn(
        "playlist-watch",
        `Playlist ${playlistId} returned ${rawTracks.length} track(s) - at or above the suspected truncation threshold, the real playlist may have more`
      );
    }

    const tracks: PlaylistTrack[] = [];
    for (const item of rawTracks) {
      const trackId = extractTrackId(item.uri);
      if (!trackId) continue; // a local file or otherwise non-standard entry - can't track or link to it
      tracks.push({
        trackId,
        name: item.title,
        artistCredit: item.subtitle,
        url: `https://open.spotify.com/track/${trackId}`,
      });
    }
    return tracks;
  } catch (err) {
    logger.warn("playlist-watch", `Failed to read playlist ${playlistId}'s tracks`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
