import { viewportWorldBBox, type Camera } from "../shared/coords.js";
import { WallStore } from "./store.js";
import { WallNet } from "./net.js";
import { setupPalette } from "./ui.js";
import { InputController } from "./input.js";
import { drawFrame } from "./render.js";
import { initialCamera, writeCameraToHash } from "./camera.js";
import type { DrawContext2D } from "../shared/draw.js";

async function main() {
  const canvas = document.getElementById("wall") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d") as unknown as DrawContext2D;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    (ctx as unknown as { setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => void }).setTransform(
      dpr,
      0,
      0,
      dpr,
      0,
      0
    );
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);
  resize();

  const store = new WallStore();
  const net = new WallNet(store);
  const tool = setupPalette();

  const cam = await initialCamera();

  let lastViewportSent: Camera | null = null;
  let hashWriteTimer: number | null = null;

  const input = new InputController(canvas, cam, net, store, tool, (camera) => {
    // viewport re-subscription is cheap and idempotent server-side; only
    // send it when the world region actually changed meaningfully.
    if (
      !lastViewportSent ||
      Math.abs(camera.x - lastViewportSent.x) > 32 / camera.z ||
      Math.abs(camera.y - lastViewportSent.y) > 32 / camera.z ||
      Math.abs(camera.z - lastViewportSent.z) / lastViewportSent.z > 0.05
    ) {
      lastViewportSent = { ...camera };
      net.updateViewport(viewportWorldBBox(camera, window.innerWidth, window.innerHeight));
    }
    if (hashWriteTimer != null) clearTimeout(hashWriteTimer);
    hashWriteTimer = window.setTimeout(() => writeCameraToHash(camera), 250);
  });

  net.updateViewport(viewportWorldBBox(cam, window.innerWidth, window.innerHeight));
  lastViewportSent = { ...cam };

  function frame() {
    drawFrame(ctx, window.innerWidth, window.innerHeight, input.getCamera(), store, {
      active: tool.get().pixelMode,
      cell: tool.get().pixelCell,
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main();
