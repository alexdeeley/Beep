// Shared by the browser AND the Cloudflare Worker / Durable Object.
// Keep this file dependency-free.

// Stroke coordinates are integers 0..COORD_MAX across the board,
// i.e. normalized 0..1 with 4 decimal places of precision.
export const COORD_MAX = 10000;

// Brush sizes are in "board units": 1000 units = sqrt(boardWidth * boardHeight).
// This keeps a line the same relative thickness on every screen.
export const TOOLS = {
  pen:     { label: 'Pen',     sizes: [6, 12, 22] },
  marker:  { label: 'Marker',  sizes: [18, 30, 46] },
  crayon:  { label: 'Crayon',  sizes: [12, 20, 32] },
  dots:    { label: 'Dots',    sizes: [7, 12, 19] },
  rainbow: { label: 'Rainbow', sizes: [8, 14, 24] },
  eraser:  { label: 'Eraser',  sizes: [30, 80] },
};

export const SIZE_NAMES = {
  pen: ['Thin', 'Medium', 'Thick'],
  marker: ['Small', 'Medium', 'Large'],
  crayon: ['Small', 'Medium', 'Large'],
  dots: ['Small', 'Medium', 'Large'],
  rainbow: ['Small', 'Medium', 'Large'],
  eraser: ['Small eraser', 'Large eraser'],
};

export const PALETTE = [
  { name: 'Black',  hex: '#000000' },
  { name: 'White',  hex: '#ffffff' },
  { name: 'Red',    hex: '#e8202a' },
  { name: 'Pink',   hex: '#ff5fb0' },
  { name: 'Orange', hex: '#ff8a00' },
  { name: 'Yellow', hex: '#ffd400' },
  { name: 'Green',  hex: '#1fb84a' },
  { name: 'Cyan',   hex: '#16c6e8' },
  { name: 'Blue',   hex: '#1f5bff' },
  { name: 'Purple', hex: '#8a3ffc' },
  { name: 'Brown',  hex: '#8b5a2b' },
  { name: 'Gray',   hex: '#8c8c8c' },
];

export const TIMER_OPTIONS = [30, 60, 90, 0];      // 0 = no timer
export const ROUND_OPTIONS = [6, 10, 16];
export const DIFFICULTIES = ['easy', 'mixed', 'silly', 'hard', 'chaos'];

export const CATEGORIES = [
  { id: 'everything', label: 'Everything', emoji: '✨' },
  { id: 'animals',    label: 'Animals',    emoji: '🐶' },
  { id: 'dinosaurs',  label: 'Dinosaurs',  emoji: '🦖' },
  { id: 'fantasy',    label: 'Fantasy',    emoji: '🦄' },
  { id: 'space',      label: 'Space',      emoji: '🚀' },
  { id: 'food',       label: 'Food',       emoji: '🍕' },
  { id: 'nature',     label: 'Nature',     emoji: '🌻' },
  { id: 'toys',       label: 'Toys',       emoji: '🧸' },
  { id: 'vehicles',   label: 'Vehicles',   emoji: '🚗' },
  { id: 'places',     label: 'Places',     emoji: '🏰' },
  { id: 'things',     label: 'Things',     emoji: '🎒' },
  { id: 'silly',      label: 'Silly',      emoji: '🤪' },
  // Hard-mode only: these categories' words are all tagged difficulty
  // 'hard', so they never show up under Easy/Mixed/Silly by accident.
  { id: 'symbols',      label: 'Symbols',      emoji: '🔣' },
  { id: 'music',        label: 'Music',        emoji: '🎵' },
  { id: 'architecture', label: 'Architecture', emoji: '🏛️' },
];

export const MAX_PLAYERS = 16;

// One distinct color per seat, in join order. Bright and high-saturation to
// match the sticker-book palette; the first two match --p1/--p2 in
// styles.css exactly, since those are also used for the lobby/host buttons.
export const PLAYER_COLORS = [
  '#3d7bff', // blue
  '#ff5fb0', // pink
  '#ff8a00', // orange
  '#1fb84a', // green
  '#8a3ffc', // purple
  '#ffd400', // yellow
  '#16c6e8', // cyan
  '#e8202a', // red
  '#8b5a2b', // brown
  '#ff3d7f', // rose
  '#2bd9a3', // teal
  '#ff9ed8', // light pink
  '#6b8cff', // periwinkle
  '#c4e000', // lime
  '#ff6b6b', // coral
  '#9b59ff', // violet
];
export const MAX_POINTS_PER_MSG = 400; // x,y pairs → 800 ints
export const MAX_NAME = 14;
export const WORD_SWAPS = 2;           // "another word" presses per round
export const ASPECT_MIN = 0.55;
export const ASPECT_MAX = 1.8;
