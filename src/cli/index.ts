#!/usr/bin/env node
import { Command } from "commander";
import { config } from "../config/index.js";
import { RunLogger } from "../utils/logger.js";
import { RunStore } from "../utils/stateStore.js";
import { resolveLocalDate } from "../utils/dateUtils.js";
import {
  makeRunContext,
  runResearchStage,
  runVerificationStage,
  runSelectionStage,
  runTrendingStage,
  runTrendCurationStage,
  runRenderStage,
  runQAStage,
  runCaptionStage,
  runPublishStage,
  runDailyHistoricalPost,
} from "../orchestration/runDaily.js";
import { runWeeklyCardPost } from "../weeklyCard/runWeekly.js";
import type { ResearchOutput } from "../research/researchAgent.js";
import type { VerificationOutput } from "../verification/verifyAgent.js";
import type { SelectedContent } from "../utils/types.js";
import type { RenderResult } from "../render/renderInfographic.js";
import { runNewswireCycle } from "../newswire/runNewswireCycle.js";
import { getNewswireStatus } from "../newswire/status.js";
import { downloadStoryDb } from "../newswire/db/sync.js";
import { openStoryDb, closeStoryDb } from "../newswire/db/connection.js";

const program = new Command();
program.name("on-this-day").description("Autonomous On This Day historical infographic pipeline");

function requireStage<T>(store: RunStore, file: string, label: string): T {
  const data = store.tryReadJson<T>(file);
  if (!data) {
    throw new Error(`Missing ${file} for this date. Run the "${label}" stage first (or the earlier stage that produces it).`);
  }
  return data;
}

program
  .command("research")
  .description("Run the research stage only and save runs/<date>/research.json")
  .option("--date <YYYY-MM-DD>", "Local publish date to research (defaults to today in APP_TIMEZONE)")
  .option("--fixture", "Load the bundled test fixture instead of calling OpenAI (only 08-29 available)", false)
  .action(async (opts) => {
    const ctx = makeRunContext(config, opts.date);
    const output = await runResearchStage(ctx, Boolean(opts.fixture));
    console.log(`Saved ${output.candidates.length} candidates to ${ctx.store.path("research.json")}`);
  });

program
  .command("verify")
  .description("Run the verification stage against an existing research.json")
  .option("--date <YYYY-MM-DD>", "Local publish date (defaults to today)")
  .option("--fixture", "Load the bundled test fixture instead of calling OpenAI (only 08-29 available)", false)
  .action(async (opts) => {
    const ctx = makeRunContext(config, opts.date);
    const research = opts.fixture
      ? null
      : requireStage<ResearchOutput>(ctx.store, "research.json", "research");
    const output = await runVerificationStage(ctx, research?.candidates ?? [], Boolean(opts.fixture));
    console.log(`Verified: ${output.summary.verifiedCount} | rejected: ${output.summary.rejectedCount} | needs review: ${output.summary.needsReviewCount}`);
    console.log(`Saved to ${ctx.store.path("verified.json")}`);
  });

program
  .command("select")
  .description("Run content selection against an existing verified.json")
  .option("--date <YYYY-MM-DD>", "Local publish date (defaults to today)")
  .action(async (opts) => {
    const ctx = makeRunContext(config, opts.date);
    const verification = requireStage<VerificationOutput>(ctx.store, "verified.json", "verify");
    const selected = runSelectionStage(ctx, verification.verified);
    console.log(
      `Selected ${selected.majorEvents.length} events, ${selected.births.length} births, ${selected.deaths.length} deaths, ${selected.incidents.length} incidents`
    );
    console.log(`Saved to ${ctx.store.path("selected.json")}`);
  });

program
  .command("render")
  .description("Generate the day's abstract art image from an existing selected.json (regenerates the image without rerunning research)")
  .option("--date <YYYY-MM-DD>", "Local publish date (defaults to today)")
  .action(async (opts) => {
    const ctx = makeRunContext(config, opts.date);
    const selected = requireStage<SelectedContent>(ctx.store, "selected.json", "select");
    const trendingTopics = await runTrendingStage(ctx);
    const curatedTrends = await runTrendCurationStage(ctx, selected, trendingTopics);
    const result = await runRenderStage(ctx, selected, curatedTrends);
    console.log(`Generated feed image: ${result.feed.imagePath} (${result.feed.width}x${result.feed.height})`);
    if (result.story) console.log(`Generated story image: ${result.story.imagePath}`);
  });

program
  .command("qa")
  .description("Run automated QA against an existing render")
  .option("--date <YYYY-MM-DD>", "Local publish date (defaults to today)")
  .action(async (opts) => {
    const ctx = makeRunContext(config, opts.date);
    const selected = requireStage<SelectedContent>(ctx.store, "selected.json", "select");
    const render = requireStage<RenderResult>(ctx.store, "render.json", "render");
    const qa = await runQAStage(ctx, selected, render);
    console.log(`QA status: ${qa.status}`);
    for (const issue of qa.issues) console.log(`  [${issue.severity}] ${issue.message}`);
  });

program
  .command("caption")
  .description("Generate the caption for an existing selected.json")
  .option("--date <YYYY-MM-DD>", "Local publish date (defaults to today)")
  .action(async (opts) => {
    const ctx = makeRunContext(config, opts.date);
    const selected = requireStage<SelectedContent>(ctx.store, "selected.json", "select");
    const caption = await runCaptionStage(ctx, selected);
    console.log(`Title: ${caption.title}`);
    console.log("");
    console.log(caption.caption);
    console.log("");
    console.log(caption.hashtags.join(" "));
  });

program
  .command("publish")
  .description("Upload the rendered image and publish to Bluesky (or --dry-run to simulate)")
  .option("--date <YYYY-MM-DD>", "Local publish date (defaults to today)")
  .option("--dry-run", "Never actually publish; just report what would happen", false)
  .action(async (opts) => {
    const ctx = makeRunContext(config, opts.date);
    const selected = requireStage<SelectedContent>(ctx.store, "selected.json", "select");
    const render = requireStage<RenderResult>(ctx.store, "render.json", "render");
    const caption = ctx.store.tryReadJson<{ title: string; caption: string; hashtags: string[] }>("caption.json");
    if (!caption) throw new Error(`Missing caption.json for this date. Run the "caption" stage first.`);
    const trendingTopics = await runTrendingStage(ctx);
    const record = await runPublishStage(ctx, selected, render, caption, trendingTopics, Boolean(opts.dryRun));
    console.log(`Publish status: ${record.status}`);
    if (record.postUri) console.log(`Bluesky post URI: ${record.postUri}`);
    if (record.error) console.log(`Error: ${record.error}`);
  });

program
  .command("daily")
  .description("Run the full end-to-end daily pipeline (research -> ... -> publish)")
  .option("--date <YYYY-MM-DD>", "Local publish date (defaults to today in APP_TIMEZONE)")
  .option("--dry-run", "Run the entire pipeline but never actually publish to Bluesky", false)
  .option("--fixture", "Use the bundled test fixture instead of calling OpenAI for research/verification (only 08-29 available)", false)
  .action(async (opts) => {
    const summary = await runDailyHistoricalPost(config, {
      dateOverride: opts.date,
      dryRun: Boolean(opts.dryRun),
      fixture: Boolean(opts.fixture),
    });
    console.log(`\n=== Run summary for ${summary.record.date} ===`);
    for (const [stage, s] of Object.entries(summary.record.stages)) {
      console.log(`  ${stage.padEnd(16)} ${s.status}${s.detail ? " — " + s.detail : ""}`);
    }
    console.log(`Publish status: ${summary.record.publishStatus ?? "N/A"}`);
    if (summary.record.failureStage) {
      console.log(`Failed at stage: ${summary.record.failureStage}`);
      process.exitCode = 1;
    } else if (summary.record.publishStatus === "FAILED") {
      // A failed publish doesn't throw a StageFailure (it's recorded as
      // data, not an exception - see runPublishStage), so it must be
      // checked separately here. Without this, a real publish failure
      // would report `Publish status: FAILED` yet still exit 0, making a
      // scheduled CI run show green while silently never posting.
      console.log(`Failed to publish: ${summary.publish?.error ?? "unknown error"}`);
      process.exitCode = 1;
    }
  });

program
  .command("weekly")
  .description("Run the independent weekly 'card draw' pipeline (see src/weeklyCard/) - fully separate from the daily pipeline")
  .option("--date <YYYY-MM-DD>", "Local run date (defaults to today in APP_TIMEZONE; normally a Sunday, but any date works for testing)")
  .option("--dry-run", "Run the entire pipeline but never actually publish to Bluesky", false)
  .option("--force-decade", "Test-only: force the once-a-decade special post regardless of the anchor-date math", false)
  .action(async (opts) => {
    const summary = await runWeeklyCardPost(config, {
      dateOverride: opts.date,
      dryRun: Boolean(opts.dryRun),
      forceDecade: Boolean(opts.forceDecade),
    });
    console.log(`\n=== Weekly card run summary for ${summary.isoDate} ===`);
    console.log(`  retired:    ${summary.retired}`);
    console.log(`  card:       ${summary.card}`);
    console.log(`  decade:     ${summary.isDecade}`);
    console.log(`  qa:         ${summary.qa?.status ?? "N/A"}`);
    console.log(`  publish:    ${summary.publish?.status ?? "N/A"}`);
    if (summary.qa && summary.qa.status !== "PASS") {
      console.log(`Failed at QA: ${summary.qa.issues.map((i) => i.message).join(" | ")}`);
      process.exitCode = 1;
    } else if (summary.publish?.status === "FAILED") {
      console.log(`Failed to publish: ${summary.publish.error ?? "unknown error"}`);
      process.exitCode = 1;
    }
  });

program
  .command("news:preview")
  .description(
    "Run the full hourly music release-announcement pipeline for real (real Spotify API calls, real model calls) but NEVER publish and NEVER persist story database changes back to R2 - safe to run repeatedly while iterating"
  )
  .option("--force", "Bypass the quiet-hours silence check, for manual testing", false)
  .action(async (opts) => {
    const summary = await runNewswireCycle(config, { dryRun: true, forceRun: Boolean(opts.force) });
    console.log(`\n=== Newswire preview (run ${summary.hourlyRunId}) ===`);
    console.log(`Quiet-hours outcome: ${summary.quietHoursOutcome}`);
    console.log(`Publish status: ${summary.publishStatus}`);
    if (summary.editionPreview && summary.editionPreview.length > 0) {
      console.log(`\nProposed thread (${summary.editionPreview.length} post(s)):`);
      summary.editionPreview.forEach((p, i) => console.log(`  [${i + 1}] ${p.text}`));
    } else {
      console.log("\nNo edition produced this run (silence, or blocked by fact-check/duplicate-check).");
    }
  });

program
  .command("news:publish")
  .description("Run the full hourly music release-announcement pipeline and publish to Bluesky if there's a new release worth posting")
  .option("--force", "Bypass the quiet-hours silence check, for manual testing", false)
  .action(async (opts) => {
    const summary = await runNewswireCycle(config, { dryRun: false, forceRun: Boolean(opts.force) });
    console.log(`\n=== Newswire run ${summary.hourlyRunId} ===`);
    console.log(`Quiet-hours outcome: ${summary.quietHoursOutcome}`);
    console.log(`Publish status: ${summary.publishStatus}`);
    console.log(`Posts published: ${summary.publishedPostCount}`);
    if (summary.publishStatus === "failed") process.exitCode = 1;
  });

program
  .command("news:status")
  .description("Print a read-only status summary of the newswire pipeline's story database (last run, artist resolution progress, recent releases posted)")
  .action(async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const tempDir = mkdtempSync(join(tmpdir(), "newswire-status-db-"));
    const dbPath = join(tempDir, "story.db");
    const logger = new RunLogger(join(tempDir, "logs"));
    try {
      await downloadStoryDb(config, logger, dbPath);
      const db = openStoryDb(dbPath);
      try {
        const status = getNewswireStatus(db);
        console.log(JSON.stringify(status, null, 2));
      } finally {
        closeStoryDb(db);
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

program
  .command("inspect")
  .description("Print the final selected.json content for a date")
  .option("--date <YYYY-MM-DD>", "Local publish date (defaults to today)")
  .option("--stage <name>", "Which artifact to print: selected|verified|research|qa|publish", "selected")
  .action(async (opts) => {
    const resolved = resolveLocalDate(config.timezone, opts.date);
    const store = new RunStore(config, resolved.isoDate);
    const fileMap: Record<string, string> = {
      selected: "selected.json",
      verified: "verified.json",
      research: "research.json",
      qa: "qa.json",
      publish: "publish.json",
    };
    const file = fileMap[opts.stage] ?? "selected.json";
    const data = store.tryReadJson(file);
    if (!data) {
      console.error(`No ${file} found for ${resolved.isoDate}.`);
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(data, null, 2));
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(`\nFatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});

// Re-export for tests that want to construct a logger without going through the CLI.
export { RunLogger };
