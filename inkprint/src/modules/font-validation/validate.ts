/**
 * Checks a generated font before it is offered for download. Two layers:
 *  1. A structural check of the sfnt container we can do byte by byte
 *     (table directory, bounds, checksums, loca order).
 *  2. A full parse with opentype.js, then checks that every character we
 *     meant to include maps to a non-empty glyph with a sane advance.
 * The browser's own font loader (OTS in Chrome and Firefox, Core Text in
 * Safari) is the third check; see browser-load.ts.
 */
import opentype from 'opentype.js';
import { tableChecksum } from '../font-generation/binary';

export interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  numGlyphs: number;
  format: 'truetype' | 'cff' | 'unknown';
  familyName: string;
}

const REQUIRED_COMMON = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post'];

export function checkContainer(bytes: Uint8Array): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (message: string) => issues.push({ level: 'error', message });
  if (bytes.length < 12) { err('The file is too short to be a font.'); return issues; }
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sfnt = v.getUint32(0);
  const isTT = sfnt === 0x00010000, isCFF = sfnt === 0x4f54544f;
  if (!isTT && !isCFF) { err('The file does not start with a TrueType or OpenType signature.'); return issues; }
  const numTables = v.getUint16(4);
  if (12 + numTables * 16 > bytes.length) { err('The table directory runs past the end of the file.'); return issues; }
  const tables = new Map<string, { offset: number; length: number; checksum: number }>();
  let prevTag = '';
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    const tag = String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    const checksum = v.getUint32(o + 4), offset = v.getUint32(o + 8), length = v.getUint32(o + 12);
    if (tag <= prevTag) err(`Table directory is not sorted at "${tag}".`);
    prevTag = tag;
    if (offset + length > bytes.length) { err(`Table "${tag}" runs past the end of the file.`); continue; }
    if (offset % 4) err(`Table "${tag}" is not 4-byte aligned.`);
    tables.set(tag, { offset, length, checksum });
    const data = bytes.slice(offset, offset + length);
    if (tag === 'head' && length >= 12) data.fill(0, 8, 12);
    if (tableChecksum(data) !== checksum) err(`Checksum mismatch in table "${tag}".`);
  }
  const required = [...REQUIRED_COMMON, ...(isTT ? ['glyf', 'loca'] : ['CFF '])];
  for (const t of required) if (!tables.has(t)) err(`Required table "${t.trim()}" is missing.`);
  const head = tables.get('head');
  if (head) {
    if (v.getUint32(head.offset + 12) !== 0x5f0f3cf5) err('The head table has a bad magic number.');
    const whole = tableChecksum(bytes);
    if (whole !== 0xb1b0afba) err('The whole-file checksum adjustment is wrong.');
    const upm = v.getUint16(head.offset + 18);
    if (upm < 16 || upm > 16384) err(`unitsPerEm ${upm} is outside 16..16384.`);
  }
  if (isTT && head && tables.get('loca') && tables.get('maxp') && tables.get('glyf')) {
    const longLoca = v.getInt16(head.offset + 50) === 1;
    const numGlyphs = v.getUint16(tables.get('maxp')!.offset + 4);
    const loca = tables.get('loca')!;
    const glyfLen = tables.get('glyf')!.length;
    const expected = (numGlyphs + 1) * (longLoca ? 4 : 2);
    if (loca.length < expected) err('The loca table is shorter than the glyph count needs.');
    else {
      let prev = 0;
      for (let i = 0; i <= numGlyphs; i++) {
        const off = longLoca ? v.getUint32(loca.offset + i * 4) : v.getUint16(loca.offset + i * 2) * 2;
        if (off < prev || off > glyfLen) { err(`Glyph offset ${i} in loca is out of order or out of range.`); break; }
        prev = off;
      }
    }
  }
  return issues;
}

export interface ExpectedContent {
  familyName: string;
  /** Characters that must map to a drawn glyph. */
  chars: string[];
  format: 'ttf' | 'otf';
}

export function validateFont(bytes: Uint8Array, expected: ExpectedContent): ValidationResult {
  const issues = checkContainer(bytes);
  const result: ValidationResult = { ok: false, issues, numGlyphs: 0, format: 'unknown', familyName: '' };
  if (issues.some((i) => i.level === 'error')) return result;
  let font: opentype.Font;
  try {
    font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  } catch (e) {
    issues.push({ level: 'error', message: `The font could not be read back: ${(e as Error).message}` });
    return result;
  }
  result.format = font.outlinesFormat === 'truetype' ? 'truetype' : font.outlinesFormat === 'cff' ? 'cff' : 'unknown';
  result.numGlyphs = font.numGlyphs;
  result.familyName = font.names.fontFamily?.en ?? '';
  const want = expected.format === 'ttf' ? 'truetype' : 'cff';
  if (result.format !== want) issues.push({ level: 'error', message: `Expected ${want} outlines but found ${result.format}.` });
  if (result.familyName !== expected.familyName) issues.push({ level: 'error', message: `Family name reads back as "${result.familyName}".` });
  if (font.charToGlyphIndex(' ') === 0) issues.push({ level: 'error', message: 'The space character is not mapped.' });
  const unmapped: string[] = [];
  const blank: string[] = [];
  for (const ch of expected.chars) {
    const g = font.charToGlyph(ch);
    if (!g || g.index === 0) { unmapped.push(ch); continue; }
    const bb = g.getBoundingBox();
    if (!(bb.x2 > bb.x1 && bb.y2 > bb.y1)) blank.push(ch);
    if (!(g.advanceWidth! > 0)) issues.push({ level: 'error', message: `"${ch}" has no advance width.` });
  }
  if (unmapped.length) issues.push({ level: 'error', message: `Not mapped to a glyph: ${unmapped.join(' ')}` });
  if (blank.length) issues.push({ level: 'error', message: `Mapped but empty: ${blank.join(' ')}` });
  if (expected.chars.length === 0) issues.push({ level: 'warning', message: 'The font has no drawn characters yet, only a space.' });
  result.ok = !issues.some((i) => i.level === 'error');
  return result;
}
