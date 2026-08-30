import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ResearchOutput } from "../research/researchAgent.js";
import type { VerificationOutput } from "../verification/verifyAgent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = join(__dirname, "..", "..", "tests", "fixtures");

/**
 * Loads a hand-curated, source-audited fixture for offline/dev/test use
 * (`--fixture` CLI flag). This lets `npm run daily -- --date 2026-08-29
 * --fixture --dry-run` produce a real end-to-end infographic without an
 * OpenAI API key. Per the project spec, this fixture data is a TEST
 * FIXTURE only and must never be treated as the production research
 * path - it exists solely so the render/QA/caption/publish stages can be
 * exercised deterministically.
 */
export function loadFixture(monthDay: string): { research: ResearchOutput; verified: VerificationOutput } {
  const dir = fixtureDirFor(monthDay);
  const research = JSON.parse(readFileSync(join(dir, "research.json"), "utf-8")) as ResearchOutput;
  const verified = JSON.parse(readFileSync(join(dir, "verified.json"), "utf-8")) as VerificationOutput;
  return { research, verified };
}

function fixtureDirFor(monthDay: string): string {
  const known: Record<string, string> = { "08-29": "aug29" };
  const dirName = known[monthDay];
  if (!dirName) {
    throw new Error(
      `No fixture available for ${monthDay}. Fixtures currently only cover 08-29 (August 29). Omit --fixture to run against the live OpenAI research/verification pipeline instead.`
    );
  }
  return join(FIXTURES_ROOT, dirName);
}
