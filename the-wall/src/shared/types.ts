/**
 * The wall's whole data model. Every change is one of three operation
 * types; committed operations are never mutated, only appended.
 */

export type OpId = string; // client-generated UUID v4, makes writes idempotent

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** World-space point. x/y are quantised to 1/16 world unit; p is pressure 0..1. */
export interface PointSample {
  x: number;
  y: number;
  p: number;
}

interface OpBase {
  id: OpId;
  /** Server-assigned monotonic order. Absent until committed. */
  seq?: number;
  /** Server wall-clock ms at commit. Absent until committed. */
  ts?: number;
  /** Anonymous per-browser session id (never displayed). */
  session: string;
  color: number; // index into PALETTE
  bbox: BBox;
}

export interface StrokeOp extends OpBase {
  type: "stroke";
  size: number; // index into SIZES
  points: PointSample[];
}

export interface PixelsOp extends OpBase {
  type: "pixels";
  cell: number; // one of PIXEL_CELL_SIZES, world units per cell
  cells: [number, number][]; // integer grid coordinates, cx = floor(x/cell)
}

export interface HideOp extends OpBase {
  type: "hide";
  /** Earlier operation ids this hide excludes from public rendering. */
  targetIds: OpId[];
}

export type Operation = StrokeOp | PixelsOp | HideOp;

export type OpType = Operation["type"];

// ---------------------------------------------------------------------------
// Realtime protocol (JSON over WebSocket)
// ---------------------------------------------------------------------------

export interface HelloMsg {
  type: "hello";
  sessionId: string;
  lastSeq: number;
  viewport?: BBox;
}

export interface ViewportMsg {
  type: "viewport";
  bbox: BBox;
}

/**
 * Carries a stroke/pixels/hide operation. `final: false` is an in-progress
 * chunk (rebroadcast live, never persisted); `final: true` is the commit
 * the server assigns a seq to and stores.
 */
export interface OpMsg {
  type: "op";
  op: Operation;
  final: boolean;
}

export type ClientMsg = HelloMsg | ViewportMsg | OpMsg;

export interface WelcomeMsg {
  type: "welcome";
  headSeq: number;
}

export interface OpsMsg {
  type: "ops";
  ops: Operation[];
}

export interface AckMsg {
  type: "ack";
  id: OpId;
  seq: number;
}

export interface LiveMsg {
  type: "live";
  id: OpId;
  session: string;
  color: number;
  size: number;
  points: PointSample[];
  done: boolean;
}

export interface ErrorMsg {
  /** Never shown as text - the client reacts to it silently (drop/retry). */
  type: "error";
  code: string;
}

export type ServerMsg = WelcomeMsg | OpsMsg | AckMsg | LiveMsg | ErrorMsg;

// ---------------------------------------------------------------------------
// Limits (validated on the server; the client should never exceed these
// during normal use, so hitting them means either a bug or a hostile client)
// ---------------------------------------------------------------------------

export const MAX_POINTS_PER_STROKE = 2000;
export const MAX_CELLS_PER_PIXELS_OP = 4000;
export const MAX_HIDE_TARGETS = 500;
export const MAX_MESSAGE_BYTES = 256 * 1024;
export const MAX_COORD = 5_000_000; // world units from origin, either axis
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
