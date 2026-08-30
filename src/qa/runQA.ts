import { readFileSync } from "node:fs";
import sharp from "sharp";
import type { AppConfig } from "../config/index.js";
import type { RunLogger } from "../utils/logger.js";
import { makeOpenAIClient, requestJsonWithImage } from "../utils/openaiClient.js";
import type { QAIssue, QAResult, SelectedContent, SelectedFact } from "../utils/types.js";
import type { SizeRenderResult } from "../render/renderInfographic.js";
import { nowIso } from "../utils/dateUtils.js";
import {
  QA_VISION_SYSTEM_PROMPT,
  buildQaVisionUserPrompt,
  ART_QA_VISION_SYSTEM_PROMPT,
  buildArtQaVisionUserPrompt,
} from "./prompts.js";

export type QAMode = "infographic" | "art";

const PLACEHOLDER_PATTERNS = [/lorem ipsum/i, /\btodo\b/i, /\bTBD\b/, /undefined/i, /\bNaN\b/, /\[object Object\]/i];

// Unicode replacement char + stray C0 control chars (excluding tab/newline/CR).
const MALFORMED_CHAR_PATTERN = new RegExp("[\\uFFFD\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]");

/**
 * Stage: automated pre-publish QA. Inspects BOTH the structured data and
 * the rendered pixels. A blocking issue here must prevent publishing -
 * "no post is better than a wrong post".
 */
export async function runQualityChecks(
  config: AppConfig,
  logger: RunLogger,
  expectedIsoDate: string,
  selected: SelectedContent,
  render: SizeRenderResult,
  mode: QAMode = "infographic"
): Promise<QAResult> {
  const programmaticChecks: QAResult["programmaticChecks"] = [];
  const issues: QAIssue[] = [];

  const allItems = [...selected.majorEvents, ...selected.births, ...selected.deaths, ...selected.incidents];

  // 1. Correct calendar date
  const dateOk = selected.date === expectedIsoDate;
  programmaticChecks.push({ name: "correct_calendar_date", passed: dateOk, detail: `${selected.date} vs expected ${expectedIsoDate}` });
  if (!dateOk) issues.push({ severity: "blocking", message: `Selected content date ${selected.date} does not match expected publish date ${expectedIsoDate}` });

  // 2. All items verified
  const unverified = allItems.filter((f) => f.verificationStatus !== "verified");
  const allVerified = unverified.length === 0;
  programmaticChecks.push({ name: "all_items_verified", passed: allVerified, detail: `${unverified.length} non-verified item(s)` });
  if (!allVerified) {
    issues.push({ severity: "blocking", message: `${unverified.length} selected item(s) are not marked verified: ${unverified.map((u) => u.headline).join(", ")}` });
  }

  // 3. No duplicate people within births/deaths
  checkDuplicates(selected.births, "births", (f) => (f.people[0] ?? f.headline).toLowerCase(), issues, programmaticChecks);
  checkDuplicates(selected.deaths, "deaths", (f) => (f.people[0] ?? f.headline).toLowerCase(), issues, programmaticChecks);

  // 4. No duplicate events (by headline) across events + incidents
  checkDuplicates(
    [...selected.majorEvents, ...selected.incidents],
    "events+incidents",
    (f) => f.headline.trim().toLowerCase(),
    issues,
    programmaticChecks
  );

  // 5. No empty cards / missing fields
  const empties = allItems.filter((f) => !f.headline?.trim() || !f.description?.trim() || !f.year);
  const noEmpties = empties.length === 0;
  programmaticChecks.push({ name: "no_empty_cards", passed: noEmpties, detail: `${empties.length} empty/incomplete item(s)` });
  if (!noEmpties) issues.push({ severity: "blocking", message: `${empties.length} item(s) have empty headline/description/year` });

  // 6. No placeholder / debug text
  const placeholderHits = allItems.filter((f) =>
    PLACEHOLDER_PATTERNS.some((re) => re.test(f.headline) || re.test(f.description))
  );
  const noPlaceholders = placeholderHits.length === 0;
  programmaticChecks.push({ name: "no_placeholder_text", passed: noPlaceholders, detail: `${placeholderHits.length} hit(s)` });
  if (!noPlaceholders) issues.push({ severity: "blocking", message: `Placeholder/debug text found in: ${placeholderHits.map((h) => h.headline).join(", ")}` });

  // 7. No malformed characters (replacement char, stray control chars)
  const malformed = allItems.filter((f) => MALFORMED_CHAR_PATTERN.test(f.headline + f.description));
  const noMalformed = malformed.length === 0;
  programmaticChecks.push({ name: "no_malformed_characters", passed: noMalformed, detail: `${malformed.length} item(s)` });
  if (!noMalformed) issues.push({ severity: "blocking", message: `Malformed characters found in: ${malformed.map((m) => m.headline).join(", ")}` });

  // 8. Correct dimensions / aspect ratio from the actual file on disk
  const meta = await sharp(render.imagePath).metadata();
  const dimsOk = meta.width === render.width && meta.height === render.height;
  programmaticChecks.push({
    name: "correct_dimensions",
    passed: dimsOk,
    detail: `actual ${meta.width}x${meta.height}, expected ${render.width}x${render.height}`,
  });
  if (!dimsOk) issues.push({ severity: "blocking", message: `Rendered image is ${meta.width}x${meta.height}, expected exactly ${render.width}x${render.height}` });

  // 9. No overflow / clipping (renderer's own scale-to-fit safety net)
  programmaticChecks.push({ name: "no_overflow_clipping", passed: !render.overflowClamped, detail: `scale=${render.scale.toFixed(3)}` });
  if (render.overflowClamped) {
    issues.push({ severity: "blocking", message: "Content exceeded the canvas even at minimum safe scale; too much material was selected for this date" });
  }

  // 10. No accidental large blank/white margins. Only meaningful for the
  // fixed dark-theme infographic layout - abstract art has no expected
  // background color, so this check is skipped in art mode.
  if (mode === "infographic") {
    const corners = await sampleCorners(render.imagePath);
    const tooLight = corners.filter((c) => c > 235).length >= 3;
    programmaticChecks.push({ name: "no_accidental_white_margins", passed: !tooLight, detail: `corner brightness: ${corners.join(", ")}` });
    if (tooLight) issues.push({ severity: "warning", message: "Multiple image corners are near-white, which is unexpected for this dark theme" });
  }

  // 11. Optional vision-model pass with the verified JSON attached
  const visionCheck = await runVisionCheck(config, logger, render.imagePath, selected, mode);
  if (visionCheck.ran && visionCheck.status === "FAIL") {
    for (const msg of visionCheck.issues ?? []) issues.push({ severity: "blocking", message: `[vision-qa] ${msg}` });
  }

  const blocking = issues.filter((i) => i.severity === "blocking");
  const status: QAResult["status"] = blocking.length === 0 ? "PASS" : "FAIL";

  logger.info("qa", `QA ${status}`, { blockingIssues: blocking.length, warnings: issues.length - blocking.length });

  return {
    status,
    issues,
    programmaticChecks,
    visionCheck,
    checkedAt: nowIso(),
  };
}

function checkDuplicates(
  items: SelectedFact[],
  label: string,
  keyOf: (f: SelectedFact) => string,
  issues: QAIssue[],
  programmaticChecks: QAResult["programmaticChecks"]
): void {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const f of items) {
    const key = keyOf(f);
    if (seen.has(key)) dupes.push(key);
    seen.add(key);
  }
  const ok = dupes.length === 0;
  programmaticChecks.push({ name: `no_duplicates_${label}`, passed: ok, detail: dupes.join(", ") });
  if (!ok) issues.push({ severity: "blocking", message: `Duplicate entries in ${label}: ${dupes.join(", ")}` });
}

async function sampleCorners(imagePath: string): Promise<number[]> {
  const img = sharp(imagePath);
  const meta = await img.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) return [];
  const points: [number, number][] = [
    [0, 0],
    [w - 10, 0],
    [0, h - 10],
    [w - 10, h - 10],
  ];
  const results: number[] = [];
  for (const [x, y] of points) {
    const { data } = await sharp(imagePath)
      .extract({ left: Math.max(0, x), top: Math.max(0, y), width: 8, height: 8 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i]!;
    results.push(Math.round(sum / data.length));
  }
  return results;
}

async function runVisionCheck(
  config: AppConfig,
  logger: RunLogger,
  imagePath: string,
  selected: SelectedContent,
  mode: QAMode
): Promise<QAResult["visionCheck"]> {
  if (!config.qa.enableVisionCheck) {
    logger.info("qa", "Vision QA disabled (ENABLE_VISION_QA=false); relying on programmatic checks only");
    return { ran: false };
  }
  const client = makeOpenAIClient(config);
  if (!client) {
    logger.warn("qa", "OPENAI_API_KEY not set; skipping vision QA pass");
    return { ran: false };
  }

  try {
    const imageBase64 = readFileSync(imagePath).toString("base64");
    const mime = imagePath.endsWith(".jpg") || imagePath.endsWith(".jpeg") ? "image/jpeg" : "image/png";
    const result = await requestJsonWithImage<{ status: "PASS" | "FAIL"; issues: string[] }>(client, {
      model: config.qaVisionModel,
      system: mode === "art" ? ART_QA_VISION_SYSTEM_PROMPT : QA_VISION_SYSTEM_PROMPT,
      user: mode === "art" ? buildArtQaVisionUserPrompt() : buildQaVisionUserPrompt(JSON.stringify(selected, null, 2)),
      imageBase64,
      imageMime: mime,
    });
    logger.info("qa", `Vision QA returned ${result.status}`, { issues: result.issues });
    return { ran: true, status: result.status, issues: result.issues ?? [] };
  } catch (err) {
    logger.warn("qa", "Vision QA call failed; falling back to programmatic checks only", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ran: false };
  }
}
