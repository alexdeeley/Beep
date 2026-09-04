import type { AppConfig } from "../../config/index.js";
import type {
  SpotifyAlbum,
  SpotifyArtist,
  SpotifyArtistAlbumsResponse,
  SpotifySearchArtistsResponse,
  SpotifyTokenResponse,
} from "./types.js";

export class MissingSpotifyCredentialsError extends Error {
  constructor() {
    super("SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET are not set; cannot check for releases.");
    this.name = "MissingSpotifyCredentialsError";
  }
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

/**
 * Client Credentials OAuth flow (https://developer.spotify.com/documentation/web-api/tutorials/client-credentials-flow) -
 * app-only auth, no user login, read-only public catalog access. Cached
 * in-process for the life of one pipeline run (a fresh Node process per
 * GitHub Actions job, so this never needs to persist across runs) with a
 * 60s expiry buffer.
 */
export async function getAccessToken(config: AppConfig): Promise<string> {
  const { clientId, clientSecret } = config.spotify;
  if (!clientId || !clientSecret) throw new MissingSpotifyCredentialsError();

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    throw new Error(`Spotify token request failed: ${res.status} ${res.statusText} - ${await res.text()}`);
  }
  const data = (await res.json()) as SpotifyTokenResponse;
  cachedToken = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.accessToken;
}

/** Test-only: clears the in-process token cache. */
export function _resetTokenCacheForTests(): void {
  cachedToken = null;
}

const MAX_RETRIES = 3;

/**
 * Thin fetch wrapper: retries on 429 (respecting Retry-After) and on
 * transient 5xx, bounded, so a rotation batch of hundreds of artists
 * doesn't die on one flaky response.
 */
async function spotifyFetch(url: string, accessToken: string): Promise<Response> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfterSec = Number.parseInt(res.headers.get("Retry-After") ?? "1", 10);
      await new Promise((r) => setTimeout(r, Math.max(1, retryAfterSec) * 1000));
      continue;
    }
    if (res.status >= 500 && attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, 500 * attempt));
      continue;
    }
    return res;
  }
  throw new Error(`Spotify request failed after ${MAX_RETRIES} attempts: ${url}`);
}

/**
 * Finds the best Spotify artist match for a watchlist name. Only ever
 * returns an EXACT (case-insensitive, trimmed) name match - a fuzzy
 * "closest" match risks silently attributing another artist's release to
 * the wrong name, which this pipeline treats as a correctness bug, not an
 * acceptable approximation. When multiple real artists share the exact
 * name, picks the one with the highest popularity score as the more
 * likely intended match. Returns null if no exact match is found.
 */
export async function searchArtist(accessToken: string, name: string): Promise<SpotifyArtist | null> {
  const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(`artist:"${name}"`)}&type=artist&limit=10`;
  const res = await spotifyFetch(url, accessToken);
  if (!res.ok) {
    throw new Error(`Spotify artist search failed for "${name}": ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as SpotifySearchArtistsResponse;
  const normalized = name.trim().toLowerCase();
  const exactMatches = data.artists.items.filter((a) => a.name.trim().toLowerCase() === normalized);
  if (exactMatches.length === 0) return null;
  return exactMatches.reduce((best, a) => (a.popularity > best.popularity ? a : best));
}

/**
 * Latest releases (albums + singles + compilations) for one artist,
 * newest-first. A single page (up to 50) is always enough for "did
 * anything new appear since last check" given the rotation checks each
 * artist at least daily.
 */
export async function getArtistAlbums(accessToken: string, spotifyArtistId: string): Promise<SpotifyAlbum[]> {
  const url = `https://api.spotify.com/v1/artists/${encodeURIComponent(spotifyArtistId)}/albums?include_groups=album,single,compilation&market=US&limit=50`;
  const res = await spotifyFetch(url, accessToken);
  if (!res.ok) {
    throw new Error(`Spotify artist-albums request failed for ${spotifyArtistId}: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as SpotifyArtistAlbumsResponse;
  return [...data.items].sort((a, b) => (a.release_date < b.release_date ? 1 : a.release_date > b.release_date ? -1 : 0));
}
