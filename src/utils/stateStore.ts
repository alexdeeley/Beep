import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../config/index.js";
import type { PublishRecord } from "./types.js";

/**
 * Filesystem-backed run store. Each date gets its own directory under
 * `runs/<date>/` holding every artifact the pipeline produced for that
 * day, per the project spec:
 *
 *   runs/2026-08-29/research.json
 *   runs/2026-08-29/verified.json
 *   runs/2026-08-29/selected.json
 *   runs/2026-08-29/caption.txt
 *   runs/2026-08-29/infographic.png
 *   runs/2026-08-29/story.png
 *   runs/2026-08-29/qa.json
 *   runs/2026-08-29/publish.json
 *   runs/2026-08-29/run.json
 *   runs/2026-08-29/run.log
 */
export class RunStore {
  readonly dir: string;

  constructor(config: AppConfig, date: string) {
    this.dir = join(config.paths.runsDir, date);
    mkdirSync(this.dir, { recursive: true });
    mkdirSync(join(this.dir, "assets"), { recursive: true });
  }

  path(file: string): string {
    return join(this.dir, file);
  }

  exists(file: string): boolean {
    return existsSync(this.path(file));
  }

  writeJson(file: string, data: unknown): void {
    writeFileSync(this.path(file), JSON.stringify(data, null, 2) + "\n", "utf-8");
  }

  readJson<T>(file: string): T {
    return JSON.parse(readFileSync(this.path(file), "utf-8")) as T;
  }

  tryReadJson<T>(file: string): T | null {
    if (!this.exists(file)) return null;
    return this.readJson<T>(file);
  }

  writeText(file: string, text: string): void {
    writeFileSync(this.path(file), text, "utf-8");
  }

  readText(file: string): string {
    return readFileSync(this.path(file), "utf-8");
  }
}

/**
 * Idempotency guard: has this calendar date already been successfully
 * published? Checked by reading `publish.json` for the date, which is
 * only ever written with status "SUCCESS" after a confirmed Instagram
 * publish. This is the single source of truth the orchestrator consults
 * before doing any paid/networked work.
 */
export function isAlreadyPublished(config: AppConfig, date: string): boolean {
  const path = join(config.paths.runsDir, date, "publish.json");
  if (!existsSync(path)) return false;
  try {
    const record = JSON.parse(readFileSync(path, "utf-8")) as PublishRecord;
    return record.status === "SUCCESS";
  } catch {
    // A corrupt/partial publish.json must never be treated as "already published" -
    // that would silently block a legitimate retry. Treat as not-yet-published.
    return false;
  }
}
