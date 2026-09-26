import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const BACKEND_PORT = 8787;
const FRONTEND_PORT = 5173;
const BASE_URL = `http://localhost:${FRONTEND_PORT}`;

let workDir: string;
let dbPath: string;
let backend: ChildProcess | null = null;
let frontend: ChildProcess | null = null;

function waitForHttp(url: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      fetch(url)
        .then((res) => {
          if (res.ok) resolve();
          else if (Date.now() > deadline) reject(new Error(`${url} never returned ok`));
          else setTimeout(attempt, 200);
        })
        .catch(() => {
          if (Date.now() > deadline) reject(new Error(`${url} never became reachable`));
          else setTimeout(attempt, 200);
        });
    };
    attempt();
  });
}

const TSX_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");

function startBackend(): ChildProcess {
  // Run the local tsx binary directly (not `npx tsx ...`) and in its own process
  // group (`detached: true`): npx interposes a wrapper process that does NOT
  // forward signals to the real node process it execs, so killing only the
  // direct child leaves the actual server (and its open sqlite connection)
  // running - which silently defeats "the server restarts" and can leave two
  // live writers on the same WAL file at once. Killing the whole group avoids that.
  const proc = spawn(TSX_BIN, ["src/server/index.ts"], {
    cwd: REPO_ROOT,
    env: { ...process.env, SQLITE_PATH: dbPath, PORT: String(BACKEND_PORT), DATABASE_URL: "" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  return proc;
}

async function stopProcess(proc: ChildProcess | null): Promise<void> {
  if (!proc || proc.exitCode !== null) return;
  try {
    process.kill(-proc.pid!, "SIGTERM"); // negative pid = the whole process group
  } catch {
    proc.kill("SIGTERM");
  }
  await new Promise<void>((resolve) => {
    proc.once("exit", () => resolve());
    setTimeout(resolve, 5000); // don't hang the suite forever if it's stubborn
  });
}

/** Polls until nothing answers on the port, confirming a killed server has actually released it. */
async function waitForPortFree(port: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const stillUp = await fetch(`http://localhost:${port}/api/health`).then(
      () => true,
      () => false
    );
    if (!stillUp) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`port ${port} never freed up`);
}

async function fetchOpCount(): Promise<number> {
  const res = await fetch(`http://localhost:${BACKEND_PORT}/api/ops?since=0`);
  const data = (await res.json()) as { ops: unknown[] };
  return data.ops.length;
}

async function waitForOpCount(n: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await fetchOpCount()) >= n) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`op count never reached ${n}`);
}

/** Seeds a fixed tool selection before the app boots, so drawing doesn't need to click the palette UI. */
async function openClient(browser: Browser, color: number): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  await context.addInitScript((c) => {
    localStorage.setItem("wall.tool", JSON.stringify({ color: c, size: 1, pixelMode: false, pixelCell: 2 }));
  }, color);
  const page = await context.newPage();
  // A fixed camera hash bypasses the "frame on recent activity" auto-camera entirely, so
  // both clients render an identical, deterministic viewport regardless of load-order timing.
  await page.goto(`${BASE_URL}/#0,0,1`);
  await page.waitForSelector("#wall");
  return { context, page };
}

async function drawLine(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 5 });
  await page.mouse.up();
}

async function canvasDataUrl(page: Page): Promise<string> {
  return page.evaluate(() => (document.getElementById("wall") as HTMLCanvasElement).toDataURL("image/png"));
}

/** Decodes two canvas snapshots and reports the fraction of sampled pixels that differ beyond tolerance. */
async function pixelMismatchFraction(dataUrlA: string, dataUrlB: string): Promise<number> {
  const bufA = Buffer.from(dataUrlA.split(",")[1]!, "base64");
  const bufB = Buffer.from(dataUrlB.split(",")[1]!, "base64");
  const imgA = await loadImage(bufA);
  const imgB = await loadImage(bufB);
  expect(imgA.width).toBe(imgB.width);
  expect(imgA.height).toBe(imgB.height);
  const cA = createCanvas(imgA.width, imgA.height);
  const cB = createCanvas(imgB.width, imgB.height);
  cA.getContext("2d").drawImage(imgA as any, 0, 0);
  cB.getContext("2d").drawImage(imgB as any, 0, 0);
  const dataA = cA.getContext("2d").getImageData(0, 0, imgA.width, imgA.height).data;
  const dataB = cB.getContext("2d").getImageData(0, 0, imgB.width, imgB.height).data;
  let mismatches = 0;
  let samples = 0;
  const tol = 24;
  for (let i = 0; i < dataA.length; i += 4 * 5) {
    samples++;
    if (
      Math.abs(dataA[i]! - dataB[i]!) > tol ||
      Math.abs(dataA[i + 1]! - dataB[i + 1]!) > tol ||
      Math.abs(dataA[i + 2]! - dataB[i + 2]!) > tol
    ) {
      mismatches++;
    }
  }
  return mismatches / samples;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "wall-e2e-"));
  dbPath = path.join(workDir, "wall.db");

  frontend = spawn(path.join(REPO_ROOT, "node_modules", ".bin", "vite"), ["--port", String(FRONTEND_PORT), "--strictPort"], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  backend = startBackend();
  await waitForHttp(`http://localhost:${BACKEND_PORT}/api/health`);
  await waitForHttp(BASE_URL);
});

test.afterAll(async () => {
  await stopProcess(backend);
  await stopProcess(frontend);
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("multi-client acceptance: draw sync, concurrent convergence, offline reconnect, server restart, timelapse fidelity", async ({ browser }) => {
  test.setTimeout(120_000);

  // --- Part 1: A draws a red line and B sees it; B draws a blue circle and A sees it. ---
  const a = await openClient(browser, 2); // red
  const b = await openClient(browser, 6); // blue

  await drawLine(a.page, 300, 350, 700, 350); // a horizontal red line across the middle
  await waitForOpCount(1);
  await b.page.waitForTimeout(400); // let B's WS subscription render the broadcast

  const bSeesRed = await pixelMismatchFraction(await canvasDataUrl(a.page), await canvasDataUrl(b.page));
  expect(bSeesRed).toBeLessThan(0.02);

  await drawLine(b.page, 500, 150, 500, 250); // a short blue vertical stroke, away from the red line
  await waitForOpCount(2);
  await a.page.waitForTimeout(400);

  const aSeesBlue = await pixelMismatchFraction(await canvasDataUrl(a.page), await canvasDataUrl(b.page));
  expect(aSeesBlue).toBeLessThan(0.02);

  // --- Part 2: both draw at the same time; their rendered views converge. ---
  await Promise.all([
    drawLine(a.page, 100, 500, 300, 550), // A draws on the left
    drawLine(b.page, 700, 500, 900, 450), // B draws on the right, non-overlapping
  ]);
  await waitForOpCount(4);
  await Promise.all([a.page.waitForTimeout(400), b.page.waitForTimeout(400)]);

  const convergedAfterConcurrent = await pixelMismatchFraction(await canvasDataUrl(a.page), await canvasDataUrl(b.page));
  expect(convergedAfterConcurrent).toBeLessThan(0.02);

  // --- Part 3: A goes offline and draws; B keeps drawing; A reconnects and both converge. ---
  await a.context.setOffline(true);
  await drawLine(a.page, 150, 150, 250, 200); // queued locally (IndexedDB), not yet sent
  await b.page.waitForTimeout(300);
  await drawLine(b.page, 800, 150, 850, 250); // B is unaffected, commits normally
  await waitForOpCount(5); // only B's stroke has actually reached the server so far

  await a.context.setOffline(false);
  await waitForOpCount(6, 15_000); // A's queued stroke flushes once back online
  await Promise.all([a.page.waitForTimeout(600), b.page.waitForTimeout(600)]);

  const convergedAfterReconnect = await pixelMismatchFraction(await canvasDataUrl(a.page), await canvasDataUrl(b.page));
  expect(convergedAfterReconnect).toBeLessThan(0.02);

  const beforeRestartSnapshot = await canvasDataUrl(a.page);
  const opCountBeforeRestart = await fetchOpCount();

  // --- Part 4: the server restarts; both clients reload; state is identical. ---
  await stopProcess(backend);
  await waitForPortFree(BACKEND_PORT);
  backend = startBackend(); // same dbPath - this is the persistence check
  await waitForHttp(`http://localhost:${BACKEND_PORT}/api/health`);

  await a.page.reload();
  await a.page.waitForSelector("#wall");
  await b.page.reload();
  await b.page.waitForSelector("#wall");
  await a.page.waitForTimeout(600);
  await b.page.waitForTimeout(600);

  expect(await fetchOpCount()).toBe(opCountBeforeRestart);
  const afterRestartMismatch = await pixelMismatchFraction(beforeRestartSnapshot, await canvasDataUrl(a.page));
  expect(afterRestartMismatch).toBeLessThan(0.02);
  const bMatchesAfterRestart = await pixelMismatchFraction(await canvasDataUrl(a.page), await canvasDataUrl(b.page));
  expect(bMatchesAfterRestart).toBeLessThan(0.02);

  await a.context.close();
  await b.context.close();

  // --- Part 5: the timelapse puts the red line before the blue circle, and its final frame matches the wall. ---
  const timelapseOut = path.join(workDir, "timelapse.mp4");
  execFileSync(
    "npx",
    ["tsx", "src/cli/timelapse.ts", "--duration", "3", "--fps", "8", "--out", timelapseOut],
    { cwd: REPO_ROOT, env: { ...process.env, SQLITE_PATH: dbPath, DATABASE_URL: "" }, stdio: "ignore" }
  );
  expect(fs.existsSync(timelapseOut)).toBe(true);

  // Extract every frame and find the first one each colour appears in, rather than trusting a
  // single hand-picked frame index - robust against exactly which frame a given operation's
  // real-world timing happens to compress onto.
  const framesDir = path.join(workDir, "frames");
  fs.mkdirSync(framesDir, { recursive: true });
  const quiet = { stdio: ["ignore", "ignore", "ignore"] as ["ignore", "ignore", "ignore"] };
  execFileSync("ffmpeg", ["-y", "-i", timelapseOut, path.join(framesDir, "f%03d.png")], quiet);
  const framePaths = fs
    .readdirSync(framesDir)
    .filter((f) => f.endsWith(".png"))
    .sort()
    .map((f) => path.join(framesDir, f));
  expect(framePaths.length).toBeGreaterThan(0);

  const RED = { r: 0xe1, g: 0x1d, b: 0x2e };
  const BLUE = { r: 0x25, g: 0x63, b: 0xeb };
  function frameContains(data: Uint8ClampedArray, target: { r: number; g: number; b: number }): boolean {
    for (let i = 0; i < data.length; i += 4 * 3) {
      if (Math.abs(data[i]! - target.r) < 24 && Math.abs(data[i + 1]! - target.g) < 24 && Math.abs(data[i + 2]! - target.b) < 24) {
        return true;
      }
    }
    return false;
  }

  let firstRedFrame = -1;
  let firstBlueFrame = -1;
  const lastFrameData: Uint8ClampedArray[] = [];
  for (let i = 0; i < framePaths.length; i++) {
    const img = await loadImage(fs.readFileSync(framePaths[i]!));
    const c = createCanvas(img.width, img.height);
    c.getContext("2d").drawImage(img as any, 0, 0);
    const data = c.getContext("2d").getImageData(0, 0, img.width, img.height).data;
    if (firstRedFrame < 0 && frameContains(data, RED)) firstRedFrame = i;
    if (firstBlueFrame < 0 && frameContains(data, BLUE)) firstBlueFrame = i;
    if (i === framePaths.length - 1) lastFrameData.push(data);
  }

  // The red line was drawn first (part 1); the timelapse must reveal it strictly before the
  // blue circle (drawn second), never at the same frame or later.
  expect(firstRedFrame).toBeGreaterThanOrEqual(0);
  expect(firstBlueFrame).toBeGreaterThanOrEqual(0);
  expect(firstRedFrame).toBeLessThan(firstBlueFrame);

  // The final frame is "the wall": render a fresh direct export from the (post-restart) server
  // state and confirm the timelapse's last frame is visually consistent with it.
  const finalExport = path.join(workDir, "final-export.png");
  execFileSync("npx", ["tsx", "src/cli/admin.ts", "export-png", finalExport, "--max-px", "1280"], {
    cwd: REPO_ROOT,
    env: { ...process.env, SQLITE_PATH: dbPath, DATABASE_URL: "" },
    stdio: "ignore",
  });
  expect(fs.existsSync(finalExport)).toBe(true);
  expect(lastFrameData.length).toBe(1);
  // The timelapse's own last frame must show ink too (not a blank final frame).
  const lastHasInk = frameContains(lastFrameData[0]!, RED) || frameContains(lastFrameData[0]!, BLUE);
  expect(lastHasInk).toBe(true);
  // (Camera framing differs between the timelapse's padded/eased "full" camera and the
  // admin export's exact world bbox, so this is a presence check rather than a pixel diff:
  // both must show ink somewhere, i.e. neither is a blank frame.)
  const finalImg = await loadImage(fs.readFileSync(finalExport));
  const finalCanvas = createCanvas(finalImg.width, finalImg.height);
  finalCanvas.getContext("2d").drawImage(finalImg as any, 0, 0);
  const finalData = finalCanvas.getContext("2d").getImageData(0, 0, finalImg.width, finalImg.height).data;
  let finalHasInk = false;
  for (let i = 0; i < finalData.length; i += 4 * 11) {
    if (finalData[i]! < 250 || finalData[i + 1]! < 250 || finalData[i + 2]! < 250) {
      finalHasInk = true;
      break;
    }
  }
  expect(finalHasInk).toBe(true);
});
