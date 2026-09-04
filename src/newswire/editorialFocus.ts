import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const quietHoursSchema = z.object({
  timezone: z.string().min(1),
  slowStartHourLocal: z.number().int().min(0).max(23),
  slowEndHourLocal: z.number().int().min(0).max(23),
  minImportanceScoreDuringSlow: z.number().min(0).max(1),
  minImportanceScoreDuringSilentThreshold: z.number().min(0).max(1),
});

const voiceSchema = z.object({
  allowJokes: z.boolean(),
  allowHashtagsInline: z.boolean(),
  allowEmoji: z.boolean(),
  allowRhetoricalQuestions: z.boolean(),
});

export const editorialFocusSchema = z.object({
  $schemaVersion: z.number().int(),
  neutralityNote: z.string().min(1),
  /** Ordered (most to least authoritative) list of source tiers the verification stage classifies every source into. */
  sourceTiers: z.array(z.string().min(1)).min(1),
  /** Named music-trade publishers (Pitchfork, Billboard, ...) recognized as the "entertainment_trade" tier during verification. */
  entertainmentTradePublishers: z.array(z.string()).default([]),
  /** Artist names (must match watched-artists.txt exactly) that get VIP treatment: always bypass quiet hours, jump the queue ahead of everything else, never held for the Friday album roundup, and get a "HUGE NEWS:" label instead of the normal flat wire tone. */
  priorityArtists: z.array(z.string().min(1)).default([]),
  quietHours: quietHoursSchema,
  voice: voiceSchema,
});

export type EditorialFocus = z.infer<typeof editorialFocusSchema>;

/**
 * JSON.parse that tolerates `//` line comments, since editorial-focus.json
 * is hand-edited by the user and JSON has no native comment syntax. Only
 * strips `//` that appears outside of a string literal.
 */
function stripJsonComments(raw: string): string {
  let out = "";
  let inString = false;
  let escapeNext = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (inString) {
      out += ch;
      if (escapeNext) {
        escapeNext = false;
      } else if (ch === "\\") {
        escapeNext = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < raw.length && raw[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    out += ch;
  }
  return out;
}

export function loadEditorialFocus(path: string): EditorialFocus {
  const absPath = resolve(process.cwd(), path);
  let raw: string;
  try {
    raw = readFileSync(absPath, "utf8");
  } catch (err) {
    throw new Error(
      `editorial-focus.json not found at "${absPath}". Copy the repo-root editorial-focus.json or set EDITORIAL_FOCUS_PATH. (${(err as Error).message})`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(raw));
  } catch (err) {
    throw new Error(`editorial-focus.json at "${absPath}" is not valid JSON: ${(err as Error).message}`);
  }

  const result = editorialFocusSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `editorial-focus.json at "${absPath}" failed validation:\n${result.error.issues
        .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
        .join("\n")}`
    );
  }
  return result.data;
}
