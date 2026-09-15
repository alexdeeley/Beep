import { writeFile } from "node:fs/promises";

const SUBSTACK_FEED_URL = "https://alexdeeley.substack.com/feed";
const OUTPUT_PATH = "recent-posts.json";
const POST_COUNT = 5;

export interface RecentPost {
  title: string;
  url: string;
  excerpt: string | null;
  publishedAt: string | null;
}

function decodeEntities(str: string): string {
  return str
    .replace(/&#8217;/g, "’")
    .replace(/&#8216;/g, "‘")
    .replace(/&#8220;/g, "“")
    .replace(/&#8221;/g, "”")
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function tag(block: string, name: string): string | null {
  const cdata = block.match(new RegExp(`<${name}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${name}>`));
  if (cdata) return decodeEntities(cdata[1]!.trim());
  const plain = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return plain ? decodeEntities(plain[1]!.trim()) : null;
}

function parseItems(xml: string): RecentPost[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const posts: RecentPost[] = [];

  for (const block of items) {
    const title = tag(block, "title");
    const link = tag(block, "link");
    if (!title || !link) continue;

    // Substack often leaves the subtitle empty (just "..." or blank) when the
    // author didn't set one - only surface it when it's an actual excerpt.
    const rawExcerpt = tag(block, "description");
    const excerpt = rawExcerpt && rawExcerpt.replace(/\./g, "").trim().length > 3 ? rawExcerpt : null;

    posts.push({
      title,
      url: link,
      excerpt,
      publishedAt: tag(block, "pubDate"),
    });

    if (posts.length >= POST_COUNT) break;
  }

  return posts;
}

export async function fetchAndSaveRecentPosts(): Promise<void> {
  const res = await fetch(SUBSTACK_FEED_URL);
  if (!res.ok) {
    throw new Error(`Substack RSS fetch failed: ${res.status} ${await res.text()}`);
  }
  const xml = await res.text();
  const posts = parseItems(xml);

  await writeFile(
    OUTPUT_PATH,
    JSON.stringify({ updatedAt: new Date().toISOString(), posts }, null, 2) + "\n",
    "utf8"
  );
  console.log(`Wrote ${posts.length} post(s) to ${OUTPUT_PATH}`);
}
