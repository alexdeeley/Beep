import type { AppConfig } from "../../config/index.js";
import type { RunLogger } from "../../utils/logger.js";

const TOKEN_URL = "https://accounts.spotify.com/api/token";

interface CachedToken {
  accessToken: string;
  /** Epoch ms after which the token must be refreshed - a few minutes of margin before the real expiry. */
  expiresAt: number;
}

/** Module-level in-memory cache: one newswire cycle is a single short-lived process that may make several Spotify calls (track lookups, playlist reads), so this avoids re-authenticating per call. Never persisted - a fresh process always starts with no cached token, which is fine since the token is cheap to (re)fetch. Shared across every Spotify caller in this pipeline (lookupTrack.ts, getPlaylistTracks.ts). */
let cachedToken: CachedToken | null = null;

/**
 * Client Credentials flow (app-only auth, no user login) - sufficient for public catalog search and
 * reading a PUBLIC playlist's tracks, but NOT for anything requiring a specific user's own library
 * (private playlists, personalized/algorithmic playlists like Discover Weekly, or writing to a
 * playlist) - those need the Authorization Code flow instead, which this pipeline does not implement.
 * Returns null (never throws) when credentials are missing or the token request fails; callers treat
 * that as "Spotify integration unavailable this cycle," not a hard failure.
 */
export async function getSpotifyAccessToken(config: AppConfig, logger: RunLogger): Promise<string | null> {
  if (!config.spotify.clientId || !config.spotify.clientSecret) return null;

  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }

  try {
    const basic = Buffer.from(`${config.spotify.clientId}:${config.spotify.clientSecret}`).toString("base64");
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { access_token: string; expires_in: number };
    cachedToken = {
      accessToken: data.access_token,
      expiresAt: Date.now() + Math.max(0, data.expires_in - 60) * 1000,
    };
    return cachedToken.accessToken;
  } catch (err) {
    logger.warn("spotify", "Failed to obtain a Spotify access token", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
