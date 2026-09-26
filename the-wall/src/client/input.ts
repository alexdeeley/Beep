import {
  screenToWorld,
  zoomAroundScreenPoint,
  quantize,
  bboxOfPoints,
  clampZoom,
  type Camera,
} from "../shared/coords.js";
import { smoothPoints } from "../shared/smoothing.js";
import { SIZES, isValidPixelCellSize } from "../shared/palette.js";
import { MAX_POINTS_PER_STROKE, MAX_CELLS_PER_PIXELS_OP } from "../shared/types.js";
import type { PointSample, StrokeOp, PixelsOp } from "../shared/types.js";
import { getSessionId } from "./session.js";
import type { WallNet } from "./net.js";
import type { WallStore } from "./store.js";
import type { ToolState } from "./ui.js";
import { setCursorPosition } from "./ui.js";

const CHUNK_INTERVAL_MS = 50;
/** If a second touch lands this soon after the first, the first was the start of a pan/zoom, not a stroke. */
const SECOND_TOUCH_CANCEL_WINDOW_MS = 100;
const INERTIA_FRICTION = 0.92;
const INERTIA_MIN_SPEED = 0.01; // px/ms

type Mode = "idle" | "draw" | "pan" | "pan-zoom";

function quantizePoint(p: PointSample): PointSample {
  return { x: quantize(p.x), y: quantize(p.y), p: p.p };
}

export class InputController {
  private camera: Camera;
  private pointers = new Map<number, { x: number; y: number }>();
  private firstPointerDownAt = 0;
  private mode: Mode = "idle";
  private spaceHeld = false;

  // freehand stroke state
  private strokeId: string | null = null;
  private strokePoints: PointSample[] = [];
  private lastChunkSentAt = 0;

  // pixel-mode state
  private pixelOpId: string | null = null;
  private pixelCells = new Map<string, [number, number]>();

  // single-pointer pan / two-pointer pinch-zoom state (anchored to gesture start, never drifts)
  private gestureStartCam: Camera = { x: 0, y: 0, z: 1 };
  private gestureStartMid = { x: 0, y: 0 };
  private gestureStartDist = 1;
  private lastMoveScreen = { x: 0, y: 0 };
  private lastMoveTime = 0;
  private panVelocity = { x: 0, y: 0 }; // px/ms, screen space
  private inertiaRAF: number | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    initialCamera: Camera,
    private net: WallNet,
    private store: WallStore,
    private tool: ToolState,
    private onCameraChange: (cam: Camera) => void
  ) {
    this.camera = initialCamera;
    this.attach();
  }

  getCamera(): Camera {
    return this.camera;
  }

  private setCamera(cam: Camera): void {
    this.camera = cam;
    this.onCameraChange(cam);
  }

  private vw(): number {
    return window.innerWidth;
  }
  private vh(): number {
    return window.innerHeight;
  }
  private toWorld(sx: number, sy: number) {
    return screenToWorld(this.camera, this.vw(), this.vh(), sx, sy);
  }

  private attach(): void {
    const c = this.canvas;
    c.addEventListener("pointerdown", this.onPointerDown);
    c.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
    c.addEventListener("wheel", this.onWheel, { passive: false });
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space") this.spaceHeld = true;
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") this.spaceHeld = false;
    });
    window.addEventListener("blur", () => {
      this.spaceHeld = false;
    });
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);
    this.stopInertia(); // panning inertia must never bleed into a new gesture, drawing included
    const now = performance.now();
    if (this.pointers.size === 0) this.firstPointerDownAt = now;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const isMiddle = e.button === 1;
    const isSpacePan = this.spaceHeld && e.button === 0;
    if (isMiddle) e.preventDefault();

    if (this.pointers.size === 1 && (isMiddle || isSpacePan)) {
      this.mode = "pan";
      this.beginPan();
      return;
    }

    if (this.pointers.size === 1 && !isMiddle) {
      this.mode = "draw";
      if (this.tool.get().pixelMode) this.beginStrokeAsPixel(e);
      else this.beginStroke(e);
      return;
    }

    if (this.pointers.size === 2) {
      if (this.mode === "draw" && now - this.firstPointerDownAt < SECOND_TOUCH_CANCEL_WINDOW_MS) {
        this.cancelStroke();
      }
      this.mode = "pan-zoom";
      this.beginPinch();
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const tool = this.tool.get();
    const screenDiameter = (SIZES[tool.size] ?? SIZES[0]!) * this.camera.z;
    const cursorVisible = e.pointerType !== "touch" || this.mode === "draw";
    setCursorPosition(e.clientX, e.clientY, screenDiameter, cursorVisible);

    if (this.mode === "draw") {
      if (tool.pixelMode) this.movePixel(e);
      else this.moveStroke(e);
    } else if (this.mode === "pan") {
      this.movePan(e);
    } else if (this.mode === "pan-zoom") {
      this.movePinch();
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);

    if (this.mode === "draw" && this.pointers.size === 0) {
      this.finalizeDraw();
      this.mode = "idle";
    } else if (this.mode === "pan" && this.pointers.size === 0) {
      this.mode = "idle";
      this.startInertia();
    } else if (this.mode === "pan-zoom" && this.pointers.size < 2) {
      this.mode = "idle";
      this.startInertia();
    }
  };

  // -- freehand drawing -----------------------------------------------------

  private beginStroke(e: PointerEvent): void {
    const tool = this.tool.get();
    this.strokeId = crypto.randomUUID();
    const w = this.toWorld(e.clientX, e.clientY);
    this.strokePoints = [{ x: w.x, y: w.y, p: e.pressure || 0.5 }];
    this.store.localPending = { id: this.strokeId, type: "stroke", color: tool.color, size: tool.size, points: this.strokePoints };
    this.lastChunkSentAt = performance.now();
  }

  private moveStroke(e: PointerEvent): void {
    if (!this.strokeId || this.strokePoints.length >= MAX_POINTS_PER_STROKE) return;
    const tool = this.tool.get();
    const w = this.toWorld(e.clientX, e.clientY);
    this.strokePoints.push({ x: w.x, y: w.y, p: e.pressure || 0.5 });
    this.store.localPending = { id: this.strokeId, type: "stroke", color: tool.color, size: tool.size, points: this.strokePoints };

    const now = performance.now();
    if (now - this.lastChunkSentAt > CHUNK_INTERVAL_MS) {
      this.lastChunkSentAt = now;
      this.sendStrokeChunk(tool.color, tool.size);
    }
  }

  private sendStrokeChunk(color: number, size: number): void {
    if (!this.strokeId) return;
    const points = smoothPoints(this.strokePoints, 1).map(quantizePoint);
    const bbox = bboxOfPoints(points, (SIZES[size] ?? SIZES[0]!) / 2);
    const op: StrokeOp = { id: this.strokeId, type: "stroke", session: getSessionId(), color, size, points, bbox };
    this.net.sendChunk(op);
  }

  private cancelStroke(): void {
    this.strokeId = null;
    this.strokePoints = [];
    this.store.localPending = null;
  }

  private finalizeDraw(): void {
    const tool = this.tool.get();
    if (tool.pixelMode) {
      this.finalizePixel();
      return;
    }
    if (!this.strokeId) return;
    const points = smoothPoints(this.strokePoints, 1).map(quantizePoint);
    const bbox = bboxOfPoints(points, (SIZES[tool.size] ?? SIZES[0]!) / 2);
    const op: StrokeOp = {
      id: this.strokeId,
      type: "stroke",
      session: getSessionId(),
      color: tool.color,
      size: tool.size,
      points,
      bbox,
    };
    void this.net.commitOp(op);
    this.strokeId = null;
    this.strokePoints = [];
    // store.localPending keeps showing the finished stroke (zero flicker) until net.ts clears it on ack.
  }

  // -- pixel mode -------------------------------------------------------------

  private cellAt(sx: number, sy: number, cellSize: number): [number, number] {
    const w = this.toWorld(sx, sy);
    return [Math.floor(w.x / cellSize), Math.floor(w.y / cellSize)];
  }

  private beginStrokeAsPixel(e: PointerEvent): void {
    const tool = this.tool.get();
    this.pixelOpId = crypto.randomUUID();
    this.pixelCells = new Map();
    const [cx, cy] = this.cellAt(e.clientX, e.clientY, tool.pixelCell);
    this.pixelCells.set(`${cx},${cy}`, [cx, cy]);
    this.updatePixelPending();
  }

  private movePixel(e: PointerEvent): void {
    if (!this.pixelOpId) {
      this.beginStrokeAsPixel(e);
      return;
    }
    const tool = this.tool.get();
    if (this.pixelCells.size >= MAX_CELLS_PER_PIXELS_OP) return;
    const [cx, cy] = this.cellAt(e.clientX, e.clientY, tool.pixelCell);
    this.pixelCells.set(`${cx},${cy}`, [cx, cy]);
    this.updatePixelPending();
  }

  private updatePixelPending(): void {
    if (!this.pixelOpId) return;
    const tool = this.tool.get();
    this.store.localPending = {
      id: this.pixelOpId,
      type: "pixels",
      color: tool.color,
      cell: tool.pixelCell,
      cells: [...this.pixelCells.values()],
    };
  }

  private finalizePixel(): void {
    if (!this.pixelOpId || this.pixelCells.size === 0) {
      this.pixelOpId = null;
      this.pixelCells = new Map();
      return;
    }
    const tool = this.tool.get();
    const cell = isValidPixelCellSize(tool.pixelCell) ? tool.pixelCell : 2;
    const cells = [...this.pixelCells.values()];
    const worldCells = cells.map(([cx, cy]) => ({ minX: cx * cell, minY: cy * cell, maxX: (cx + 1) * cell, maxY: (cy + 1) * cell }));
    const bbox = {
      minX: Math.min(...worldCells.map((b) => b.minX)),
      minY: Math.min(...worldCells.map((b) => b.minY)),
      maxX: Math.max(...worldCells.map((b) => b.maxX)),
      maxY: Math.max(...worldCells.map((b) => b.maxY)),
    };
    const op: PixelsOp = { id: this.pixelOpId, type: "pixels", session: getSessionId(), color: tool.color, cell, cells, bbox };
    void this.net.commitOp(op);
    this.pixelOpId = null;
    this.pixelCells = new Map();
  }

  // -- pan / pinch-zoom, both anchored to a fixed gesture-start reference so
  //    repeated frame-to-frame updates never accumulate drift -------------------

  private beginPan(): void {
    const only = [...this.pointers.values()][0]!;
    this.gestureStartCam = { ...this.camera };
    this.gestureStartMid = only;
    this.lastMoveScreen = only;
    this.lastMoveTime = performance.now();
    this.panVelocity = { x: 0, y: 0 };
  }

  private movePan(e: PointerEvent): void {
    const vw = this.vw();
    const vh = this.vh();
    const anchor = screenToWorld(this.gestureStartCam, vw, vh, this.gestureStartMid.x, this.gestureStartMid.y);
    const x = anchor.x - (e.clientX - vw / 2) / this.gestureStartCam.z;
    const y = anchor.y - (e.clientY - vh / 2) / this.gestureStartCam.z;
    this.setCamera({ x, y, z: this.gestureStartCam.z });
    this.trackVelocity(e.clientX, e.clientY);
  }

  private beginPinch(): void {
    const pts = [...this.pointers.values()];
    const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
    this.gestureStartCam = { ...this.camera };
    this.gestureStartDist = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1);
    this.gestureStartMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.lastMoveScreen = this.gestureStartMid;
    this.lastMoveTime = performance.now();
    this.panVelocity = { x: 0, y: 0 };
  }

  private movePinch(): void {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
    const dist = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const vw = this.vw();
    const vh = this.vh();
    const newZ = clampZoom(this.gestureStartCam.z * (dist / this.gestureStartDist));
    const anchor = screenToWorld(this.gestureStartCam, vw, vh, this.gestureStartMid.x, this.gestureStartMid.y);
    const x = anchor.x - (mid.x - vw / 2) / newZ;
    const y = anchor.y - (mid.y - vh / 2) / newZ;
    this.setCamera({ x, y, z: newZ });
    this.trackVelocity(mid.x, mid.y);
  }

  private trackVelocity(sx: number, sy: number): void {
    const now = performance.now();
    const dt = Math.max(1, now - this.lastMoveTime);
    this.panVelocity = { x: (sx - this.lastMoveScreen.x) / dt, y: (sy - this.lastMoveScreen.y) / dt };
    this.lastMoveScreen = { x: sx, y: sy };
    this.lastMoveTime = now;
  }

  private startInertia(): void {
    if (Math.hypot(this.panVelocity.x, this.panVelocity.y) < INERTIA_MIN_SPEED) return;
    const step = () => {
      const speed = Math.hypot(this.panVelocity.x, this.panVelocity.y);
      if (speed < INERTIA_MIN_SPEED) {
        this.inertiaRAF = null;
        return;
      }
      const cam = this.camera;
      this.setCamera({
        x: cam.x - (this.panVelocity.x * 16) / cam.z,
        y: cam.y - (this.panVelocity.y * 16) / cam.z,
        z: cam.z,
      });
      this.panVelocity = { x: this.panVelocity.x * INERTIA_FRICTION, y: this.panVelocity.y * INERTIA_FRICTION };
      this.inertiaRAF = requestAnimationFrame(step);
    };
    this.inertiaRAF = requestAnimationFrame(step);
  }

  private stopInertia(): void {
    if (this.inertiaRAF != null) {
      cancelAnimationFrame(this.inertiaRAF);
      this.inertiaRAF = null;
    }
    this.panVelocity = { x: 0, y: 0 };
  }

  // -- wheel / trackpad ---------------------------------------------------------

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.stopInertia();
    const vw = this.vw();
    const vh = this.vh();

    if (e.ctrlKey) {
      // Browsers report a trackpad pinch as a wheel event with ctrlKey set.
      const factor = Math.exp(-e.deltaY * 0.01);
      this.setCamera(zoomAroundScreenPoint(this.camera, vw, vh, e.clientX, e.clientY, clampZoom(this.camera.z * factor)));
      return;
    }

    const looksLikeTrackpadScroll = e.deltaMode === 0 && (e.deltaX !== 0 || Math.abs(e.deltaY) < 50);
    if (looksLikeTrackpadScroll) {
      const cam = this.camera;
      this.setCamera({ x: cam.x + e.deltaX / cam.z, y: cam.y + e.deltaY / cam.z, z: cam.z });
      return;
    }

    const factor = Math.exp(-e.deltaY * 0.002);
    this.setCamera(zoomAroundScreenPoint(this.camera, vw, vh, e.clientX, e.clientY, clampZoom(this.camera.z * factor)));
  };
}
