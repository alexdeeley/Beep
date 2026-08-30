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
