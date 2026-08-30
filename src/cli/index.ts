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
  runAssetsStage,
  runRenderStage,
  runQAStage,
  runCaptionStage,
  runPublishStage,
  runDailyHistoricalPost,
} from "../orchestration/runDaily.js";
import type { ResearchOutput } from "../research/researchAgent.js";
import type { VerificationOutput } from "../verification/verifyAgent.js";
import type { DecorativeAsset, SelectedContent } from "../utils/types.js";
import type { RenderResult } from "../render/renderInfographic.js";

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
  .description("Render the infographic from an existing selected.json (regenerates the graphic without rerunning research)")
  .option("--date <YYYY-MM-DD>", "Local publish date (defaults to today)")
  .action(async (opts) => {
    const ctx = makeRunContext(config, opts.date);
    const selected = requireStage<SelectedContent>(ctx.store, "selected.json", "select");
    const assets = ctx.store.tryReadJson<DecorativeAsset[]>("assets.json") ?? (await runAssetsStage(ctx, selected));
    const result = await runRenderStage(ctx, selected, assets);
    console.log(`Rendered feed image: ${result.feed.imagePath} (${result.feed.width}x${result.feed.height}, scale ${result.feed.scale.toFixed(3)})`);
    if (result.story) console.log(`Rendered story image: ${result.story.imagePath}`);
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
    const caption = ctx.store.tryReadJson<{ caption: string; hashtags: string[] }>("caption.json");
    if (!caption) throw new Error(`Missing caption.json for this date. Run the "caption" stage first.`);
    const record = await runPublishStage(ctx, selected, render, caption, Boolean(opts.dryRun));
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
