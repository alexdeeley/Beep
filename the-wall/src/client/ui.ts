import { PALETTE, SIZES, WHITE_INDEX, PIXEL_CELL_SIZES } from "../shared/palette.js";

export interface Tool {
  color: number;
  size: number;
  pixelMode: boolean;
  pixelCell: (typeof PIXEL_CELL_SIZES)[number];
}

const STORAGE_KEY = "wall.tool";

function loadTool(): Tool {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const t = JSON.parse(raw);
      if (
        Number.isInteger(t.color) &&
        Number.isInteger(t.size) &&
        typeof t.pixelMode === "boolean" &&
        PIXEL_CELL_SIZES.includes(t.pixelCell)
      ) {
        return t;
      }
    }
  } catch {
    /* fall through to default */
  }
  return { color: 0, size: 1, pixelMode: false, pixelCell: 2 };
}

export class ToolState {
  private tool: Tool = loadTool();
  private listeners = new Set<(t: Tool) => void>();

  get(): Tool {
    return this.tool;
  }

  set(patch: Partial<Tool>): void {
    this.tool = { ...this.tool, ...patch };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.tool));
    for (const l of this.listeners) l(this.tool);
  }

  onChange(fn: (t: Tool) => void): void {
    this.listeners.add(fn);
  }
}

/** Builds the (initially invisible) palette DOM and wires its interactions. Returns the shared ToolState. */
export function setupPalette(): ToolState {
  const tool = new ToolState();
  const palette = document.getElementById("palette")!;
  const swatchesEl = document.getElementById("swatches")!;
  const sizesEl = document.getElementById("sizes")!;
  const pixelToggle = document.getElementById("pixelToggle") as HTMLButtonElement;

  PALETTE.forEach((hex, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "swatch" + (i === WHITE_INDEX ? " eraser" : "");
    btn.style.background = hex;
    btn.setAttribute("aria-label", i === WHITE_INDEX ? "Eraser" : `Colour ${i + 1} of ${PALETTE.length}`);
    btn.setAttribute("aria-pressed", String(i === tool.get().color));
    btn.addEventListener("click", () => tool.set({ color: i }));
    swatchesEl.appendChild(btn);
  });

  SIZES.forEach((_, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "size-dot";
    const px = 6 + i * 5;
    btn.style.width = `${px}px`;
    btn.style.height = `${px}px`;
    btn.setAttribute("aria-label", `Brush size ${i + 1} of ${SIZES.length}`);
    btn.setAttribute("aria-pressed", String(i === tool.get().size));
    btn.addEventListener("click", () => tool.set({ size: i }));
    sizesEl.appendChild(btn);
  });

  pixelToggle.setAttribute("aria-pressed", String(tool.get().pixelMode));
  pixelToggle.addEventListener("click", () => tool.set({ pixelMode: !tool.get().pixelMode }));

  tool.onChange((t) => {
    swatchesEl.querySelectorAll<HTMLButtonElement>(".swatch").forEach((el, i) => {
      el.setAttribute("aria-pressed", String(i === t.color));
    });
    sizesEl.querySelectorAll<HTMLButtonElement>(".size-dot").forEach((el, i) => {
      el.setAttribute("aria-pressed", String(i === t.size));
    });
    pixelToggle.setAttribute("aria-pressed", String(t.pixelMode));
    updateCursor(t);
  });

  // Desktop: fade the swatch row in near the bottom edge, out once the pointer leaves.
  const PROXIMITY_PX = 130;
  let hideTimer: number | null = null;
  window.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    if (palette.classList.contains("radial")) return;
    const nearBottom = window.innerHeight - e.clientY < PROXIMITY_PX;
    if (nearBottom) {
      if (hideTimer != null) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      palette.classList.add("visible");
    } else if (palette.classList.contains("visible") && hideTimer == null) {
      hideTimer = window.setTimeout(() => palette.classList.remove("visible"), 220);
    }
  });

  layoutRadialButtons(palette);

  // Touch: long-press or the corner dot opens a compact radial palette at that point.
  const cornerDot = document.getElementById("cornerDot") as HTMLButtonElement;
  const RADIAL_DIAMETER = 200;
  palette.style.setProperty("--radial-diameter", `${RADIAL_DIAMETER}px`);
  function openRadialAt(x: number, y: number): void {
    // Clamp so the whole circle stays on-screen - opening near a corner (the
    // common case, since the corner dot itself lives in one) must not push
    // half the menu off the edge of the viewport.
    const r = RADIAL_DIAMETER / 2 + 12;
    const cx = Math.min(Math.max(x, r), window.innerWidth - r);
    const cy = Math.min(Math.max(y, r), window.innerHeight - r);
    palette.style.setProperty("--radial-x", `${cx}px`);
    palette.style.setProperty("--radial-y", `${cy}px`);
    palette.classList.add("radial", "visible");
  }
  function closeRadial(): void {
    palette.classList.remove("radial", "visible");
  }
  cornerDot.addEventListener("click", () => {
    if (palette.classList.contains("radial") && palette.classList.contains("visible")) {
      closeRadial();
    } else {
      openRadialAt(window.innerWidth - 60, window.innerHeight - 90);
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (palette.classList.contains("visible") && !palette.contains(e.target as Node) && e.target !== cornerDot) {
      closeRadial();
    }
  });

  let longPressTimer: number | null = null;
  const wall = document.getElementById("wall")!;
  wall.addEventListener("pointerdown", (e: PointerEvent) => {
    if (e.pointerType === "mouse") return;
    longPressTimer = window.setTimeout(() => openRadialAt(e.clientX, e.clientY), 480);
  });
  wall.addEventListener("pointerup", () => {
    if (longPressTimer != null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  });
  wall.addEventListener("pointermove", () => {
    if (longPressTimer != null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  });

  updateCursor(tool.get());
  return tool;
}

/**
 * Positions every swatch/size/toggle button evenly around a circle instead of
 * the default flex row - only takes effect once `#palette.radial` is active
 * (see style.css). Static layout (button order never changes), so this runs
 * once at setup rather than on every open.
 */
function layoutRadialButtons(palette: HTMLElement): void {
  const buttons = Array.from(palette.querySelectorAll<HTMLElement>(".swatch, .size-dot, #pixelToggle"));
  const radius = 78;
  const n = buttons.length;
  buttons.forEach((btn, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2; // start at the top, go clockwise
    const w = btn.offsetWidth || 26;
    const h = btn.offsetHeight || 26;
    const rx = Math.cos(angle) * radius - w / 2;
    const ry = Math.sin(angle) * radius - h / 2;
    btn.style.setProperty("--rx", `${rx}px`);
    btn.style.setProperty("--ry", `${ry}px`);
  });
}

const cursorEl = () => document.getElementById("cursor")!;

function updateCursor(t: Tool): void {
  // Size is kept in sync continuously by setCursorPosition() (it needs the
  // current zoom, which this function doesn't have); this just updates colour.
  cursorEl().style.background = t.color === WHITE_INDEX ? "transparent" : PALETTE[t.color] ?? "#000";
}

/** Called continuously by input.ts with the current on-screen brush diameter (world size * zoom). */
export function setCursorPosition(x: number, y: number, screenDiameter: number, visible: boolean): void {
  const el = cursorEl();
  el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  el.style.width = `${screenDiameter}px`;
  el.style.height = `${screenDiameter}px`;
  el.classList.toggle("visible", visible);
}
