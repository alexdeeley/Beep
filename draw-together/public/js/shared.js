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
  // Pixel: the size is the grid cell, in board units - points snap to that grid.
  pixel:   { label: 'Pixel',   sizes: [16, 28, 48] },
  // Fill: a one-point "stroke" (the tap) that the board resolves against a
  // fixed-size raster of the drawing underneath it - see board.js. It has no
  // brush size; its "size" picks a pattern (see FILL_PATTERNS) and goes
  // through the same tool/size validation every other stroke does.
  fill:    { label: 'Fill',    sizes: [1, 2, 3, 4, 5, 6] },
  eraser:  { label: 'Eraser',  sizes: [30, 80] },
  // The tools below are extras for the free-draw studio (`studio: true`):
  // the guessing game's tray leaves them out, but the server accepts them
  // anywhere, and a finished studio drawing can be remixed with all of them.
  neon:    { label: 'Neon',    sizes: [10, 18, 30], studio: true },
  spray:   { label: 'Spray',   sizes: [24, 40, 64], studio: true },
  stars:   { label: 'Stars',   sizes: [16, 26, 40], studio: true },
  hearts:  { label: 'Hearts',  sizes: [16, 26, 40], studio: true },
};

// A fill's "size" is its pattern (index + 1). 1 = solid, which is all the
// guessing game ever uses - and what every fill drawn before patterns existed
// already says. The patterns are painted by board.js.
export const FILL_PATTERNS = ['Solid', 'Stripes', 'Dots', 'Checks', 'Waves', 'Stars'];

export const SIZE_NAMES = {
  pen: ['Thin', 'Medium', 'Thick'],
  marker: ['Small', 'Medium', 'Large'],
  crayon: ['Small', 'Medium', 'Large'],
  dots: ['Small', 'Medium', 'Large'],
  rainbow: ['Small', 'Medium', 'Large'],
  pixel: ['Fine', 'Medium', 'Chunky'],
  fill: ['Solid', 'Stripes', 'Dots', 'Checks', 'Waves', 'Stars'],
  neon: ['Thin', 'Medium', 'Thick'],
  spray: ['Small', 'Medium', 'Large'],
  stars: ['Small', 'Medium', 'Large'],
  hearts: ['Small', 'Medium', 'Large'],
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

// Free-draw studio: the canvas shape the host picks in the lobby (width / height).
export const STUDIO_SHAPES = { square: 1, wide: 1.4, tall: 0.72 };

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

// Quick reactions anyone can fire off during drawing - a fixed list (not
// free text) so there's nothing to moderate. Each shows briefly as a
// bubble, same spot as the guess feed, then vanishes fast (see app.js).
export const REACTIONS = [
  { emoji: '😂', text: 'Ha ha!' },
  { emoji: '👏', text: 'Nice drawing!' },
  { emoji: '😍', text: 'Love it!' },
  { emoji: '😮', text: 'Whoa!' },
  { emoji: '🤔', text: 'Hmm…' },
  { emoji: '👀', text: 'Look!' },
];
export const WORD_CHOICES = 5;         // word options the drawer can cycle through per round
export const ASPECT_MIN = 0.55;
export const ASPECT_MAX = 1.8;
