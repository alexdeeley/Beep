import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchArtist, getAccessToken, _resetTokenCacheForTests, MissingSpotifyCredentialsError } from "../../src/newswire/spotify/client.js";
import type { AppConfig } from "../../src/config/index.js";

function makeConfig(overrides: Partial<AppConfig["spotify"]> = {}): AppConfig {
  return { spotify: { clientId: "id", clientSecret: "secret", ...overrides } } as AppConfig;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("getAccessToken", () => {
  beforeEach(() => {
    _resetTokenCacheForTests();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws MissingSpotifyCredentialsError when credentials are not configured", async () => {
    await expect(getAccessToken(makeConfig({ clientId: undefined }))).rejects.toBeInstanceOf(MissingSpotifyCredentialsError);
  });

  it("fetches and caches a token, not re-fetching on the next call", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: "tok1", token_type: "Bearer", expires_in: 3600 }));

    const token1 = await getAccessToken(makeConfig());
    expect(token1).toBe("tok1");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const token2 = await getAccessToken(makeConfig());
    expect(token2).toBe("tok1");
    expect(fetchMock).toHaveBeenCalledTimes(1); // cached, no second network call
  });
});

describe("searchArtist", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function artist(id: string, name: string, popularity: number) {
    return { id, name, genres: [], popularity, external_urls: { spotify: `https://open.spotify.com/artist/${id}` } };
  }

  it("returns null when no result is an exact (case-insensitive) name match", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ artists: { items: [artist("1", "Radioheadz", 50)] } }));
    expect(await searchArtist("token", "Radiohead")).toBeNull();
  });

  it("matches case-insensitively and ignores surrounding whitespace", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ artists: { items: [artist("1", "radiohead", 50)] } }));
    const match = await searchArtist("token", "  Radiohead  ");
    expect(match?.id).toBe("1");
  });

  it("never returns a fuzzy/partial match, only an exact one", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ artists: { items: [artist("1", "The Radiohead Experience", 99)] } }));
    expect(await searchArtist("token", "Radiohead")).toBeNull();
  });

  it("picks the highest-popularity artist when multiple exact-name matches exist", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        artists: { items: [artist("low", "Beck", 10), artist("high", "Beck", 80), artist("mid", "Beck", 40)] },
      })
    );
    const match = await searchArtist("token", "Beck");
    expect(match?.id).toBe("high");
  });
});
