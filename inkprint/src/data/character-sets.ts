/**
 * The character inventory. Groups are drawn in this order; a project picks the
 * groups it wants and may add its own characters. The space is never drawn:
 * it is a spacing setting (FontLayout.spaceWidth).
 */
export interface CharGroup {
  id: string;
  label: string;
  /** Short label for tabs. */
  short: string;
  chars: string[];
}

const range = (from: string, to: string) =>
  Array.from({ length: to.charCodeAt(0) - from.charCodeAt(0) + 1 }, (_, i) => String.fromCharCode(from.charCodeAt(0) + i));

export const CHAR_GROUPS: CharGroup[] = [
  { id: 'upper', label: 'Uppercase', short: 'ABC', chars: range('A', 'Z') },
  { id: 'lower', label: 'Lowercase', short: 'abc', chars: range('a', 'z') },
  { id: 'numbers', label: 'Numbers', short: '123', chars: range('0', '9') },
  {
    id: 'punctuation',
    label: 'Punctuation',
    short: '.,?',
    chars: ['.', ',', ':', ';', '!', '?', "'", '"', '‘', '’', '“', '”', '-', '–', '—', '_', '(', ')', '[', ']', '{', '}', '…'],
  },
  {
    id: 'symbols',
    label: 'Symbols',
    short: '@&#',
    chars: ['@', '&', '#', '$', '%', '+', '=', '*', '/', '\\', '|', '^', '~', '<', '>', '`', '©', '®', '°', '€', '£'],
  },
  {
    id: 'extended',
    label: 'Accented Latin',
    short: 'éñü',
    chars: [...'ÀÁÂÄÃÅÆÇÈÉÊËÌÍÎÏÑÒÓÔÖÕØŒÙÚÛÜÝàáâäãåæçèéêëìíîïñòóôöõøœùúûüýÿß¡¿'],
  },
];

export const GROUP_BY_ID = new Map(CHAR_GROUPS.map((g) => [g.id, g]));

export interface CharsetPreset {
  id: string;
  label: string;
  description: string;
  groups: string[];
}

export const CHARSET_PRESETS: CharsetPreset[] = [
  { id: 'basic', label: 'Basic English', description: 'A–Z, a–z, 0–9 and punctuation', groups: ['upper', 'lower', 'numbers', 'punctuation'] },
  { id: 'full', label: 'Basic English + symbols', description: 'Everything on a keyboard', groups: ['upper', 'lower', 'numbers', 'punctuation', 'symbols'] },
  { id: 'extended', label: 'Extended Latin', description: 'Adds é, ñ, ü, å, ç and friends', groups: ['upper', 'lower', 'numbers', 'punctuation', 'symbols', 'extended'] },
  { id: 'numsym', label: 'Numbers & symbols', description: 'Digits, punctuation and symbols only', groups: ['numbers', 'punctuation', 'symbols'] },
];

/** Splits a string into characters by code point (so emoji and astral characters stay whole). */
export function splitChars(text: string): string[] {
  return Array.from(text);
}

/** Characters the user may not draw: whitespace and controls. */
export function isDrawable(ch: string): boolean {
  return !/^[\s\p{Cc}\p{Cf}]$/u.test(ch);
}

export interface InventoryEntry {
  char: string;
  groupId: string;
}

/** The ordered, de-duplicated list of characters a project asks for. */
export function buildInventory(groups: string[], customChars: string): InventoryEntry[] {
  const seen = new Set<string>();
  const out: InventoryEntry[] = [];
  for (const g of CHAR_GROUPS) {
    if (!groups.includes(g.id)) continue;
    for (const ch of g.chars) {
      if (seen.has(ch)) continue;
      seen.add(ch);
      out.push({ char: ch, groupId: g.id });
    }
  }
  for (const ch of splitChars(customChars)) {
    if (!isDrawable(ch) || seen.has(ch)) continue;
    seen.add(ch);
    out.push({ char: ch, groupId: 'custom' });
  }
  return out;
}

export function groupLabel(id: string): string {
  return id === 'custom' ? 'Custom' : (GROUP_BY_ID.get(id)?.label ?? id);
}

/** Readable name for a character, for screen readers and small labels. */
const NAMES: Record<string, string> = {
  '.': 'period', ',': 'comma', ':': 'colon', ';': 'semicolon', '!': 'exclamation mark', '?': 'question mark',
  "'": 'apostrophe', '"': 'quotation mark', '‘': 'left single quote', '’': 'right single quote', '“': 'left double quote',
  '”': 'right double quote', '-': 'hyphen', '–': 'en dash', '—': 'em dash', '_': 'underscore', '(': 'left parenthesis',
  ')': 'right parenthesis', '[': 'left square bracket', ']': 'right square bracket', '{': 'left brace', '}': 'right brace',
  '…': 'ellipsis', '@': 'at sign', '&': 'ampersand', '#': 'number sign', '$': 'dollar sign', '%': 'percent sign',
  '+': 'plus', '=': 'equals', '*': 'asterisk', '/': 'slash', '\\': 'backslash', '|': 'vertical bar', '^': 'caret',
  '~': 'tilde', '<': 'less-than', '>': 'greater-than', '`': 'grave accent', '©': 'copyright', '®': 'registered',
  '°': 'degree', '€': 'euro', '£': 'pound', '¡': 'inverted exclamation mark', '¿': 'inverted question mark',
};

export function charName(ch: string): string {
  if (NAMES[ch]) return NAMES[ch];
  if (/^[A-Z]$/.test(ch)) return `capital ${ch}`;
  if (/^[a-z]$/.test(ch)) return `lowercase ${ch}`;
  if (/^[0-9]$/.test(ch)) return `number ${ch}`;
  if (ch.toLowerCase() !== ch) return `capital ${ch}`;
  if (ch.toUpperCase() !== ch) return `lowercase ${ch}`;
  return ch;
}

export function codePointLabel(ch: string): string {
  return 'U+' + (ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');
}

/** For an accented letter, the plain letter it is built on (é → e), if any. */
export function baseLetter(ch: string): string | null {
  const special: Record<string, string> = { 'Ø': 'O', 'ø': 'o', 'Æ': 'A', 'æ': 'a', 'Œ': 'O', 'œ': 'o' };
  if (special[ch]) return special[ch];
  const decomposed = ch.normalize('NFD');
  if (decomposed.length > 1 && decomposed !== ch) {
    const base = Array.from(decomposed)[0];
    if (/\p{L}/u.test(base)) return base;
  }
  return null;
}
