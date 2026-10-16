// The high-score boards: one board per mode key, the same rules on the
// server (the Durable Object) and in the local dev server. Pure functions,
// no I/O, tested in Node.
//
// A key is the game's own mode key, e.g. "classic:seven:standard:10:classic",
// "jackpot:10:classic", "endurance:balls25:seven:classic" or
// "daily:2026-10-16" - so a board only ever compares like with like.

export const MAX_ENTRIES = 25;
export const NAME_MAX = 14;

const KEY_RE = /^(classic|jackpot|endurance|daily):[A-Za-z0-9:_.-]{1,60}$/;

// "Reach 10,000" counts balls used: fewer is better. Everything else is points.
export const lowerIsBetter = (key) => key.startsWith('endurance:target');

export function cleanKey(k) {
  return typeof k === 'string' && KEY_RE.test(k) ? k : null;
}

export function cleanName(n) {
  let s = String(n ?? '').replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, NAME_MAX);
  return s || 'ANON';
}

export function cleanScore(key, s) {
  const n = Number(s);
  if (!Number.isInteger(n)) return null;
  if (lowerIsBetter(key)) return n >= 1 && n <= 9999 ? n : null;
  return n >= 0 && n <= 1e9 ? n : null;
}

export const better = (key, a, b) => (lowerIsBetter(key) ? a < b : a > b);

// Would this score make the board at all?
export function qualifies(entries, key, score) {
  if (entries.length < MAX_ENTRIES) return true;
  return better(key, score, entries[entries.length - 1].score);
}

// Insert, keep the board sorted and capped, and say where it landed.
// Ties go below the earlier entry (first to set it keeps the place).
export function insert(entries, key, entry) {
  if (!qualifies(entries, key, entry.score)) return { entries, rank: 0 };
  let i = 0;
  while (i < entries.length && !better(key, entry.score, entries[i].score)) i++;
  const out = entries.slice();
  out.splice(i, 0, entry);
  if (out.length > MAX_ENTRIES) out.length = MAX_ENTRIES;
  return { entries: out, rank: i + 1 };
}
