import "dotenv/config";
import type { ThemeName } from "../utils/types.js";

function envStr(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function envFloat(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export interface AppConfig {
  timezone: string;
  publishTimeLocal: string; // "05:30"
  openaiApiKey: string | undefined;
  researchModel: string;
  verificationModel: string;
  captionModel: string;
  qaVisionModel: string;
  imageGenModel: string;

  image: {
    feedWidth: number;
    feedHeight: number;
    storyWidth: number;
    storyHeight: number;
    enableStory: boolean;
    format: "png" | "jpeg";
    jpegQuality: number;
  };

  selection: {
    maxMajorEvents: number;
    minMajorEvents: number;
    maxBirths: number;
    minBirths: number;
    maxDeaths: number;
    minDeaths: number;
    maxIncidents: number;
    minIncidents: number;
    minVerificationConfidence: number;
    minAuthoritativeSources: number;
  };

  research: {
    minCandidates: number;
    maxCandidates: number;
  };

  brand: {
    theme: ThemeName;
    rotateThemes: boolean;
    hashtags: string[];
    sourceCreditLine: string;
  };

  assets: {
    enableImageGeneration: boolean;
  };

  art: {
    maxGenerationAttempts: number;
    maxQaRegenerationAttempts: number;
  };

  /**
   * Config for the independent hourly "newswire" pipeline (see
   * src/newswire/) - as of V3.1, a music news/release-announcement wire:
   * each cycle rotates through a batch of a user-maintained artist
   * watchlist, discovers candidates via OpenAI web search, and
   * independently re-verifies each one (2-corroborating-source rule)
   * before it's eligible to post. Deliberately its own namespaced block
   * rather than reusing the top-level researchModel/verificationModel
   * fields above - those belong to the (now unscheduled, but
   * still-present) daily pipeline, and a shared field would silently
   * couple the two.
   */
  news: {
    discoveryModel: string;
    verificationModel: string;
    writerModel: string;
    copyEditModel: string;
    factCheckModel: string;
    maxStageRetries: number;
    stageTimeoutMs: number;
    /** Hard cap on posts in one hourly edition. */
    maxPostsPerEdition: number;
    /** Object key the story SQLite database is stored/retrieved under in the existing R2/S3 bucket. */
    dbR2Key: string;
    /** Path (relative to process.cwd(), i.e. the repo root) to the user-editable editorial-focus.json. */
    editorialFocusPath: string;
    /** Path (relative to process.cwd()) to the user-maintained watched-artists.txt (one artist name per line). */
    artistListPath: string;
    /** How many watchlist artists to check (rotation, oldest-checked-first) per cycle. With a large watchlist, full coverage takes many cycles - that's expected. */
    artistBatchSize: number;
    /** Local hour (in editorial-focus.json's quietHours.timezone) after which the first Friday cycle posts the NEW MUSIC FRIDAY roundup. */
    weeklyRoundupHourLocal: number;
    /**
     * The local hours (in editorial-focus.json's quietHours.timezone) this pipeline is meant to run at
     * - default twice a day, 8am and 8pm. news.yml's cron fires more often than this (it has to, to
     * survive DST without a wall-clock anchor drifting), so runNewswireCycle.ts checks the actual local
     * hour against this list first and exits immediately (no OpenAI/R2 calls) on any other hour - this
     * is what actually enforces the twice-daily cadence, not the cron expression alone. `--force`
     * bypasses this, same as it bypasses the quiet-hours check, for manual testing.
     */
    postingHoursLocal: number[];
    /**
     * How many hours after a target posting hour a cycle still counts as "on time" rather than
     * off-hours - see quietHours/postingWindow.ts. Confirmed live: GitHub Actions scheduled workflows
     * have no timing SLA and have been observed firing 2.5-4 hours late, which an exact-hour match
     * would silently treat as off-hours every time, going a full day without posting. getLastHourlyRun
     * still prevents more than one real cycle per window even if cron fires multiple times inside it.
     */
    postingWindowToleranceHours: number;
    /** How many never-checked watchlist artists get a one-time birth-date lookup per cycle (see birthdays/postBirthdays.ts). Small on purpose - each candidate needs its own independent verification search, and this is a one-time cost per artist, not a recurring one. */
    birthDateBatchSize: number;
    /** Local hour (in editorial-focus.json's quietHours.timezone) after which the first Tuesday cycle posts the weekly Portland/Pacific-Northwest SHOWS calendar (see shows/postWeeklyShows.ts). */
    showsHourLocal: number;
    /**
     * How many days old a verification-confirmed exact release/event date can be before an
     * individual news/release item is rejected as stale rather than posted as current (see
     * verification/itemFreshness.ts). The discovery prompt already asks for "roughly the last 3-5
     * days," but that is only a soft instruction - confirmed live, discovery/verification can still
     * surface a release that is months old (a genuinely true fact, just not current news), so this is
     * enforced in code. Generous relative to the prompt's 3-5 days to absorb rotation-batch lag on a
     * large watchlist without rejecting a real miss the wire just hasn't covered yet.
     */
    maxItemAgeDays: number;
    /**
     * Spotify playlist IDs for playlist-watch (see spotify/postPlaylistAdditions.ts) - each is a
     * PUBLIC playlist checked independently every cycle for newly-added tracks, every new one posted as
     * a mechanical "NEW SINGLE" with a link. Empty array: playlist-watch is a no-op. A playlist must be
     * public to be readable via getPlaylistTracks.ts's credential-free embed-page approach - confirmed
     * live this works even for playlists under Spotify's algorithmic `37i9dQZF1...` ID space (e.g. an
     * account's auto-generated "Favorites"), as long as it's public; genuinely per-viewer personalized
     * content (Discover Weekly, Release Radar) is the one category that still needs the owner's own
     * login regardless of endpoint, since it isn't the same content for every reader of the page.
     */
    newSinglesPlaylistIds: string[];
  };

  storage: {
    provider: "r2" | "s3" | "local";
    bucket: string | undefined;
    accountId: string | undefined;
    accessKeyId: string | undefined;
    secretAccessKey: string | undefined;
    publicBaseUrl: string | undefined;
    region: string;
    endpoint: string | undefined;
  };

  bluesky: {
    identifier: string | undefined;
    appPassword: string | undefined;
    service: string;
    maxPublishAttempts: number;
  };

  /**
   * Spotify Web API (Client Credentials flow - catalog search only, no
   * user login) used to attach a canonical open.spotify.com track link to
   * the newswire's mechanical "NEW SINGLE: Artist - Title" posts (see
   * src/newswire/spotify/lookupTrack.ts). Optional: when either value is
   * missing, lookups are skipped entirely and singles post exactly as
   * they did before - this is additive, never a hard dependency.
   */
  spotify: {
    clientId: string | undefined;
    clientSecret: string | undefined;
  };

  qa: {
    enableVisionCheck: boolean;
  };

  paths: {
    runsDir: string;
  };
}

export function loadConfig(): AppConfig {
  return {
    timezone: envStr("APP_TIMEZONE", "America/Los_Angeles")!,
    publishTimeLocal: envStr("PUBLISH_TIME_LOCAL", "05:30")!,
    openaiApiKey: envStr("OPENAI_API_KEY"),
    researchModel: envStr("RESEARCH_MODEL", "gpt-4.1")!,
    verificationModel: envStr("VERIFICATION_MODEL", "gpt-4.1")!,
    captionModel: envStr("CAPTION_MODEL", "gpt-4.1")!,
    qaVisionModel: envStr("QA_VISION_MODEL", "gpt-4.1")!,
    imageGenModel: envStr("IMAGE_GEN_MODEL", "gpt-image-1")!,

    image: {
      feedWidth: envInt("IMAGE_FEED_WIDTH", 1080),
      feedHeight: envInt("IMAGE_FEED_HEIGHT", 1350),
      storyWidth: envInt("IMAGE_STORY_WIDTH", 1080),
      storyHeight: envInt("IMAGE_STORY_HEIGHT", 1920),
      enableStory: envBool("ENABLE_STORY_RENDER", false),
      format: (envStr("IMAGE_FORMAT", "png") as "png" | "jpeg") ?? "png",
      jpegQuality: envInt("IMAGE_JPEG_QUALITY", 92),
    },

    selection: {
      maxMajorEvents: envInt("MAX_MAJOR_EVENTS", 7),
      minMajorEvents: envInt("MIN_MAJOR_EVENTS", 3),
      maxBirths: envInt("MAX_BIRTHS", 5),
      minBirths: envInt("MIN_BIRTHS", 0),
      maxDeaths: envInt("MAX_DEATHS", 5),
      minDeaths: envInt("MIN_DEATHS", 0),
      maxIncidents: envInt("MAX_INCIDENTS", 3),
      minIncidents: envInt("MIN_INCIDENTS", 0),
      minVerificationConfidence: envFloat("MIN_VERIFICATION_CONFIDENCE", 0.72),
      minAuthoritativeSources: envInt("MIN_AUTHORITATIVE_SOURCES", 1),
    },

    research: {
      minCandidates: envInt("MIN_CANDIDATES", 20),
      maxCandidates: envInt("MAX_CANDIDATES", 40),
    },

    brand: {
      theme: (envStr("BRAND_THEME", "classic_gold") as ThemeName) ?? "classic_gold",
      rotateThemes: envBool("ROTATE_THEMES", false),
      hashtags: (envStr("HASHTAGS", "#OnThisDay #TodayInHistory #History") ?? "")
        .split(/\s+/)
        .filter(Boolean),
      sourceCreditLine: envStr(
        "SOURCE_CREDIT_LINE",
        "Research sources include: Library of Congress, NASA, NPS, NOAA, Smithsonian, official archives and institutional sources."
      )!,
    },

    assets: {
      enableImageGeneration: envBool("ENABLE_IMAGE_GENERATION", false),
    },

    art: {
      maxGenerationAttempts: envInt("ART_MAX_GENERATION_ATTEMPTS", 3),
      maxQaRegenerationAttempts: envInt("ART_MAX_QA_REGENERATION_ATTEMPTS", 3),
    },

    news: {
      discoveryModel: envStr("NEWS_DISCOVERY_MODEL", "gpt-4.1-mini")!,
      verificationModel: envStr("NEWS_VERIFICATION_MODEL", "gpt-4.1")!,
      writerModel: envStr("NEWS_WRITER_MODEL", "gpt-4.1")!,
      copyEditModel: envStr("NEWS_COPYEDIT_MODEL", "gpt-4.1-mini")!,
      factCheckModel: envStr("NEWS_FACTCHECK_MODEL", "gpt-4.1")!,
      maxStageRetries: envInt("NEWS_MAX_STAGE_RETRIES", 2),
      stageTimeoutMs: envInt("NEWS_STAGE_TIMEOUT_MS", 60_000),
      maxPostsPerEdition: envInt("NEWS_MAX_POSTS_PER_EDITION", 5),
      dbR2Key: envStr("NEWS_DB_R2_KEY", "newswire/story.db")!,
      editorialFocusPath: envStr("EDITORIAL_FOCUS_PATH", "editorial-focus.json")!,
      artistListPath: envStr("NEWS_ARTIST_LIST_PATH", "watched-artists.txt")!,
      artistBatchSize: envInt("NEWS_ARTIST_BATCH_SIZE", 150),
      weeklyRoundupHourLocal: envInt("NEWS_WEEKLY_ROUNDUP_HOUR_LOCAL", 8),
      postingHoursLocal: (envStr("NEWS_POSTING_HOURS_LOCAL", "8,20") ?? "8,20")
        .split(",")
        .map((h) => Number.parseInt(h.trim(), 10))
        .filter((h) => Number.isFinite(h)),
      postingWindowToleranceHours: envInt("NEWS_POSTING_WINDOW_TOLERANCE_HOURS", 6),
      birthDateBatchSize: envInt("NEWS_BIRTHDATE_BATCH_SIZE", 15),
      showsHourLocal: envInt("NEWS_SHOWS_HOUR_LOCAL", 8),
      maxItemAgeDays: envInt("NEWS_MAX_ITEM_AGE_DAYS", 30),
      newSinglesPlaylistIds: (envStr("SPOTIFY_NEW_SINGLES_PLAYLIST_IDS") ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    },

    storage: {
      provider: (envStr("STORAGE_PROVIDER", "r2") as "r2" | "s3" | "local") ?? "r2",
      bucket: envStr("R2_BUCKET") ?? envStr("S3_BUCKET"),
      accountId: envStr("R2_ACCOUNT_ID"),
      accessKeyId: envStr("R2_ACCESS_KEY_ID") ?? envStr("S3_ACCESS_KEY_ID"),
      secretAccessKey: envStr("R2_SECRET_ACCESS_KEY") ?? envStr("S3_SECRET_ACCESS_KEY"),
      publicBaseUrl: envStr("R2_PUBLIC_BASE_URL") ?? envStr("S3_PUBLIC_BASE_URL"),
      region: envStr("S3_REGION", "auto")!,
      endpoint: envStr("S3_ENDPOINT"),
    },

    bluesky: {
      identifier: envStr("BLUESKY_IDENTIFIER"),
      appPassword: envStr("BLUESKY_APP_PASSWORD"),
      service: envStr("BLUESKY_SERVICE", "https://bsky.social")!,
      maxPublishAttempts: envInt("BLUESKY_MAX_PUBLISH_ATTEMPTS", 3),
    },

    spotify: {
      clientId: envStr("SPOTIFY_CLIENT_ID"),
      clientSecret: envStr("SPOTIFY_CLIENT_SECRET"),
    },

    qa: {
      enableVisionCheck: envBool("ENABLE_VISION_QA", true),
    },

    paths: {
      runsDir: envStr("RUNS_DIR", "runs")!,
    },
  };
}

export const config = loadConfig();
