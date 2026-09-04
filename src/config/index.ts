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
   * Config for the independent weekly "card draw" pipeline (see
   * src/weeklyCard/). Kept entirely separate from the `art`/daily-pipeline
   * config on purpose - the two pipelines share no state, no schedule, and
   * no concurrency group, so a problem in one can never block or corrupt
   * the other.
   */
  weeklyCard: {
    /** YYYY-MM-DD anchor date "decade 0" is counted from - see weeklyCard/decadeCheck.ts. */
    anchorDate: string;
    maxGenerationAttempts: number;
    maxQaRegenerationAttempts: number;
  };

  /**
   * Config for the independent hourly "newswire" pipeline (see
   * src/newswire/) - as of V3, a music release-announcement wire driven
   * by a user-maintained artist watchlist and the Spotify Web API, not
   * general web-search news discovery. Deliberately its own namespaced
   * block rather than reusing the top-level researchModel/verificationModel
   * fields above - those belong to the (now unscheduled, but still-present)
   * daily pipeline, and a shared field would silently couple the two.
   */
  news: {
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
    /** How many pending (never-resolved) watched artists to attempt Spotify search resolution for per cycle. */
    artistResolveBatchSize: number;
    /** How many already-resolved watched artists to check for new releases per cycle (rotation, oldest-checked-first). */
    releaseCheckBatchSize: number;
    /** Ignore a "new" release from Spotify if its release_date is older than this many days - guards against a catalog backfill/re-index being mistaken for fresh news. */
    releaseLookbackDays: number;
  };

  spotify: {
    clientId: string | undefined;
    clientSecret: string | undefined;
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

    weeklyCard: {
      anchorDate: envStr("WEEKLY_CARD_ANCHOR_DATE", "2026-08-30")!,
      maxGenerationAttempts: envInt("WEEKLY_CARD_MAX_GENERATION_ATTEMPTS", 3),
      maxQaRegenerationAttempts: envInt("WEEKLY_CARD_MAX_QA_REGENERATION_ATTEMPTS", 3),
    },

    news: {
      writerModel: envStr("NEWS_WRITER_MODEL", "gpt-4.1")!,
      copyEditModel: envStr("NEWS_COPYEDIT_MODEL", "gpt-4.1-mini")!,
      factCheckModel: envStr("NEWS_FACTCHECK_MODEL", "gpt-4.1")!,
      maxStageRetries: envInt("NEWS_MAX_STAGE_RETRIES", 2),
      stageTimeoutMs: envInt("NEWS_STAGE_TIMEOUT_MS", 60_000),
      maxPostsPerEdition: envInt("NEWS_MAX_POSTS_PER_EDITION", 5),
      dbR2Key: envStr("NEWS_DB_R2_KEY", "newswire/story.db")!,
      editorialFocusPath: envStr("EDITORIAL_FOCUS_PATH", "editorial-focus.json")!,
      artistListPath: envStr("NEWS_ARTIST_LIST_PATH", "watched-artists.txt")!,
      artistResolveBatchSize: envInt("NEWS_ARTIST_RESOLVE_BATCH_SIZE", 300),
      releaseCheckBatchSize: envInt("NEWS_RELEASE_CHECK_BATCH_SIZE", 500),
      releaseLookbackDays: envInt("NEWS_RELEASE_LOOKBACK_DAYS", 14),
    },

    spotify: {
      clientId: envStr("SPOTIFY_CLIENT_ID"),
      clientSecret: envStr("SPOTIFY_CLIENT_SECRET"),
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

    qa: {
      enableVisionCheck: envBool("ENABLE_VISION_QA", true),
    },

    paths: {
      runsDir: envStr("RUNS_DIR", "runs")!,
    },
  };
}

export const config = loadConfig();
