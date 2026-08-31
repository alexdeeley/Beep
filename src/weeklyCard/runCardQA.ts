import { readFileSync } from "node:fs";
import sharp from "sharp";
import type { AppConfig } from "../config/index.js";
import type { RunLogger } from "../utils/logger.js";
import { makeOpenAIClient, requestJsonWithImage } from "../utils/openaiClient.js";
import type { QAIssue, QAResult } from "../utils/types.js";
import type { SizeRenderResult } from "../render/renderInfographic.js";
import { nowIso } from "../utils/dateUtils.js";
import {
  CARD_QA_VISION_SYSTEM_PROMPT,
  buildCardQaVisionUserPrompt,
  DECADE_QA_VISION_SYSTEM_PROMPT,
  buildDecadeQaVisionUserPrompt,
} from "../qa/prompts.js";

/**
 * Standalone QA runner for the weekly card-draw pipeline. Deliberately
 * NOT a mode added to qa/runQA.ts: that function's checks (verified
 * facts, duplicate people, calendar-date matching, etc.) are all specific
 * to the daily pipeline's SelectedContent shape, which this pipeline has
 * none of. Keeping this fully separate means a change here can never
 * affect - and a bug here can never break - the daily app's QA gate.
 */
export async function runCardQualityChecks(
  config: AppConfig,
  logger: RunLogger,
  render: SizeRenderResult,
  isDecade: boolean
): Promise<QAResult> {
  const programmaticChecks: QAResult["programmaticChecks"] = [];
  const issues: QAIssue[] = [];

  const meta = await sharp(render.imagePath).metadata();
  const dimsOk = meta.width === render.width && meta.height === render.height;
  programmaticChecks.push({
    name: "correct_dimensions",
    passed: dimsOk,
    detail: `actual ${meta.width}x${meta.height}, expected ${render.width}x${render.height}`,
  });
  if (!dimsOk) issues.push({ severity: "blocking", message: `Rendered image is ${meta.width}x${meta.height}, expected exactly ${render.width}x${render.height}` });

  const visionCheck = await runVisionCheck(config, logger, render.imagePath, isDecade);
  if (visionCheck.ran && visionCheck.status === "FAIL") {
    for (const msg of visionCheck.issues ?? []) issues.push({ severity: "blocking", message: `[vision-qa] ${msg}` });
  }

  const blocking = issues.filter((i) => i.severity === "blocking");
  const status: QAResult["status"] = blocking.length === 0 ? "PASS" : "FAIL";

  logger.info("weekly-card-qa", `QA ${status}`, { blockingIssues: blocking.length, warnings: issues.length - blocking.length });

  return { status, issues, programmaticChecks, visionCheck, checkedAt: nowIso() };
}

async function runVisionCheck(
  config: AppConfig,
  logger: RunLogger,
  imagePath: string,
  isDecade: boolean
): Promise<QAResult["visionCheck"]> {
  if (!config.qa.enableVisionCheck) {
    logger.info("weekly-card-qa", "Vision QA disabled (ENABLE_VISION_QA=false); relying on programmatic checks only");
    return { ran: false };
  }
  const client = makeOpenAIClient(config);
  if (!client) {
    logger.warn("weekly-card-qa", "OPENAI_API_KEY not set; skipping vision QA pass");
    return { ran: false };
  }

  try {
    const imageBase64 = readFileSync(imagePath).toString("base64");
    const mime = imagePath.endsWith(".jpg") || imagePath.endsWith(".jpeg") ? "image/jpeg" : "image/png";
    const result = await requestJsonWithImage<{ status: "PASS" | "FAIL"; issues: string[] }>(client, {
      model: config.qaVisionModel,
      system: isDecade ? DECADE_QA_VISION_SYSTEM_PROMPT : CARD_QA_VISION_SYSTEM_PROMPT,
      user: isDecade ? buildDecadeQaVisionUserPrompt() : buildCardQaVisionUserPrompt(),
      imageBase64,
      imageMime: mime,
    });
    logger.info("weekly-card-qa", `Vision QA returned ${result.status}`, { issues: result.issues });
    return { ran: true, status: result.status, issues: result.issues ?? [] };
  } catch (err) {
    logger.warn("weekly-card-qa", "Vision QA call failed; falling back to programmatic checks only", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ran: false };
  }
}
