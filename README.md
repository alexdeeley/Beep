# On This Day

An autonomous system that wakes up every morning, researches what actually
happened on today's calendar date in history, fact-checks it, designs a
premium editorial infographic, writes a caption, and publishes it to
Instagram — with no daily human involvement.

This README assumes you are **not** a professional developer. Every step is
spelled out. If a step feels obvious to you, skip ahead.

---

## 1. What this actually does, in plain English

Once a day (by default, 5:30am Pacific time), the app:

1. **Figures out today's date** in your chosen timezone (never UTC-by-accident).
2. **Checks if it already posted today.** If yes, it stops immediately — it will never post the same date twice.
3. **Researches** 20-40 candidate historical facts for that calendar date (events, births, deaths, disasters, science, music, sports, strange incidents, etc.) using OpenAI.
4. **Independently fact-checks** every single candidate with a second, stricter pass that treats the research step as untrusted. Anything that can't be confirmed — wrong date, wrong year, a birth mistaken for a death, an article's publish date mistaken for an event date — gets rejected or flagged for review, never published.
5. **Selects** the strongest, most varied 10-20 verified facts (major events, births, deaths, strange/memorable incidents).
6. **Builds the graphic deterministically.** This is the most important design decision in the whole project: **no AI model ever typesets the dates, names, or headlines.** All factual text is rendered with real HTML/CSS through a real browser engine (Playwright/Chromium), so spelling, line breaks, and layout are always exactly what the verified data says. AI image generation (optional, off by default) is only ever used for wordless decorative artwork.
7. **Runs automated QA** on both the data and the rendered pixels — duplicate checks, overflow checks, dimension checks, and (optionally) a vision-model sanity pass. **If QA fails, nothing gets published.**
8. **Writes a caption**, uploads the image to public storage, and publishes to Instagram via the official Graph API (no browser automation, no fake logins).
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
- **skip** the actual Instagram publish (both because of `--dry-run` and because no credentials are configured).

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

Instagram's API requires your image to be reachable at a public HTTPS URL —
it cannot accept a raw file upload. R2 is Cloudflare's S3-compatible storage
and has a generous free tier.

1. Sign up at <https://dash.cloudflare.com> (free).
2. Go to **R2 Object Storage** → **Create bucket**. Name it e.g. `on-this-day`.
3. In the bucket settings, enable **Public Access** (or connect a custom
   domain) and note the public base URL it gives you, e.g.
   `https://pub-xxxxxxxx.r2.dev` or `https://images.yourdomain.com`.
4. Go to **R2 → Manage API Tokens → Create API Token**, give it
   **Object Read & Write** permission scoped to your bucket.
5. Note your **Account ID** (shown on the R2 overview page).
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

## 7. Set up the Instagram Graph API (official Meta publishing API)

This is the fiddliest part because it's Meta's process, not this project's.
Take it slowly.

### 7.1 Requirements
- An **Instagram Professional account** (Business or Creator). Convert a
  personal account for free in the Instagram app: Settings → Account type
  and tools → Switch to professional account.
- A **Facebook Page** connected to that Instagram account (Instagram's
  Graph API is accessed through a linked Facebook Page).

### 7.2 Create a Meta app
1. Go to <https://developers.facebook.com/apps> and click **Create App**.
2. Choose the **Business** app type.
3. In the app dashboard, click **Add Product** and add **Instagram Graph API**.

### 7.3 Connect your Instagram account and get your User ID
1. In your app's dashboard, go to **Instagram Graph API → API Setup with Instagram business login** (or use Graph API Explorer, see below).
2. Follow Meta's flow to link your Facebook Page and Instagram Professional account to the app.
3. Once linked, find your **Instagram User ID** (a numeric ID, different from your @username). The easiest way: use the [Graph API Explorer](https://developers.facebook.com/tools/explorer/), select your app, generate a User or Page access token with `instagram_basic` permission, and call:
   ```
   GET /me/accounts
   ```
   to find your Page, then:
   ```
   GET /{page-id}?fields=instagram_business_account
   ```
   The `id` field returned is your `INSTAGRAM_USER_ID`.

### 7.4 Get an access token
1. In **Graph API Explorer**, select your app and your Page.
2. Request these permissions: `instagram_basic`, `instagram_content_publish`, `pages_read_engagement`, `pages_show_list`.
3. Generate a **User Access Token**, then convert it to a **long-lived token** (60 days) using:
   ```
   GET /oauth/access_token?grant_type=fb_exchange_token&client_id={app-id}&client_secret={app-secret}&fb_exchange_token={short-lived-token}
   ```
4. For a truly "no daily human involvement" setup, exchange this for (or
   directly generate) a token tied to a **System User** on a Meta Business
   account — those don't expire on a 60-day cycle the way user tokens do.
   See Meta's [System User docs](https://developers.facebook.com/docs/marketing-api/system-users). Rotate/refresh it periodically regardless (see §11).
5. Put both values in `.env`:

   ```
   INSTAGRAM_ACCESS_TOKEN=...
   INSTAGRAM_USER_ID=...
   ```

### 7.5 App review
Meta requires **App Review** for `instagram_content_publish` before you can
publish to accounts other than your own test accounts. While your app is in
development mode, you can fully test publishing to Instagram accounts you
personally own/administer (added as testers in **App Roles → Roles**)
without review. Submit for review when you're ready to publish beyond that.

### 7.6 Test it
```bash
npm run daily -- --date 2026-01-01 --dry-run
```
still won't publish (that's what `--dry-run` is for). To actually test a
real publish once everything above is configured:
```bash
npm run publish -- --date 2026-01-01
```
(after having run `render` and `caption` for that date first — see §9).

---

## 8. Understand the safety rails

- **Dry run** (`--dry-run`): runs the entire pipeline, including QA, but
  never calls the Instagram API. Use this constantly.
- **Missing Instagram credentials**: the app detects this automatically and
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
- `INSTAGRAM_HASHTAGS`, `SOURCE_CREDIT_LINE`

---

## 11. Disabling publishing / rotating credentials

**To disable publishing without touching code:** remove or comment out
`INSTAGRAM_ACCESS_TOKEN` in your environment (or the repo's GitHub Actions
secrets). The app will render everything and log
`SKIPPED_NO_CREDENTIALS` instead of publishing — nothing else changes.

**To rotate your Instagram access token:** generate a new long-lived (or
System User) token following §7.4, then update the
`INSTAGRAM_ACCESS_TOKEN` secret in GitHub Actions (Settings → Secrets and
variables → Actions) or your `.env`. No code changes needed.

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
   - `INSTAGRAM_ACCESS_TOKEN`
   - `INSTAGRAM_USER_ID`
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
3. Add these **Repository variables** (non-secret config):
   - `R2_BUCKET`, `R2_PUBLIC_BASE_URL`
   - `APP_TIMEZONE` (optional, defaults to `America/Los_Angeles`)
   - `META_API_VERSION` (optional, defaults to `v21.0`)
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
  caption.json / caption.txt        # generated caption
  publish.json                        # Instagram publish result
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
  assets/          # optional decorative (non-textual) AI artwork
  render/          # deterministic HTML/CSS -> PNG via Playwright
  qa/              # programmatic + optional vision-model QA
  caption/         # Instagram caption generation
  storage/         # R2/S3 upload
  instagram/       # official Graph API publish flow
  orchestration/   # the master daily pipeline + CLI stage runners
  cli/             # command-line entry point
  utils/           # dates/timezones, logging, run state, text limits

templates/infographic/   # CSS design system + bundled fonts (no network dependency)
tests/                   # vitest unit tests + the August 29 fixture
runs/                    # generated output (gitignored, per-date)
.github/workflows/       # the daily scheduled GitHub Action
```

---

## 15. Tests

```bash
npm test
```

Covers timezone/date resolution, publish idempotency (including the
Instagram dry-run/no-credentials guards), the strict verification
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
