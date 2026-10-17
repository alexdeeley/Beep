/**
 * OpenType (CFF outline) writer, using opentype.js. opentype.js writes CFF
 * ("OTTO") fonts only, which is exactly what a .otf should be. CFF wants outer
 * contours counter-clockwise, so contours are reversed from the TrueType
 * orientation; quadratic segments are converted to cubics by opentype.js.
 */
import opentype from 'opentype.js';
import { contourToCommands, reverseContour } from '../glyph-processing/contour';
import type { FontModel } from './font-model';

export function writeOTF(m: FontModel): Uint8Array {
  const glyphs = m.glyphs.map((g) => {
    const path = new opentype.Path();
    for (const c of g.contours) {
      for (const cmd of contourToCommands(reverseContour(c))) {
        if (cmd.type === 'M') path.moveTo(cmd.x, cmd.y);
        else if (cmd.type === 'L') path.lineTo(cmd.x, cmd.y);
        else if (cmd.type === 'Q') path.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y);
        else path.close();
      }
    }
    return new opentype.Glyph({
      name: g.name,
      unicode: g.unicodes[0],
      unicodes: g.unicodes,
      advanceWidth: g.advanceWidth,
      path,
    } as opentype.GlyphOptions);
  });
  const font = new opentype.Font({
    familyName: m.names.family,
    styleName: m.names.subfamily,
    fullName: m.names.fullName,
    postScriptName: m.names.postScriptName,
    designer: m.names.designer || ' ',
    copyright: m.names.copyright || ' ',
    description: m.names.description || ' ',
    version: m.names.version,
    unitsPerEm: m.unitsPerEm,
    ascender: m.vertical.ascender,
    descender: m.vertical.descender,
    createdTimestamp: Math.floor(m.created.getTime() / 1000),
    glyphs,
    tables: {
      os2: {
        sTypoLineGap: m.vertical.lineGap,
        sxHeight: m.vertical.xHeight,
        sCapHeight: m.vertical.capHeight,
        fsSelection: 0x40, // opentype.js writes OS/2 v3, where USE_TYPO_METRICS is undefined
        usWeightClass: 400,
        achVendID: 'NONE',
      },
    },
  } as unknown as opentype.FontConstructorOptions);
  (font.names as unknown as Record<string, { en: string }>).uniqueID = { en: m.names.uniqueId };
  return new Uint8Array(font.toArrayBuffer());
}
