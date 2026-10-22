import { writeFileSync, mkdirSync } from 'node:fs';
import opentype from 'opentype.js';
import { describe, expect, it } from 'vitest';
import { buildInventory } from '../src/data/character-sets';
import { generateFont } from '../src/modules/font-generation';
import { buildFontModel } from '../src/modules/font-generation/build-font';
import { writeTTF } from '../src/modules/font-generation/ttf-writer';
import { checkContainer } from '../src/modules/font-validation/validate';
import { record, testProject, tracedStrokes } from './fixtures';

const project = testProject();
const basic = buildInventory(['upper', 'lower', 'numbers', 'punctuation'], '').map((e) => e.char);
const records = basic.map((ch) => record(project.id, ch));
const OUT = process.env.FONT_OUT;

describe('TrueType export', () => {
  const font = generateFont(project, records, 'ttf');
  if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${font.fileName}`, font.bytes); }

  it('is a valid TrueType file that passes our own validation', () => {
    expect(font.validation.issues).toEqual([]);
    expect(font.validation.ok).toBe(true);
    expect(font.validation.format).toBe('truetype');
    expect(font.fileName).toBe('TestHand-Regular.ttf');
    expect(new DataView(font.bytes.buffer).getUint32(0)).toBe(0x00010000);
  });

  it('maps every drawn character to its own glyph with outlines', () => {
    const parsed = opentype.parse(font.bytes.slice().buffer);
    expect(parsed.outlinesFormat).toBe('truetype');
    expect(parsed.numGlyphs).toBe(basic.length + 2);
    for (const ch of basic) {
      const g = parsed.charToGlyph(ch);
      expect(g.index, ch).toBeGreaterThan(1);
      expect(g.path.commands.length, ch).toBeGreaterThan(3);
    }
    expect(parsed.charToGlyph(' ').advanceWidth).toBe(project.layout.spaceWidth);
    expect(parsed.charToGlyphIndex(' ')).toBe(parsed.charToGlyphIndex(' '));
  });

  it('writes the names', () => {
    const parsed = opentype.parse(font.bytes.slice().buffer);
    expect(parsed.names.fontFamily.en).toBe('Test Hand');
    expect(parsed.names.fontSubfamily.en).toBe('Regular');
    expect(parsed.names.postScriptName.en).toBe('TestHand-Regular');
    expect(parsed.names.designer.en).toBe('Tess Ter');
    expect(parsed.names.version.en).toBe('Version 1.000');
  });

  it('keeps natural widths (I narrower than M) and sits on the baseline', () => {
    const parsed = opentype.parse(font.bytes.slice().buffer);
    expect(parsed.charToGlyph('I').advanceWidth!).toBeLessThan(parsed.charToGlyph('M').advanceWidth!);
    const H = parsed.charToGlyph('H').getBoundingBox();
    expect(Math.abs(H.y1)).toBeLessThan(40);
    expect(Math.abs(H.y2 - 700)).toBeLessThan(40);
    const p = parsed.charToGlyph('p').getBoundingBox();
    expect(p.y1).toBeLessThan(-150);
  });

  it('flags a corrupted file', () => {
    const bad = font.bytes.slice();
    bad[bad.length - 9] ^= 0xff;
    expect(checkContainer(bad).length).toBeGreaterThan(0);
  });
});

describe('OpenType (CFF) export', () => {
  const font = generateFont(project, records, 'otf');
  if (OUT) writeFileSync(`${OUT}/${font.fileName}`, font.bytes);
  it('is a valid CFF OpenType file', () => {
    expect(font.validation.issues).toEqual([]);
    expect(font.validation.format).toBe('cff');
    expect(String.fromCharCode(...font.bytes.slice(0, 4))).toBe('OTTO');
    expect(font.fileName).toBe('TestHand-Regular.otf');
  });
});

describe('partial and unusual fonts', () => {
  it('exports a font with only a few letters and lists the rest as missing', () => {
    const recs = ['H', 'i'].map((c) => record(project.id, c));
    const f = generateFont(project, recs, 'ttf');
    expect(f.validation.ok).toBe(true);
    expect(f.report.included).toEqual(['H', 'i']);
    expect(f.report.missing.length).toBe(basic.length - 2);
  });

  it('exports an empty project as a valid font with a warning', () => {
    const f = generateFont(project, [], 'ttf');
    expect(f.validation.ok).toBe(true);
    expect(f.validation.issues.some((i) => i.level === 'warning')).toBe(true);
  });

  it('handles accented and astral characters (format 12 cmap)', () => {
    const p = testProject({ groups: ['extended'], customChars: '😀' });
    const recs = [record(p.id, 'é'), record(p.id, 'ñ'), { ...record(p.id, '😀', tracedStrokes('O')) }];
    const f = generateFont(p, recs, 'ttf');
    expect(f.validation.issues).toEqual([]);
    const parsed = opentype.parse(f.bytes.slice().buffer);
    expect(parsed.charToGlyph('😀').index).toBeGreaterThan(0);
    expect(parsed.charToGlyph('é').index).toBeGreaterThan(0);
  });

  it('survives a tap (a single-point stroke) and an empty stroke list', () => {
    const recs = [
      { ...record(project.id, '.'), strokes: [{ pen: false, points: [500, 940, 0.5] }] },
      { ...record(project.id, ','), strokes: [] },
    ];
    const f = generateFont(project, recs, 'ttf');
    expect(f.report.included).toEqual(['.']);
    expect(f.validation.ok).toBe(true);
  });

  it('writes non-ASCII family names without Mac name records', () => {
    const p = testProject({ familyName: 'Écriture Zoë' });
    const { model } = buildFontModel(p, [record(p.id, 'A')]);
    expect(model.names.postScriptName).toBe('EcritureZoe-Regular');
    const bytes = writeTTF(model);
    const parsed = opentype.parse(bytes.slice().buffer);
    expect(parsed.names.fontFamily.en).toBe('Écriture Zoë');
  });
});
