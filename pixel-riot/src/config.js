// PIXEL RIOT — global configuration constants.
// Change APP_NAME to rename the instrument everywhere (title, UI label, storage keys).

export const APP_NAME = 'PIXEL RIOT';
export const APP_VERSION = '0.1.0';

// Public extension API version. Plugins declare `apiVersion` in their manifest;
// the major number must match API_VERSION's major number to load.
export const API_VERSION = '1.0.0';

// Storage namespace (derived from the app name so a rename does not collide).
export const STORAGE_PREFIX = APP_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-') + ':';

// Logical grid resolutions. The number is the cell count along the SHORT screen
// axis; the long axis is extended so cells stay square (unless cellAspect = 'stretch',
// in which case the grid is exactly N x N).
export const RESOLUTIONS = {
  coarse: 16,
  standard: 32,
  detailed: 64,
  dense: 128,
};
export const ADAPTIVE_STEPS = [16, 24, 32, 48, 64, 96, 128];

// Hard safety limits. Quality levels scale some of these down (see performance-monitor.js).
export const LIMITS = {
  maxEffectInstances: 160,     // all active effect instances
  maxGlobalEffects: 6,         // persistent/ambient effects
  maxEffectLifetime: 30,       // seconds, for non-persistent effects
  maxParticles: 2400,
  maxVoices: 24,               // simultaneous audio voices
  maxChainStages: 24,
  maxChainEvents: 4000,        // scheduled chain-reaction events in flight
  maxPointers: 10,
  undoDepth: 24,
  maxFrameDt: 1 / 20,          // clamp frame delta so a background tab never builds a backlog
  masterVolumeCeiling: 0.9,
};

export const QUALITY_LEVELS = {
  high:   { particleScale: 1.0,  effectScale: 1.0,  patternEvery: 1, overlayDetail: 1.0 },
  medium: { particleScale: 0.6,  effectScale: 0.75, patternEvery: 1, overlayDetail: 0.7 },
  low:    { particleScale: 0.3,  effectScale: 0.5,  patternEvery: 2, overlayDetail: 0.4 },
};
