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
import type { ResearchOutput } from "../research/researchAgent.js";
import type { VerificationOutput } from "../verification/verifyAgent.js";
import type { SelectedContent } from "../utils/types.js";
import type { RenderResult } from "../render/renderInfographic.js";
import { runNewswireCycle } from "../newswire/runNewswireCycle.js";
import { getNewswireStatus } from "../newswire/status.js";
import { downloadStoryDb } from "../newswire/db/sync.js";
import { openStoryDb, closeStoryDb } from "../newswire/db/connection.js";
import { createBlueskySession } from "../bluesky/threadPublish.js";
import { listAllPosts, deleteAllPosts } from "../bluesky/deleteAllPosts.js";
import { postSampleFestival, type SampleFestivalInput } from "../newswire/festivalPosters/postSampleFestival.js";

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
  .command("news:preview")
  .description(
    "Run the festival-poster finder for real (real web search, real model calls) but NEVER publish and NEVER persist story database changes back to R2 - safe to run repeatedly while iterating"
  )
  .action(async () => {
    const summary = await runNewswireCycle(config, { dryRun: true });
    console.log(`\n=== Newswire preview (run ${summary.hourlyRunId}) ===`);
    console.log(`Publish status: ${summary.publishStatus}`);
    console.log(`Posts that would publish: ${summary.publishedPostCount}`);
  });

program
  .command("news:publish")
  .description("Run the festival-poster finder and publish to Bluesky any major festival poster found")
  .action(async () => {
    const summary = await runNewswireCycle(config, { dryRun: false });
    console.log(`\n=== Newswire run ${summary.hourlyRunId} ===`);
    console.log(`Publish status: ${summary.publishStatus}`);
    console.log(`Posts published: ${summary.publishedPostCount}`);
  });

program
  .command("news:status")
  .description("Print a read-only status summary of the festival-poster finder's story database (last run, posters posted)")
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
  .command("news:post-sample")
  .description(
    "Manually posts a single, already-researched festival poster, bypassing discovery/verification - for curating " +
      "specific sample/demo posts. Takes a JSON file with: festivalName, eventYear, blurb, lineupArtists, " +
      "primarySourceUrl. The poster image is still only ever the real, mechanically-extracted bytes from that " +
      "exact URL (see extractPosterImage.ts) - this never posts a hand-picked image."
  )
  .requiredOption("--file <path>", "Path to a JSON file with the pre-researched festival data (SampleFestivalInput shape)")
  .option("--dry-run", "Never actually publish; just report what would happen", false)
  .action(async (opts) => {
    const { readFileSync } = await import("node:fs");
    const input = JSON.parse(readFileSync(opts.file, "utf8")) as SampleFestivalInput;
    const result = await postSampleFestival(config, input, { dryRun: Boolean(opts.dryRun) });
    if (result.published) {
      console.log(`Published: ${result.uri}`);
    } else if (opts.dryRun) {
      console.log("Dry run complete - see logs above for what would have been posted.");
    } else {
      console.log(`Not published: ${result.reason ?? "unknown reason"}`);
      process.exitCode = 1;
    }
  });

program
  .command("news:delete-all-posts")
  .description(
    "Permanently deletes every post currently on the configured Bluesky account - irreversible. Writes a backup " +
      "of every deleted post's URI/CID to runs/news/ before deleting anything. Requires " +
      "CONFIRM_DELETE_ALL_POSTS=yes-delete-everything as a safety gate against an accidental run."
  )
  .action(async () => {
    if (process.env.CONFIRM_DELETE_ALL_POSTS !== "yes-delete-everything") {
      console.error(
        'Refusing to run: this permanently deletes every post on the account. Set CONFIRM_DELETE_ALL_POSTS="yes-delete-everything" to proceed.'
      );
      process.exitCode = 1;
      return;
    }
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const runDir = join(config.paths.runsDir, "news", `delete-all-posts-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    const logger = new RunLogger(runDir);

    const session = await createBlueskySession(config);
    const posts = await listAllPosts(config, session);
    console.log(`Found ${posts.length} post(s) on the account.`);

    mkdirSync(runDir, { recursive: true });
    const backupPath = join(runDir, "deleted-posts-backup.json");
    writeFileSync(backupPath, JSON.stringify(posts, null, 2));
    console.log(`Backed up ${posts.length} post URI/CID pair(s) to ${backupPath}`);

    const deleted = await deleteAllPosts(config, logger, session, posts);
    console.log(`Deleted ${deleted} of ${posts.length} post(s).`);
    if (deleted !== posts.length) process.exitCode = 1;
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
