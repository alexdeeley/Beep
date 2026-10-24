// Stable gesture event schema (API 1.x). Every 'gesture:*' event on the bus has ALL of
// these fields; type-specific fields are listed in GESTURE_TYPES.
//
// Field            Type      Always  Notes
// type             string    yes     e.g. 'tap', 'drag', 'hold:charge'
// pointerId        number    yes     -1 for multi-pointer / synthetic aggregate events
// x, y             number    yes     normalized 0..1 (centroid for multi events)
// gridX, gridY     int       yes     cell under x,y at the current grid resolution
// fx, fy           number    yes     fractional cell coordinates
// cellIndex        int       yes     gridY * cols + gridX
// velocityX/Y      number    yes     units/s (1 unit = short side of canvas); 0 if unknown
// speed            number    yes     |velocity| in units/s
// direction        number    yes     radians, atan2(vy, vx) (0 = right, PI/2 = down)
// dirName          string    yes     'right' | 'down' | 'left' | 'up'
// pressure         number    yes     0..1; 0.5 when the hardware does not report pressure
// pressureSupported bool     yes     false when pressure is synthesized
// pointerType      string    yes     'mouse' | 'touch' | 'pen' | 'synthetic'
// timestamp        number    yes     performance.now() ms
// time             number    yes     visual clock seconds (shared with effects)
// duration         number    yes     seconds since this pointer went down (0 for down)
// activePointerCount int     yes     pointers currently down
// gestureId        number    yes     id shared by all events of one pointer's gesture
// groupId          number    yes     id shared by all pointers down at overlapping times
// modifiers        object    yes     { shift, alt, ctrl, meta } (false on touch)
// synthetic        bool      yes     true when produced by looper/autoplay/tests

export const GESTURE_TYPES = {
  press: 'pointer went down (fires immediately, before tap/drag is known)',
  release: 'pointer went up',
  tap: 'short, still press-release',
  doubletap: 'second tap near the first within 320ms',
  rhythm: '3+ evenly spaced taps. extra: interval (s), bpm, count',
  'drag:start': 'pointer moved past the drag threshold',
  drag: 'pointer moved. extra: cells [{i,gx,gy}] crossed since last event (gap-free), distance',
  'drag:reverse': 'drag direction flipped by > ~120°. extra: previousDirection',
  'drag:end': 'drag finished. extra: distance (units), swipe (bool: fast release)',
  swipe: 'drag released faster than 1.1 units/s',
  circle: 'one full loop drawn. extra: clockwise (bool), angularVelocity (rad/s), radius (units)',
  'hold:start': 'pointer held still for 350ms',
  'hold:charge': 'every frame while holding. extra: level 0..1 (2.5s to full)',
  'hold:release': 'held pointer lifted. extra: level',
  'hold:cancel': 'held pointer moved away',
  'multi:start': 'second pointer joined. extra: count',
  pinch: 'two-pointer distance changed. extra: scale (vs start), deltaScale',
  rotate: 'two-pointer angle changed. extra: rotation (rad vs start), deltaRotation',
  spread: 'two pointers moved apart past 1.35x (once per multi gesture)',
  squeeze: 'two pointers moved together below 0.7x (once per multi gesture)',
  'multi:count': 'number of active pointers changed while >= 2. extra: count',
  'multi:end': 'fewer than two pointers remain',
};

const DIRS = ['right', 'down', 'left', 'up'];

let _ids = 0;
export const nextGestureId = () => ++_ids;

// Build a complete event. `p` is a pointer-state record (or a partial object for aggregates).
export function makeGestureEvent(type, p, ctx, extra = {}) {
  const x = p.x ?? 0.5, y = p.y ?? 0.5;
  const g = ctx.mapper.toGrid(x, y);
  const vx = p.vx || 0, vy = p.vy || 0;
  const dir = Math.atan2(vy, vx);
  const di = Math.round(((dir + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 2)) % 4;
  const now = ctx.now();
  return {
    type,
    pointerId: p.id ?? -1,
    x, y,
    gridX: g.gridX, gridY: g.gridY, fx: g.fx, fy: g.fy,
    cellIndex: g.gridY * ctx.grid.cols + g.gridX,
    velocityX: vx, velocityY: vy,
    speed: Math.hypot(vx, vy),
    direction: dir, dirName: DIRS[di],
    pressure: p.pressureSupported ? p.pressure : 0.5,
    pressureSupported: !!p.pressureSupported,
    pointerType: p.pointerType || 'synthetic',
    timestamp: now,
    time: ctx.clock.time,
    duration: p.downAt != null ? Math.max(0, (now - p.downAt) / 1000) : 0,
    activePointerCount: ctx.activeCount(),
    gestureId: p.gestureId ?? 0,
    groupId: ctx.groupId(),
    modifiers: p.modifiers || { shift: false, alt: false, ctrl: false, meta: false },
    synthetic: !!p.synthetic,
    ...extra,
  };
}
