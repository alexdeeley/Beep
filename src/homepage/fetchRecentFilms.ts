import { writeFile } from "node:fs/promises";

const LETTERBOXD_USERNAME = "alexdeeley";
const RSS_URL = `https://letterboxd.com/${LETTERBOXD_USERNAME}/rss/`;
const OUTPUT_PATH = "recent-films.json";
const FILM_COUNT = 5;

export interface RecentFilm {
  title: string;
  year: string | null;
  rating: number | null;
  url: string;
  poster: string | null;
  watchedDate: string | null;
}

function decodeEntities(str: string): string {
  return str
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function tag(block: string, name: string): string | null {
  const match = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return match ? decodeEntities(match[1]!.trim()) : null;
}

function parseItems(xml: string): RecentFilm[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const films: RecentFilm[] = [];

  for (const block of items) {
    const title = tag(block, "letterboxd:filmTitle");
    const link = tag(block, "link");
    if (!title || !link) continue; // not a film entry (Letterboxd RSS is diary-only for this feed, but skip defensively)

    const ratingRaw = tag(block, "letterboxd:memberRating");
    const description = tag(block, "description") ?? "";
    const posterMatch = description.match(/<img src="([^"]+)"/);

    films.push({
      title,
      year: tag(block, "letterboxd:filmYear"),
      rating: ratingRaw ? Number(ratingRaw) : null,
      url: link,
      poster: posterMatch ? posterMatch[1]! : null,
      watchedDate: tag(block, "letterboxd:watchedDate"),
    });

    if (films.length >= FILM_COUNT) break;
  }

  return films;
}

export async function fetchAndSaveRecentFilms(): Promise<void> {
  const res = await fetch(RSS_URL);
  if (!res.ok) {
    throw new Error(`Letterboxd RSS fetch failed: ${res.status} ${await res.text()}`);
  }
  const xml = await res.text();
  const films = parseItems(xml);

  await writeFile(
    OUTPUT_PATH,
    JSON.stringify({ updatedAt: new Date().toISOString(), films }, null, 2) + "\n",
    "utf8"
  );
  console.log(`Wrote ${films.length} film(s) to ${OUTPUT_PATH}`);
}
