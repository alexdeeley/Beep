# NEWSY

An ultra-minimal, automatically refreshing news headline feed. No summaries,
no thumbnails, no cards, no dashboard — just giant headlines flowing
downward, like a living newspaper front page.

## What it does

- A tiny Express backend pulls headlines from a handful of public RSS feeds
  (BBC, NPR, The Guardian, ABC News, CBS News, NBC News, and Google News as
  an aggregator), normalizes them into a common shape, filters out
  near-duplicate stories covering the same event, sorts newest-first, and
  lightly balances sources so no single outlet dominates the feed. Every
  feed is filed under one of WORLD / U.S. / TECH / CULTURE up front, so the
  category filter never has to guess.
- A plain HTML/CSS/JS frontend renders the result as huge, bold, tightly
  kerned headlines on a black background, and quietly re-fetches every 5
  minutes without ever reloading the page.

No paid API keys, no scraping fragile HTML pages, no frameworks.

## Install

```bash
cd newsy
npm install
```

## Run

```bash
npm start
```

Then open <http://localhost:3000>.

Set a different port with `PORT=8080 npm start` if 3000 is taken.

## Deploy

NEWSY needs a host that keeps a Node process running (its backend fetches
and caches RSS in memory) — a static host like GitHub Pages can't serve
`/api/news`.

**Render (free tier):**

1. Push this repo to GitHub (already done if you're reading this from the repo).
2. In the [Render dashboard](https://dashboard.render.com), click **New →
   Blueprint** and connect the repo. Render reads `render.yaml` at the repo
   root, which points at `newsy/` as the service's root directory, runs
   `npm install`, and starts it with `npm start`.
3. Alternatively, **New → Web Service** by hand: set the root directory to
   `newsy`, build command `npm install`, start command `npm start`, and
   plan `Free`. Render sets `PORT` itself; the server already reads it.
4. First deploy takes a minute or two. Once live, Render gives you a
   `https://<service-name>.onrender.com` URL — that's your NEWSY feed.

The free plan spins the service down after inactivity and takes ~30-60s to
wake back up on the next request; that's a Render free-tier tradeoff, not a
NEWSY limitation.

## How it's put together

```
newsy/
  package.json
  server.js        Express server: fetch → normalize → dedupe → sort → cache
  public/
    index.html     The entire page: NEWSY wordmark + category filter + feed
    style.css       Giant Helvetica typography, black/white, no decoration
    app.js          Fetches /api/news, renders headlines, handles
                    auto-refresh, category filtering, and optional auto-scroll
```

### Backend (`server.js`)

- `FEEDS` lists each RSS source along with a fixed category (`world`, `us`,
  `tech`, or `culture`) — categories are assigned per-feed rather than
  guessed per-article, which is what keeps the filter reliable.
- Feeds are fetched in parallel with `Promise.allSettled`, so one dead or
  slow feed never blocks the rest — it's just dropped for that refresh.
- Results are cached in memory for 4 minutes. `/api/news` serves the cache
  and only triggers a real refresh once it goes stale, so NEWSY never
  hammers the upstream outlets.
- Google News RSS items carry the real publisher in a `<source>` tag and
  often repeat it in the title (`"Headline - Reuters"`); the server pulls
  the real source out and strips the redundant suffix from the title.
- Deduplication normalizes each title (lowercase, punctuation stripped) and
  compares word overlap against titles already kept; anything highly
  similar to an existing story is dropped. Deliberately simple — not
  fuzzy-matching every pair of headlines in the world, just the ones
  competing for the same slot.
- Source balancing walks the sorted, deduped list and swaps in an
  upcoming story from a different outlet if the same source would appear
  more than twice in a row. Recency still wins whenever no swap is needed.

### Frontend (`public/app.js`)

- Renders headlines with `textContent`/DOM APIs only — RSS titles are never
  inserted as HTML, so a feed can't inject markup into the page.
- On the first load it renders everything; on every refresh after that it
  only prepends headlines it hasn't seen yet (matched by URL), with a
  subtle fade-in — existing headlines are left alone.
- A tiny dot in the top-right corner appears only after two consecutive
  failed refreshes, and disappears the moment a refresh succeeds. Currently
  displayed headlines are never cleared on a failed fetch.
- The settings button (bottom-right) reveals a single "Auto-scroll" toggle.
  Auto-scroll moves the page down slowly and immediately stops the moment
  the user scrolls, touches, or presses a key — it only resumes if they
  explicitly turn it back on.
- Respects `prefers-reduced-motion` by disabling the fade-in and auto-scroll
  motion.

## Notes on sources

RSS availability changes over time — outlets add and drop feeds without
notice. If a feed in `FEEDS` starts returning nothing, it fails silently
(logged to the server console) and the rest of the feed list keeps NEWSY
running; swap in a replacement URL in `server.js` when that happens. Reuters
and AP no longer publish public RSS feeds directly, which is why they show
up here only indirectly, via Google News.
