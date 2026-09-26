/**
 * The wall's entire colour and size vocabulary. Operations store indexes
 * into these arrays, never raw colour/size values, so the palette can be
 * re-themed later without touching stored history, and so the server can
 * reject any index that isn't one of these exact choices.
 *
 * Index 8 (white) is the only eraser: painting white over ink is how you
 * remove a mark. There is no separate eraser tool.
 */
export const PALETTE = [
  "#111111", // black
  "#555555", // dark grey
  "#e11d2e", // red
  "#f2792a", // orange
  "#f5c518", // yellow
  "#2f9e44", // green
  "#2563eb", // blue
  "#7c3aed", // purple
  "#ffffff", // white == eraser
] as const;

export const WHITE_INDEX = 8;

export type ColorIndex = number;

/** Brush diameters in world units at zoom 1. */
export const SIZES = [4, 10, 22, 44] as const;

export type SizeIndex = number;

export function isValidColorIndex(i: unknown): i is ColorIndex {
  return typeof i === "number" && Number.isInteger(i) && i >= 0 && i < PALETTE.length;
}

export function isValidSizeIndex(i: unknown): i is SizeIndex {
  return typeof i === "number" && Number.isInteger(i) && i >= 0 && i < SIZES.length;
}

/** Fixed pixel-mode cell sizes, in world units. Part of the world, not the zoom level. */
export const PIXEL_CELL_SIZES = [1, 2, 4, 8] as const;

export function isValidPixelCellSize(n: unknown): n is (typeof PIXEL_CELL_SIZES)[number] {
  return typeof n === "number" && (PIXEL_CELL_SIZES as readonly number[]).includes(n);
}
