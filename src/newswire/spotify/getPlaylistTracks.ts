import type { AppConfig } from "../../config/index.js";
import type { RunLogger } from "../../utils/logger.js";
import { getSpotifyAccessToken } from "./spotifyAuth.js";

const API_BASE = "https://api.spotify.com/v1";
/** Spotify's own hard cap on this endpoint's page size. */
const PAGE_LIMIT = 100;
/** Sanity ceiling on pages fetched, so a pathologically large or misbehaving playlist can't loop forever. 50 pages * 100 = 5000 tracks, far more than a "new singles" style playlist should ever hold. */
const MAX_PAGES = 50;

export interface PlaylistTrack {
  trackId: string;
  name: string;
  artists: string[];
  url: string | null;
  /** ISO timestamp of when the track was added to the playlist, per Spotify's own record - not when this pipeline noticed it. */
  addedAt: string;
}

interface RawPlaylistItem {
  added_at: string;
  track: {
    id: string | null;
    name: string;
    artists: { name: string }[];
    external_urls: { spotify?: string };
    is_local: boolean;
  } | null;
}

interface RawPlaylistTracksResponse {
  items: RawPlaylistItem[];
  next: string | null;
}

/**
 * Reads every track currently on a PUBLIC playlist via Client Credentials (app-only auth - see
 * spotifyAuth.ts). This does NOT work for a private or personalized/algorithmic playlist (e.g.
 * Discover Weekly, or Spotify's own recommendation feeds) - those require the playlist owner's own
 * Authorization Code login, which this pipeline does not implement; confirmed live that such a
 * playlist 404s even when "public" from the owner's own perspective, because personalized content is
 * scoped to the requesting user's identity, not just a visibility flag.
 *
 * Never throws: any failure (missing credentials, network error, playlist not found/not public)
 * resolves to an empty array and logs a warning, so a Spotify hiccup can never sink the rest of the
 * cycle - it just means no playlist check this run.
 */
export async function getPlaylistTracks(config: AppConfig, logger: RunLogger, playlistId: string): Promise<PlaylistTrack[]> {
  const token = await getSpotifyAccessToken(config, logger);
  if (!token) return [];

  const fields = "items(added_at,track(id,name,artists(name),external_urls,is_local)),next";
  let url: string | null =
    `${API_BASE}/playlists/${encodeURIComponent(playlistId)}/tracks?limit=${PAGE_LIMIT}&fields=${encodeURIComponent(fields)}`;

  const tracks: PlaylistTrack[] = [];
  let page = 0;

  try {
    while (url && page < MAX_PAGES) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as RawPlaylistTracksResponse;

      for (const item of data.items) {
        // A local file (never has a Spotify track id) or a removed/unavailable track (null) can't be
        // tracked or linked to - skip rather than crash on missing fields.
        if (!item.track || item.track.is_local || !item.track.id) continue;
        tracks.push({
          trackId: item.track.id,
          name: item.track.name,
          artists: item.track.artists.map((a) => a.name),
          url: item.track.external_urls.spotify ?? null,
          addedAt: item.added_at,
        });
      }

      url = data.next;
      page++;
    }
  } catch (err) {
    logger.warn("playlist-watch", `Failed to read playlist ${playlistId}'s tracks`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  return tracks;
}
