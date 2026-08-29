import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import type { AppConfig } from "../config/index.js";
import type { RunLogger } from "../utils/logger.js";
import type { DecorativeAsset, SelectedContent } from "../utils/types.js";
import { buildInfographicHtml } from "./templates.js";

export interface SizeRenderResult {
  imagePath: string;
  width: number;
  height: number;
  scale: number;
  naturalContentHeight: number;
  overflowClamped: boolean;
}

export interface RenderResult {
  feed: SizeRenderResult;
  story: SizeRenderResult | null;
}

const MIN_SCALE = 0.72;

/**
 * Resolve a specific Chromium binary to launch, if one is pinned via
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE or pre-installed at the conventional
 * /opt/pw-browsers path some managed environments use. Returns
 * undefined otherwise, letting Playwright fall back to its own
 * auto-downloaded browser (the normal path for `npx playwright install
 * chromium` in CI/production).
 */
function resolveChromiumExecutable(): string | undefined {
  const pinned = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (pinned && existsSync(pinned)) return pinned;
  const conventional = "/opt/pw-browsers/chromium";
  if (existsSync(conventional)) return conventional;
  return undefined;
}

/**
 * Renders the deterministic HTML/CSS infographic to a pixel-exact PNG/JPG
 * using a real browser engine (Playwright/Chromium) rather than an
 * image-generation model. Content is measured first, then uniformly
 * scaled (never distorted, never truncated) to guarantee it fits inside
 * the fixed export canvas with no clipping and no overflow.
 */
export async function renderInfographic(
  config: AppConfig,
  logger: RunLogger,
  runDir: string,
  selected: SelectedContent,
  assets: DecorativeAsset[]
): Promise<RenderResult> {
  const cssPath = resolve("templates/infographic/styles.css");
  if (!existsSync(cssPath)) {
    throw new Error(`Missing stylesheet at ${cssPath}. Run from the project root.`);
  }
  const cssHref = `file://${cssPath}`;

  const browser = await chromium.launch({ executablePath: resolveChromiumExecutable() });
  try {
    const feed = await renderOneSize(browser, logger, runDir, selected, assets, cssHref, {
      width: config.image.feedWidth,
      height: config.image.feedHeight,
      fileBaseName: "infographic",
      format: config.image.format,
      jpegQuality: config.image.jpegQuality,
    });

    let story: SizeRenderResult | null = null;
    if (config.image.enableStory) {
      story = await renderOneSize(browser, logger, runDir, selected, assets, cssHref, {
        width: config.image.storyWidth,
        height: config.image.storyHeight,
        fileBaseName: "story",
        format: config.image.format,
        jpegQuality: config.image.jpegQuality,
      });
    }

    return { feed, story };
  } finally {
    await browser.close();
  }
}

async function renderOneSize(
  browser: Browser,
  logger: RunLogger,
  runDir: string,
  selected: SelectedContent,
  assets: DecorativeAsset[],
  cssHref: string,
  opts: { width: number; height: number; fileBaseName: string; format: "png" | "jpeg"; jpegQuality: number }
): Promise<SizeRenderResult> {
  const { width, height, fileBaseName, format, jpegQuality } = opts;
  const html = buildInfographicHtml(selected, assets, { pageWidth: width, pageHeight: height, cssHref });

  // Written to disk and loaded via file:// navigation (not page.setContent)
  // because Chromium refuses to resolve file:// stylesheet/font links from
  // the about:blank origin setContent() uses - a real page.goto() to a
  // file:// URL is required for local CSS/@font-face to load reliably.
  const htmlPath = resolve(join(runDir, `${fileBaseName}.render.html`));
  writeFileSync(htmlPath, html, "utf-8");

  // Pass 1: render in a tall scratch viewport at natural (unscaled) size
  // purely to measure how tall the content actually wants to be.
  const page = await browser.newPage({ viewport: { width, height: Math.max(height, 5000) } });
  await page.goto(`file://${htmlPath}`, { waitUntil: "load" });
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });

  const naturalHeight = await page.$eval("#content-root", (el) => (el as HTMLElement).scrollHeight);

  let scale = naturalHeight > height ? height / naturalHeight : 1;
  scale = Math.max(MIN_SCALE, Math.min(1, scale));
  const overflowClamped = scale <= MIN_SCALE + 1e-6 && naturalHeight * scale > height;
  const offsetY = Math.max(0, Math.round((height - naturalHeight * scale) / 2));

  // Pass 2: resize to the exact export viewport and apply the computed
  // uniform scale + vertical centering offset. Never non-uniform scale
  // (that would distort type), never crop mid-word.
  await page.setViewportSize({ width, height });
  await page.evaluate(
    ({ scale, offsetY }: { scale: number; offsetY: number }) => {
      const el = document.getElementById("content-root");
      if (el) el.style.transform = `translateY(${offsetY}px) scale(${scale})`;
    },
    { scale, offsetY }
  );
  await page.waitForTimeout(60);

  const ext = format === "jpeg" ? "jpg" : "png";
  const imagePath = join(runDir, `${fileBaseName}.${ext}`);
  await page.screenshot({
    path: imagePath,
    type: format,
    quality: format === "jpeg" ? jpegQuality : undefined,
    clip: { x: 0, y: 0, width, height },
  });
  await page.close();

  logger.info("render", `Rendered ${fileBaseName}.${ext} at ${width}x${height}`, {
    naturalHeight,
    scale: Number(scale.toFixed(3)),
    overflowClamped,
  });
  if (overflowClamped) {
    logger.warn(
      "render",
      `${fileBaseName}: content still exceeds canvas even at minimum scale ${MIN_SCALE}; selection produced too much material`
    );
  }

  return { imagePath, width, height, scale, naturalContentHeight: naturalHeight, overflowClamped };
}
