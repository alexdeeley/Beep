import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { nowIso } from "./dateUtils.js";

export type LogLevel = "info" | "warn" | "error" | "debug";

interface LogEntry {
  ts: string;
  level: LogLevel;
  stage: string;
  message: string;
  data?: unknown;
}

/**
 * Structured logger that writes readable lines to stdout and appends
 * JSON-lines to `runs/<date>/run.log` so a failed run can be diagnosed
 * after the fact without re-running anything.
 */
export class RunLogger {
  private readonly runDir: string;

  constructor(runDir: string) {
    this.runDir = runDir;
    mkdirSync(runDir, { recursive: true });
  }

  private write(level: LogLevel, stage: string, message: string, data?: unknown): void {
    const entry: LogEntry = { ts: nowIso(), level, stage, message, data };
    const line = `[${entry.ts}] ${level.toUpperCase().padEnd(5)} ${stage.padEnd(14)} ${message}${
      data !== undefined ? " " + safeJson(data) : ""
    }`;
    // eslint-disable-next-line no-console
    (level === "error" ? console.error : console.log)(line);
    try {
      appendFileSync(join(this.runDir, "run.log"), line + "\n");
      appendFileSync(join(this.runDir, "run.jsonl"), JSON.stringify(entry) + "\n");
    } catch {
      // Logging must never crash the pipeline.
    }
  }

  info(stage: string, message: string, data?: unknown): void {
    this.write("info", stage, message, data);
  }
  warn(stage: string, message: string, data?: unknown): void {
    this.write("warn", stage, message, data);
  }
  error(stage: string, message: string, data?: unknown): void {
    this.write("error", stage, message, data);
  }
  debug(stage: string, message: string, data?: unknown): void {
    this.write("debug", stage, message, data);
  }
}

function safeJson(data: unknown): string {
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}
