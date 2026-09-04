/** Minimal shapes for the Spotify Web API responses this pipeline actually reads - not a full API type definition. */

export interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface SpotifyArtist {
  id: string;
  name: string;
  genres: string[];
  popularity: number;
  external_urls: { spotify: string };
}

export interface SpotifySearchArtistsResponse {
  artists: { items: SpotifyArtist[] };
}

export interface SpotifyAlbum {
  id: string;
  name: string;
  album_type: "album" | "single" | "compilation";
  release_date: string;
  release_date_precision: "year" | "month" | "day";
  total_tracks: number;
  external_urls: { spotify: string };
  images: { url: string; width: number; height: number }[];
}

export interface SpotifyArtistAlbumsResponse {
  items: SpotifyAlbum[];
}
