# On This Day

An autonomous system that wakes up every morning, researches what actually
happened on today's calendar date in history, fact-checks it, generates a
piece of abstract art evoking that day, and publishes it as an image-only
post to a Bluesky account (with the full write-up in the image's
accessibility text) — with no daily human involvement.

This README assumes you are **not** a professional developer. Every step is
spelled out. If a step feels obvious to you, skip ahead.

---

## 1. What this actually does, in plain English

Once a day (by default, 12:34pm Pacific time), the app:

1. **Figures out today's date** in your chosen timezone (never UTC-by-accident).
2. **Checks if it already posted today.** If yes, it stops immediately — it will never post the same date twice.
3. **Researches** 20-40 candidate historical facts for that calendar date (events, births, deaths, disasters, science, music, sports, strange incidents, etc.) using OpenAI.
4. **Independently fact-checks** every single candidate with a second, stricter pass that treats the research step as untrusted. Anything that can't be confirmed — wrong date, wrong year, a birth mistaken for a death, an article's publish date mistaken for an event date — gets rejected or flagged for review, never published.
5. **Selects** the strongest, most varied 10-20 verified facts (major events, births, deaths, strange/memorable incidents).
6. **Generates a piece of abstract art** evoking the day's verified facts — bold shapes, texture, and color inspired by that day's themes, never a literal illustration of any single event. The image carries no factual claims of its own (the facts live in the verified data and the caption/alt text), so the one hard safety rule that used to apply to typesetting now applies to the art itself: **it must contain zero legible text, letters, numbers, or recognizable faces.** (An earlier version of this project rendered a deterministic HTML/CSS text infographic instead — see `src/render/renderInfographic.ts`, still in the repo but no longer used by the daily run.)
7. **Runs automated QA** on both the data and the generated pixels — duplicate checks, dimension checks, and a vision-model pass that specifically checks for any accidentally-generated text or garbled pseudo-text. **If QA fails, nothing gets published.**
8. **Writes a caption**, but posts image-only: the visible post text is left empty on purpose (just the image, no wall of text), the full caption goes into the image's alt/accessibility text instead, and up to 8 discovery tags (Bluesky's hard platform limit) get attached separately - no inline "#hashtag spam". Uploads the image to public storage for archival, then publishes via the official AT Protocol API (no browser automation, no fake logins).
9. **Logs everything** to `runs/<date>/` so you can see exactly what happened, and why, for any given day.

The guiding rule throughout: **no post is better than a wrong post.**

---

## 2. Install Node.js

You need Node.js version 20 or newer.

- **Mac**: install [Homebrew](https://brew.sh), then run `brew install node`.
- **Windows**: download the LTS installer from [nodejs.org](https://nodejs.org) and run it.
- **Linux**: use your package manager, or [nodejs.org](https://nodejs.org).

Check it worked:

```bash
node --version   # should print v20.x.x or higher
```

---

## 3. Install the project

```bash
git clone <this repository's URL>
cd on-this-day   # or whatever folder it cloned into
npm install
npx playwright install --with-deps chromium
```

The second command downloads the browser engine used to render the graphic.
It's a one-time ~150MB download.

Copy the example environment file:

```bash
cp .env.example .env
```

You'll fill in `.env` as you go through the steps below. **Never commit `.env`** — it's already in `.gitignore`.

---

## 4. Your first test run (no API keys needed yet)

The repository ships with a hand-verified test fixture for **August 29**
(Second Battle of Manassas, the Soviet Union's first atomic test, Strom
Thurmond's filibuster, Gemini V, the Beatles' last concert, Netflix's
founding, Hurricane Katrina, plus the births of Ingrid Bergman, Charlie
Parker, and Michael Jackson). It lets you see the entire pipeline work
end-to-end — research through rendering — without any credentials.

```bash
npm run daily -- --date 2026-08-29 --dry-run --fixture
```

This will:
- load the fixture instead of calling OpenAI,
- run selection, rendering, and QA for real,
- generate a real caption (a deterministic fallback caption, since no OpenAI key is configured yet),
- **skip** the actual Bluesky publish (both because of `--dry-run` and because no credentials are configured).

Open `runs/2026-08-29/infographic.png` — that's your finished 1080×1350
graphic. Check `runs/2026-08-29/run.log` to see exactly what each stage did.

> ⚠️ The fixture is a test fixture only, covering one date. It is **not**
> used in production — the real pipeline always does live research and
> verification once you add your OpenAI key (next step).

---

## 5. Get an OpenAI API key

1. Go to <https://platform.openai.com/api-keys> and sign in (or create an account).
2. Click **Create new secret key**, name it something like `on-this-day`, and copy the key (it starts with `sk-`).
3. Make sure the account has billing set up (Settings → Billing) — the research/verification/caption/QA calls use paid API usage.
4. Paste the key into `.env`:

   ```
   OPENAI_API_KEY=sk-...
   ```

Now try a real (non-fixture) research run for any date:

```bash
npm run research -- --date 2026-01-01
npm run inspect -- --date 2026-01-01 --stage research
```

And a real dry run end-to-end (no fixture, no publish):

```bash
npm run daily -- --date 2026-01-01 --dry-run
```

Check `runs/2026-01-01/infographic.png`.

---

## 6. Set up object storage (Cloudflare R2)

Unlike Instagram or Telegram, **Bluesky doesn't actually require a public
image URL** — it uploads the image bytes directly from disk. So this step
is technically optional for publishing to work at all. It's still strongly
recommended, though: it gives you a durable, publicly reachable archival
copy of every graphic ever posted, independent of Bluesky. R2 is
Cloudflare's S3-compatible storage and has a generous free tier.

**In a hurry?** You can skip straight to §7 (Bluesky) and come back to this
later — just leave `STORAGE_PROVIDER=local` in `.env` for now.

1. Sign up at <https://dash.cloudflare.com> (free). In the sidebar, R2 lives
   under **Storage & databases → R2 Object Storage**.
2. Click **Create bucket**. Name it e.g. `on-this-day`.
3. Open the bucket → **Settings** → find **Public Development URL** and
   enable it. It'll show a URL like `https://pub-xxxxxxxx.r2.dev` — that's
   your `R2_PUBLIC_BASE_URL`. (A custom domain works too, but isn't required.)
4. Back on the main **R2 Object Storage overview** page (not inside the
   bucket), find **Account Details → Manage API Tokens**. Under **Account
   API Tokens** (recommended — stays valid even if your personal login
   changes), click **Create Account API token**, give it **Object Read &
   Write** permission scoped to your bucket.
5. That page shows an **Access Key ID** and **Secret Access Key** — copy
   both immediately, the secret is shown only once. Your **Account ID** is
   also shown on the R2 overview page next to the S3 API endpoint.
6. Fill in `.env`:

   ```
   STORAGE_PROVIDER=r2
   R2_ACCOUNT_ID=...
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   R2_BUCKET=on-this-day
   R2_PUBLIC_BASE_URL=https://pub-xxxxxxxx.r2.dev
   ```

Any other S3-compatible provider (AWS S3, Backblaze B2, etc.) works too —
see the commented `S3_*` variables in `.env.example`.

**Don't want to set up storage yet?** Leave `STORAGE_PROVIDER=local` (or
just leave the R2 variables blank) — the app will render everything and
clearly log that upload/publish were skipped, which is exactly what you
want during development.

---

## 7. Set up Bluesky (official AT Protocol API)

This project originally targeted Instagram's Graph API, but that requires a
Meta Developer account tied to a validated Facebook identity and business
verification — real friction for a personal project. Bluesky needs none of
that: no app review, no business verification, no linked accounts of any
kind. Just a Bluesky account and an app password.

### 7.1 Create a Bluesky account
If you don't already have one, sign up free at <https://bsky.app>. Note the
handle you're given (or set), e.g. `yourname.bsky.social` — that's your
`BLUESKY_IDENTIFIER`.

### 7.2 Generate an app password
**Never use your real account password in `.env`.** Bluesky has a
dedicated mechanism for this:
1. In the Bluesky app: **Settings → Privacy and security → App Passwords**.
2. Click **Add App Password**, give it a name like `on-this-day`.
3. Copy the generated password (shown once, format `xxxx-xxxx-xxxx-xxxx`).

### 7.3 Fill in `.env`
```
BLUESKY_IDENTIFIER=yourname.bsky.social
BLUESKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
```

### 7.4 Test it
```bash
npm run daily -- --date 2026-01-01 --dry-run
```
still won't publish (that's what `--dry-run` is for). To actually test a
real publish once everything above is configured:
```bash
npm run publish -- --date 2026-01-01
```
(after having run `render` and `caption` for that date first — see §9.)
Check your Bluesky profile — the post should appear within a couple seconds.

### 7.5 Why posts are image-only

By design, the visible text on every post is left empty - it's just the
graphic, no wall of text underneath it. Two things happen with the caption
content instead:

- The full descriptive caption goes into the image's **alt text**
  (accessibility field) rather than the visible post. Screen reader users
  get full access to everything the graphic says; sighted users just see a
  clean image-only post. There's no length limit on alt text.
- Up to **8 discovery tags** get attached via Bluesky's dedicated `tags`
  field. This is a hard AT Protocol limit - Bluesky's `tags` field caps
  out at 8 entries, and there is no mechanism to attach more without
  putting them as literal `#hashtag` text inside the 300-character visible
  post, which is exactly the wall-of-text this design avoids. If you ever
  want visible inline hashtags instead, that would need to go back into
  the post `text` field in `src/bluesky/publish.ts` - trading off against
  the image-only look.

### 7.6 How the 8 tags get chosen

With only 8 slots, `src/caption/hashtagExtraction.ts` derives tags
directly from that day's verified content instead of relying on generic
filler. For every selected fact, ranked by its own selection score
(highest-importance facts go first), it extracts, in priority order:

1. The **person's name** (e.g. `MartinLutherKingJr`), if the fact has one.
2. Otherwise a **topic phrase** pulled from the headline with stopwords
   stripped (e.g. "Netflix Is Founded" → `NetflixFounded`).
3. The fact's most specific **place** (the first segment of its location,
   e.g. "Manassas, Virginia, USA" → `Manassas`).
4. One **category** tag per distinct category present that day (e.g.
   `War`, `Space`, `Music`) - added once, not once per item.

That pool is combined with the LLM's own day-specific hashtag guesses and
finally the evergreen `HASHTAGS` pool from `.env` (`#OnThisDay`,
`#History`, etc.) as pure fallback filler - so on a content-rich day, all
8 slots typically go to real names/places/topics from that day's actual
stories, and the generic brand tags only appear when there isn't enough
specific material to fill the cap. If you'd rather always guarantee a
brand tag (e.g. `#OnThisDay`) regardless of content richness, reorder the
`tags` array built in `runPublishStage()` in `src/orchestration/runDaily.ts`
to put `config.brand.hashtags` first instead of last.

---

## 8. Understand the safety rails

- **Dry run** (`--dry-run`): runs the entire pipeline, including QA, but
  never calls the Bluesky API. Use this constantly.
- **Missing Bluesky credentials**: the app detects this automatically and
  logs `SKIPPED_NO_CREDENTIALS` instead of failing — this is the expected,
  safe state for local development.
- **QA failure**: if automated QA finds a blocking issue (wrong date,
  duplicate person, overflowing text, wrong image dimensions, etc.),
  publishing is skipped entirely, even outside of `--dry-run`.
- **Idempotency**: before doing any work, the app checks
  `runs/<date>/publish.json` for a prior `SUCCESS`. If found, it exits
  immediately. It is safe to re-run the daily job multiple times on the same
  day (the GitHub Actions workflow does this on purpose — see §12).

---

## 9. Running individual stages

Useful while developing or debugging a specific date:

```bash
npm run research -- --date 2026-03-15         # stage 1 only
npm run verify   -- --date 2026-03-15         # stage 2, needs research.json
npm run select   -- --date 2026-03-15         # stage 3, needs verified.json
npm run render   -- --date 2026-03-15         # regenerate ONLY the graphic, needs selected.json
npm run qa       -- --date 2026-03-15         # needs render.json
npm run caption  -- --date 2026-03-15         # needs selected.json
npm run publish  -- --date 2026-03-15 --dry-run
npm run daily    -- --date 2026-03-15 --dry-run   # the whole pipeline in one go
npm run inspect  -- --date 2026-03-15 --stage selected   # pretty-print any artifact
```

`inspect --stage` accepts `research`, `verified`, `selected`, `qa`, or
`publish`.

**Regenerating just the graphic** (e.g. after a template/CSS tweak, without
burning API calls on new research): `npm run render -- --date <date>` reads
the existing `selected.json` and re-renders from it.

---

## 10. Configuration

Everything tunable lives in environment variables (`.env`), read by
`src/config/index.ts`. See `.env.example` for the full list with defaults,
including:

- `APP_TIMEZONE`, `PUBLISH_TIME_LOCAL` — when "today" is decided
- `MAX_MAJOR_EVENTS` / `MIN_MAJOR_EVENTS`, `MAX_BIRTHS`, `MAX_DEATHS`, `MAX_INCIDENTS` — how much content per post
- `MIN_VERIFICATION_CONFIDENCE`, `MIN_AUTHORITATIVE_SOURCES` — how strict verification is
- `BRAND_THEME` (`classic_gold` | `deep_navy` | `museum_burgundy`), `ROTATE_THEMES`
- `ENABLE_STORY_RENDER` — also render a 1080×1920 Story version
- `ENABLE_IMAGE_GENERATION` — optional decorative (never factual) AI artwork
- `ENABLE_VISION_QA` — optional vision-model QA pass before publish
- `HASHTAGS` — a pool of evergreen discovery tags (e.g. `#OnThisDay #History #Past #TodayInHistory`). These are combined with day-specific tags the caption model generates, then trimmed to Bluesky's hard 8-tag limit (see §7.5) - listing more than 8 total here has no effect since only the first 8 unique ones ever get used.
- `SOURCE_CREDIT_LINE`

---

## 11. Disabling publishing / rotating credentials

**To disable publishing without touching code:** remove or comment out
`BLUESKY_APP_PASSWORD` in your environment (or the repo's GitHub Actions
secrets). The app will render everything and log
`SKIPPED_NO_CREDENTIALS` instead of publishing — nothing else changes.

**To rotate your Bluesky app password:** in the Bluesky app, go to
**Settings → Privacy and security → App Passwords**, revoke the old one,
generate a new one, then update `BLUESKY_APP_PASSWORD` in GitHub Actions
(Settings → Secrets and variables → Actions) or your `.env`. No code
changes needed.

**To rotate your OpenAI key:** create a new key at
<https://platform.openai.com/api-keys>, update `OPENAI_API_KEY`, then delete
the old key from the OpenAI dashboard.

**To rotate storage credentials:** create a new R2 API token, update the
`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` secrets, then revoke the old
token in the Cloudflare dashboard.

---

## 12. Deploying the scheduler

The default deployment is a **GitHub Actions scheduled workflow**
(`.github/workflows/daily.yml`) — no server to maintain.

1. Push this repository to GitHub.
2. Go to **Settings → Secrets and variables → Actions** and add these
   **Repository secrets**:
   - `OPENAI_API_KEY`
   - `BLUESKY_IDENTIFIER`
   - `BLUESKY_APP_PASSWORD`
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
3. Add these **Repository variables** (non-secret config):
   - `R2_BUCKET`, `R2_PUBLIC_BASE_URL`
   - `APP_TIMEZONE` (optional, defaults to `America/Los_Angeles`)
4. That's it. The workflow runs automatically every day (see the comment
   in `daily.yml` for why it's scheduled twice — it's about DST, not
   double-posting; idempotency guarantees only one real post per day).

You can also trigger it manually: **Actions → Daily On This Day post → Run
workflow**, optionally supplying a specific `date`, `dry_run`, or `fixture`
input — useful for testing the deployed configuration without waiting for
the schedule.

Every run uploads its full `runs/` directory as a downloadable workflow
artifact (30-day retention) — that's your audit trail.

### Alternative deployment options
- **Small VPS/container**: install Node + `npx playwright install --with-deps chromium`, then run `npm run daily` from cron (use `TZ`-aware cron or just let `APP_TIMEZONE` handle it).
- **Any container platform** with a scheduled-job feature (Cloudflare Workers' own runtime cannot run a full Chromium instance, so Cloudflare users should pair a Cloudflare Cron Trigger with a small worker that calls out to a container/VPS running this app, rather than running Playwright inside the Worker itself).

---

## 13. Inspecting logs

Every run writes to `runs/<date>/`:

```
runs/2026-08-29/
  research.json      # raw candidate facts (stage 1 output)
  verified.json       # independently fact-checked candidates (stage 2 output)
  selected.json        # final chosen content (stage 3 output)
  assets.json           # any decorative AI artwork generated
  render.json             # render dimensions/scale metadata
  infographic.png           # the final 1080x1350 graphic
  infographic.render.html     # the exact HTML that was rendered (for debugging)
  story.png                     # optional 1080x1920 Story version
  qa.json                         # QA verdict + every check performed
  caption.json / caption.txt        # generated caption (used as image alt text, not the visible post)
  publish.json                        # Bluesky publish result (postUri, tags used, etc.)
  run.json                              # stage-by-stage summary
  run.log / run.jsonl                     # full structured log (human + machine readable)
```

If a run failed, `run.json` names the exact `failureStage`, and `run.log`
has the full story leading up to it.

---

## 14. Project structure

```
src/
  config/          # environment-driven configuration
  research/        # stage 1: broad candidate research (OpenAI)
  verification/    # stage 2: independent, strict fact-checking (OpenAI)
  selection/        # stage 3: ranking/diversity/anniversary logic (pure code)
  art/             # stage 4: daily abstract art generation (OpenAI image model) - the live pipeline's image source
  assets/          # legacy: decorative (non-textual) motifs for the old text infographic, unused by `daily`
  render/          # legacy: deterministic HTML/CSS -> PNG via Playwright, unused by `daily` (see art/ above)
  qa/              # programmatic + vision-model QA (art no-text check + the legacy infographic checklist)
  caption/         # social caption generation
  storage/         # R2/S3 upload
  bluesky/         # official AT Protocol publish flow
  orchestration/   # the master daily pipeline + CLI stage runners
  weeklyCard/      # fully independent weekly "card draw" pipeline - own schedule, own state, own concurrency group (see below)
  cli/             # command-line entry point
  utils/           # dates/timezones, logging, run state, text limits

templates/infographic/   # CSS design system + bundled fonts (no network dependency)
tests/                   # vitest unit tests + the August 29 fixture
runs/                    # generated output (gitignored, per-date)
.github/workflows/       # daily.yml (the "On This Day" scheduled post) + weekly-card.yml (the weekly card draw)
```

### The weekly "card draw" pipeline

A second, completely independent posting pipeline lives in `src/weeklyCard/`
and posts to the same Bluesky account every Sunday at ~2:22am Pacific: a
single playing card resting on an open notebook covered in cryptic
handwritten scribbling. It shares almost nothing with the daily app above
on purpose, so a bug or outage in one can never affect the other:

- **Own schedule and workflow**: `.github/workflows/weekly-card.yml`, a
  separate `concurrency` group (`on-this-day-weekly-card`, distinct from
  the daily app's `on-this-day-daily`).
- **Own state**: run artifacts live under `runs/weekly-<date>/`, never
  `runs/<date>/`, so the two pipelines' local idempotency checks can never
  collide.
- **Own Bluesky idempotency check**: matches on a `"Card Draw"` alt-text
  marker + the ISO date, never the daily app's `"<Month Day, Year>"`
  format - so neither pipeline's posts can ever be mistaken for the
  other's on the shared account.
- **Own QA**: `src/weeklyCard/runCardQA.ts`, not `qa/runQA.ts` (which is
  tightly coupled to the daily app's historical-facts data shape).
- Every ten years (from `WEEKLY_CARD_ANCHOR_DATE`, see `.env.example`),
  the normal card post is replaced by a special edition reading exactly
  "LIFE IS BEAUTIFUL. GOODBYE." - see `src/weeklyCard/decadeCheck.ts`.

The only code the two pipelines actually share is low-level plumbing with
no daily-pipeline-specific state: `art/imageGeneration.ts` (the
gpt-image-1 call + size-cap encoder) and `bluesky/publish.ts`'s
`publishToBluesky` (a generic "upload bytes, create a post" function).

Test it locally the same way as `daily`:

```bash
npm run weekly -- --date 2026-09-06 --dry-run           # a normal week
npm run weekly -- --date 2026-09-06 --dry-run --force-decade  # preview the decade special
```

---

## 15. Tests

```bash
npm test
```

Covers timezone/date resolution, publish idempotency (including the
Bluesky dry-run/no-credentials guards), the strict verification
threshold gate, content selection (dedup, min/max caps, category
diversity, no-fabrication-on-scarcity), config parsing, and the
text-length safety net used by the renderer.

---

## 16. Known limitations

- The bundled fixture only covers August 29 — every other date requires a
  live OpenAI key. This is intentional (see the project's rule against
  hard-coded production data).
- Verification quality is only as good as the underlying model's world
  knowledge and the sources it can genuinely corroborate; the strict
  programmatic gate (`MIN_VERIFICATION_CONFIDENCE`,
  `MIN_AUTHORITATIVE_SOURCES`) reduces but cannot fully eliminate the risk
  of a subtly wrong fact — treat `needs_review` items as a signal to check
  manually if you're ever inspecting a specific day's output.
  It is not currently allowed to actually fetch and read URLs (no live
  browsing tool is wired in), so source corroboration relies on the
  models' own training knowledge rather than a live web check.
- Vision QA (`ENABLE_VISION_QA`) meaningfully improves confidence but is
  not a substitute for the deterministic renderer — it's a second opinion,
  not the source of truth.
- Carousel mode, video/Reels export, and automatic content-memory across
  days are intentionally not built yet; the data model (`SelectedContent`,
  per-stage JSON artifacts) is structured so they can be added later
  without reworking the research/verification pipeline.
- The GitHub Actions schedule uses two cron triggers to survive DST
  without a stale hard-coded UTC offset; this means the workflow runs
  twice most days (the second run is a fast no-op thanks to idempotency),
  which is a deliberate trade-off over risking a missed post.
