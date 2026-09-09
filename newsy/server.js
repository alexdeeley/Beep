// NEWSY backend — fetches RSS feeds, normalizes/dedupes/sorts them, and
// serves the result from a short-lived cache so we never hammer the
// upstream outlets.
const path = require('path');
const express = require('express');
const Parser = require('rss-parser');

const PORT = process.env.PORT || 3000;
const CACHE_MS = 4 * 60 * 1000; // 4 minutes
const FEED_TIMEOUT_MS = 8000;
const MAX_HEADLINES = 65;
const MAX_CONSECUTIVE_SAME_SOURCE = 2;

// Each feed declares the category NEWSY should file it under. Categories
// are assigned per-feed (not guessed per-article), which is what keeps the
// ALL/WORLD/U.S./TECH/CULTURE filter reliable enough to ship.
const FEEDS = [
  { url: 'http://feeds.bbci.co.uk/news/rss.xml', source: 'BBC News', category: 'world' },
  { url: 'http://feeds.bbci.co.uk/news/world/rss.xml', source: 'BBC News', category: 'world' },
  { url: 'https://feeds.npr.org/1001/rss.xml', source: 'NPR', category: 'us' },
  { url: 'https://www.theguardian.com/world/rss', source: 'The Guardian', category: 'world' },
  { url: 'https://www.theguardian.com/us-news/rss', source: 'The Guardian', category: 'us' },
  { url: 'https://abcnews.go.com/abcnews/topstories', source: 'ABC News', category: 'us' },
  { url: 'https://www.cbsnews.com/latest/rss/main', source: 'CBS News', category: 'us' },
  { url: 'http://feeds.nbcnews.com/nbcnews/public/news', source: 'NBC News', category: 'us' },
  { url: 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en', source: 'Google News', category: 'all' },
  { url: 'https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en', source: 'Google News', category: 'world' },
  { url: 'https://news.google.com/rss/headlines/section/topic/NATION?hl=en-US&gl=US&ceid=US:en', source: 'Google News', category: 'us' },
  { url: 'https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en-US&gl=US&ceid=US:en', source: 'Google News', category: 'tech' },
  { url: 'https://news.google.com/rss/headlines/section/topic/ENTERTAINMENT?hl=en-US&gl=US&ceid=US:en', source: 'Google News', category: 'culture' },
];

const parser = new Parser({
  timeout: FEED_TIMEOUT_MS,
  customFields: { item: [['source', 'source']] },
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsyBot/1.0)' },
});

let cache = { headlines: [], fetchedAt: 0 };
let inFlight = null;

function normalizeTitleForDedup(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordSet(normalized) {
  return new Set(normalized.split(' ').filter(Boolean));
}

function similarity(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / Math.min(a.size, b.size);
}

// Google News titles look like "Headline text - Source Name". The real
// source often lives in the <source> tag, so strip the trailing suffix to
// avoid showing it twice.
function stripTrailingSource(title, sourceName) {
  if (!sourceName) return title;
  const suffix = ` - ${sourceName}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length) : title;
}

async function fetchFeed(feed) {
  try {
    const parsed = await parser.parseURL(feed.url);
    return (parsed.items || []).map((item) => {
      const sourceName = (item.source && item.source._) || (item.source && item.source['#']) ||
        (typeof item.source === 'string' ? item.source : null) || feed.source;
      const rawTitle = item.title || '';
      const title = stripTrailingSource(rawTitle.trim(), sourceName).trim();
      const publishedAt = item.isoDate || item.pubDate || null;
      return {
        title,
        url: item.link || '',
        source: sourceName,
        category: feed.category,
        publishedAt: publishedAt ? new Date(publishedAt).toISOString() : null,
      };
    }).filter((h) => h.title && h.url);
  } catch (err) {
    console.warn(`[newsy] feed failed: ${feed.url} — ${err.message}`);
    return [];
  }
}

function dedupe(headlines) {
  const kept = [];
  const keptSets = [];
  for (const h of headlines) {
    const normalized = normalizeTitleForDedup(h.title);
    const set = wordSet(normalized);
    const isDuplicate = keptSets.some((existing) => similarity(set, existing) > 0.72);
    if (!isDuplicate) {
      kept.push(h);
      keptSets.push(set);
    }
  }
  return kept;
}

function sortByRecency(headlines) {
  return [...headlines].sort((a, b) => {
    if (a.publishedAt && b.publishedAt) return new Date(b.publishedAt) - new Date(a.publishedAt);
    if (a.publishedAt) return -1;
    if (b.publishedAt) return 1;
    return 0;
  });
}

// Prevent one outlet from dominating a stretch of the feed by pulling a
// later, different-source story forward when a streak gets too long.
// Recency still wins whenever a swap isn't needed.
function balanceSources(headlines) {
  const remaining = [...headlines];
  const result = [];
  while (remaining.length) {
    const streak = result.length >= MAX_CONSECUTIVE_SAME_SOURCE
      ? result.slice(-MAX_CONSECUTIVE_SAME_SOURCE)
      : [];
    const streakIsSameSource = streak.length === MAX_CONSECUTIVE_SAME_SOURCE &&
      streak.every((h) => h.source === streak[0].source);

    if (streakIsSameSource) {
      const lookahead = Math.min(remaining.length, 20);
      let swapIndex = -1;
      for (let i = 0; i < lookahead; i++) {
        if (remaining[i].source !== streak[0].source) { swapIndex = i; break; }
      }
      if (swapIndex > 0) {
        const [item] = remaining.splice(swapIndex, 1);
        result.push(item);
        continue;
      }
    }
    result.push(remaining.shift());
  }
  return result;
}

async function refreshHeadlines() {
  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  const all = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  const sorted = sortByRecency(all);
  const deduped = dedupe(sorted);
  const balanced = balanceSources(deduped).slice(0, MAX_HEADLINES);
  cache = { headlines: balanced, fetchedAt: Date.now() };
  return cache;
}

async function getHeadlines() {
  const isStale = Date.now() - cache.fetchedAt > CACHE_MS;
  if (!isStale) return cache;
  if (!inFlight) {
    inFlight = refreshHeadlines().finally(() => { inFlight = null; });
  }
  try {
    return await inFlight;
  } catch (err) {
    // Refresh failed entirely — serve whatever we last had, even if stale.
    console.error('[newsy] refresh failed:', err.message);
    return cache;
  }
}

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/news', async (req, res) => {
  try {
    const data = await getHeadlines();
    res.set('Cache-Control', 'no-store');
    res.json({ headlines: data.headlines, fetchedAt: data.fetchedAt });
  } catch (err) {
    res.status(500).json({ error: 'failed to load headlines' });
  }
});

app.listen(PORT, () => {
  console.log(`NEWSY running at http://localhost:${PORT}`);
  refreshHeadlines().catch((err) => console.error('[newsy] initial refresh failed:', err.message));
});
