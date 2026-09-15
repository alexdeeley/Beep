import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const SUBSTACK_BASE_URL = "https://alexdeeley.substack.com/";
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

// Substack fronts the RSS feed with a Cloudflare JS challenge that a plain
// fetch() can never pass (confirmed live: GitHub Actions runner IPs get the
// "Just a moment..." interstitial, a 403 with no usable body). A real
// headless browser executes the challenge automatically like any visitor
// would, so: load the actual publication page first (HTML, not XML - lets
// the challenge clear and sets the clearance cookie on the context), then
// reuse that same browser context to request the feed directly. Going
// through the context's request API rather than page.goto() for the feed
// itself avoids Chromium's XML-viewer wrapping the raw bytes we need.
async function fetchFeedXml(): Promise<string> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    await page.goto(SUBSTACK_BASE_URL, { waitUntil: "networkidle", timeout: 30000 });

    const res = await context.request.get(SUBSTACK_FEED_URL);
    if (!res.ok()) {
      throw new Error(`Substack RSS fetch failed: ${res.status()} ${(await res.text()).slice(0, 300)}`);
    }
    return await res.text();
  } finally {
    await browser.close();
  }
}

export async function fetchAndSaveRecentPosts(): Promise<void> {
  const xml = await fetchFeedXml();
  const posts = parseItems(xml);

  await writeFile(
    OUTPUT_PATH,
    JSON.stringify({ updatedAt: new Date().toISOString(), posts }, null, 2) + "\n",
    "utf8"
  );
  console.log(`Wrote ${posts.length} post(s) to ${OUTPUT_PATH}`);
}
