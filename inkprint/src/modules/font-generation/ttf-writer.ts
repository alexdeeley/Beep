/**
 * A TrueType (glyf-outline) font writer.
 *
 * opentype.js, which Inkprint uses for .otf, can only write CFF outlines, so
 * genuine .ttf files are written here, table by table, following the
 * OpenType 1.9 specification: head, hhea, maxp, OS/2, hmtx, cmap, loca, glyf,
 * name and post. Outlines are quadratic, so the glyph contours are stored
 * exactly as computed, with on- and off-curve points.
 */
import { ByteWriter, searchParams, tableChecksum, utf16be } from './binary';
import type { FontModel, ModelGlyph } from './font-model';

interface Table {
  tag: string;
  data: Uint8Array;
}

interface GlyphStats {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  points: number;
  contours: number;
  empty: boolean;
}

function glyphStats(g: ModelGlyph): GlyphStats {
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity, points = 0;
  for (const c of g.contours) {
    for (const p of c) {
      xMin = Math.min(xMin, p.x); yMin = Math.min(yMin, p.y);
      xMax = Math.max(xMax, p.x); yMax = Math.max(yMax, p.y);
      points++;
    }
  }
  if (!points) return { xMin: 0, yMin: 0, xMax: 0, yMax: 0, points: 0, contours: 0, empty: true };
  return { xMin, yMin, xMax, yMax, points, contours: g.contours.length, empty: false };
}

function checkInt16(v: number, what: string) {
  if (!Number.isInteger(v) || v < -32768 || v > 32767) throw new Error(`${what} is out of range (${v})`);
}

/** One simple glyph in glyf format, with compact (short / repeated) coordinates. */
function encodeGlyph(g: ModelGlyph, st: GlyphStats): Uint8Array {
  if (st.empty) return new Uint8Array(0);
  const w = new ByteWriter(64 + st.points * 5);
  w.i16(g.contours.length).i16(st.xMin).i16(st.yMin).i16(st.xMax).i16(st.yMax);
  let end = -1;
  for (const c of g.contours) {
    end += c.length;
    w.u16(end);
  }
  w.u16(0); // no hinting instructions
  const flags: number[] = [];
  const xs = new ByteWriter(st.points * 2);
  const ys = new ByteWriter(st.points * 2);
  let px = 0, py = 0;
  for (const c of g.contours) {
    for (const p of c) {
      checkInt16(p.x, 'x coordinate');
      checkInt16(p.y, 'y coordinate');
      const dx = p.x - px, dy = p.y - py;
      px = p.x; py = p.y;
      let f = p.on ? 0x01 : 0;
      if (dx === 0) f |= 0x10;
      else if (Math.abs(dx) < 256) { f |= 0x02 | (dx > 0 ? 0x10 : 0); xs.u8(Math.abs(dx)); }
      else xs.i16(dx);
      if (dy === 0) f |= 0x20;
      else if (Math.abs(dy) < 256) { f |= 0x04 | (dy > 0 ? 0x20 : 0); ys.u8(Math.abs(dy)); }
      else ys.i16(dy);
      flags.push(f);
    }
  }
  // Run-length encode repeated flags (REPEAT_FLAG, bit 3).
  for (let i = 0; i < flags.length; ) {
    let run = 1;
    while (i + run < flags.length && flags[i + run] === flags[i] && run < 256) run++;
    if (run > 1) { w.u8(flags[i] | 0x08).u8(run - 1); i += run; }
    else { w.u8(flags[i]); i++; }
  }
  w.bytes(xs.toBytes()).bytes(ys.toBytes());
  w.pad(4);
  return w.toBytes();
}

function cmapTable(glyphs: ModelGlyph[]): Uint8Array {
  const map: [number, number][] = [];
  glyphs.forEach((g, gid) => g.unicodes.forEach((cp) => map.push([cp, gid])));
  map.sort((a, b) => a[0] - b[0]);
  const bmp = map.filter(([cp]) => cp <= 0xfffe);
  const needs12 = map.some(([cp]) => cp > 0xffff);

  // Format 4: one segment per run of consecutive code points with consecutive glyph ids.
  const segs: { start: number; end: number; delta: number }[] = [];
  for (const [cp, gid] of bmp) {
    const last = segs[segs.length - 1];
    if (last && cp === last.end + 1 && ((gid - cp) & 0xffff) === last.delta) last.end = cp;
    else segs.push({ start: cp, end: cp, delta: (gid - cp) & 0xffff });
  }
  segs.push({ start: 0xffff, end: 0xffff, delta: 1 });
  const segCount = segs.length;
  const f4 = new ByteWriter();
  const { searchRange, entrySelector, rangeShift } = searchParams(segCount, 2);
  f4.u16(4).u16(0).u16(0).u16(segCount * 2).u16(searchRange).u16(entrySelector).u16(rangeShift);
  segs.forEach((s) => f4.u16(s.end));
  f4.u16(0);
  segs.forEach((s) => f4.u16(s.start));
  segs.forEach((s) => f4.u16(s.delta));
  segs.forEach(() => f4.u16(0));
  if (f4.length > 0xffff) throw new Error('Too many characters for a cmap format 4 subtable');
  f4.setU16(2, f4.length);
  const sub4 = f4.toBytes();

  let sub12: Uint8Array | null = null;
  if (needs12) {
    const groups: { start: number; end: number; gid: number }[] = [];
    for (const [cp, gid] of map) {
      const last = groups[groups.length - 1];
      if (last && cp === last.end + 1 && gid === last.gid + (cp - last.start)) last.end = cp;
      else groups.push({ start: cp, end: cp, gid });
    }
    const f12 = new ByteWriter();
    f12.u16(12).u16(0).u32(16 + groups.length * 12).u32(0).u32(groups.length);
    groups.forEach((g) => f12.u32(g.start).u32(g.end).u32(g.gid));
    sub12 = f12.toBytes();
  }

  const records: [number, number, Uint8Array][] = [[0, 3, sub4]];
  if (sub12) records.push([0, 4, sub12]);
  records.push([3, 1, sub4]);
  if (sub12) records.push([3, 10, sub12]);
  const w = new ByteWriter();
  w.u16(0).u16(records.length);
  const headerLen = 4 + records.length * 8;
  const off4 = headerLen;
  const off12 = headerLen + sub4.length;
  for (const [pid, eid, sub] of records) w.u16(pid).u16(eid).u32(sub === sub4 ? off4 : off12);
  w.bytes(sub4);
  if (sub12) w.bytes(sub12);
  return w.toBytes();
}

function nameTable(m: FontModel): Uint8Array {
  const n = m.names;
  const entries: [number, string][] = [
    [0, n.copyright],
    [1, n.family],
    [2, n.subfamily],
    [3, n.uniqueId],
    [4, n.fullName],
    [5, n.version],
    [6, n.postScriptName],
    [9, n.designer],
    [10, n.description],
  ].filter(([, s]) => (s as string).trim() !== '') as [number, string][];
  const isAscii = entries.every(([, s]) => /^[\x20-\x7e]*$/.test(s));
  const records: { pid: number; eid: number; lid: number; nid: number; bytes: Uint8Array }[] = [];
  if (isAscii) {
    // Macintosh Roman records for older Mac software (ASCII is a subset of Mac Roman).
    for (const [nid, s] of entries) records.push({ pid: 1, eid: 0, lid: 0, nid, bytes: Uint8Array.from(s, (c) => c.charCodeAt(0)) });
  }
  for (const [nid, s] of entries) records.push({ pid: 3, eid: 1, lid: 0x409, nid, bytes: utf16be(s) });
  const w = new ByteWriter();
  w.u16(0).u16(records.length).u16(6 + records.length * 12);
  let offset = 0;
  for (const r of records) {
    w.u16(r.pid).u16(r.eid).u16(r.lid).u16(r.nid).u16(r.bytes.length).u16(offset);
    offset += r.bytes.length;
  }
  for (const r of records) w.bytes(r.bytes);
  return w.toBytes();
}

function unicodeRanges(cps: number[]): [number, number, number, number] {
  const r = [0, 0, 0, 0];
  const set = (bit: number) => (r[bit >> 5] |= 1 << (bit & 31));
  for (const cp of cps) {
    if (cp >= 0x20 && cp <= 0x7e) set(0);
    else if (cp >= 0x80 && cp <= 0xff) set(1);
    else if (cp >= 0x100 && cp <= 0x17f) set(2);
    else if (cp >= 0x180 && cp <= 0x24f) set(3);
    else if (cp >= 0x370 && cp <= 0x3ff) set(7);
    else if (cp >= 0x400 && cp <= 0x4ff) set(9);
    else if (cp >= 0x2000 && cp <= 0x206f) set(31);
    else if (cp >= 0x20a0 && cp <= 0x20cf) set(33);
    else if (cp >= 0x2100 && cp <= 0x214f) set(37);
    else if (cp >= 0x10000) set(57);
  }
  return r.map((v) => v >>> 0) as [number, number, number, number];
}

export function writeTTF(m: FontModel): Uint8Array {
  if (m.glyphs.length === 0 || m.glyphs[0].name !== '.notdef') throw new Error('Glyph 0 must be .notdef');
  if (m.glyphs.length > 65535) throw new Error('Too many glyphs');
  const stats = m.glyphs.map(glyphStats);
  const glyphData = m.glyphs.map((g, i) => encodeGlyph(g, stats[i]));

  // glyf + loca (long offsets)
  const glyf = new ByteWriter();
  const loca = new ByteWriter();
  for (const d of glyphData) { loca.u32(glyf.length); glyf.bytes(d); }
  loca.u32(glyf.length);

  const inked = stats.filter((s) => !s.empty);
  const xMin = Math.min(...inked.map((s) => s.xMin), 0);
  const yMin = Math.min(...inked.map((s) => s.yMin), 0);
  const xMax = Math.max(...inked.map((s) => s.xMax), 0);
  const yMax = Math.max(...inked.map((s) => s.yMax), 0);
  const advances = m.glyphs.map((g) => g.advanceWidth);
  advances.forEach((a) => { if (!Number.isInteger(a) || a < 0 || a > 65535) throw new Error(`Bad advance width ${a}`); });
  [xMin, yMin, xMax, yMax].forEach((v) => checkInt16(v, 'Font bounding box'));

  const head = new ByteWriter();
  head.u16(1).u16(0) // version 1.0
    .fixed(m.names.revision)
    .u32(0) // checkSumAdjustment, patched below
    .u32(0x5f0f3cf5)
    .u16(0b1011) // baseline at y=0, lsb at x=0, integer scaling
    .u16(m.unitsPerEm)
    .longDateTime(m.created).longDateTime(m.created)
    .i16(xMin).i16(yMin).i16(xMax).i16(yMax)
    .u16(0) // macStyle: regular
    .u16(8) // lowestRecPPEM
    .i16(2) // fontDirectionHint (deprecated, fixed value)
    .i16(1) // indexToLocFormat: long
    .i16(0);

  const lsbs = stats.map((s) => (s.empty ? 0 : s.xMin));
  const rsbs = stats.map((s, i) => (s.empty ? 0 : advances[i] - s.xMax));
  const hhea = new ByteWriter();
  hhea.u16(1).u16(0)
    .i16(m.vertical.ascender).i16(m.vertical.descender).i16(m.vertical.lineGap)
    .u16(Math.max(...advances))
    .i16(Math.min(...lsbs.filter((_, i) => !stats[i].empty), 0))
    .i16(Math.min(...rsbs.filter((_, i) => !stats[i].empty), 0))
    .i16(Math.max(...stats.map((s) => (s.empty ? 0 : s.xMax)), 0))
    .i16(1).i16(0).i16(0) // caret: vertical
    .i16(0).i16(0).i16(0).i16(0)
    .i16(0) // metricDataFormat
    .u16(m.glyphs.length); // numberOfHMetrics

  const maxp = new ByteWriter();
  maxp.u32(0x00010000).u16(m.glyphs.length)
    .u16(Math.max(...stats.map((s) => s.points)))
    .u16(Math.max(...stats.map((s) => s.contours)))
    .u16(0).u16(0) // composite points / contours
    .u16(2) // maxZones
    .u16(0).u16(0).u16(0).u16(0).u16(0).u16(0) // twilight, storage, fdefs, idefs, stack, instruction size
    .u16(0).u16(0); // components

  const hmtx = new ByteWriter();
  m.glyphs.forEach((_, i) => hmtx.u16(advances[i]).i16(lsbs[i]));

  const cps = m.glyphs.flatMap((g) => g.unicodes);
  const inkAdvances = advances.filter((a) => a > 0);
  const winAscent = Math.max(yMax, m.vertical.ascender);
  const winDescent = Math.max(-yMin, -m.vertical.descender);
  const [ur1, ur2, ur3, ur4] = unicodeRanges(cps);
  const latin1 = cps.some((cp) => cp >= 0x20 && cp <= 0xff);
  const os2 = new ByteWriter();
  os2.u16(4)
    .i16(Math.round(inkAdvances.reduce((a, b) => a + b, 0) / Math.max(1, inkAdvances.length)))
    .u16(400).u16(5) // regular weight, normal width
    .u16(0) // fsType 0: installable embedding
    .i16(650).i16(600).i16(0).i16(75) // subscript
    .i16(650).i16(600).i16(0).i16(350) // superscript
    .i16(50).i16(Math.round(m.vertical.xHeight * 0.55)) // strikeout
    .i16(10 << 8) // sFamilyClass: scripts
    .bytes(Uint8Array.from([3, 0, 0, 0, 0, 0, 0, 0, 0, 0])) // PANOSE: Latin hand written
    .u32(ur1).u32(ur2).u32(ur3).u32(ur4)
    .tag('NONE')
    .u16(0x40 | 0x80) // REGULAR | USE_TYPO_METRICS
    .u16(Math.min(0xffff, Math.min(...cps, 0xffff)))
    .u16(Math.min(0xffff, Math.max(...cps, 0)))
    .i16(m.vertical.ascender).i16(m.vertical.descender).i16(m.vertical.lineGap)
    .u16(Math.min(0xffff, winAscent)).u16(Math.min(0xffff, winDescent))
    .u32(latin1 ? 1 : 0).u32(0)
    .i16(m.vertical.xHeight).i16(m.vertical.capHeight)
    .u16(0).u16(32).u16(0);

  const post = new ByteWriter();
  post.u32(0x00030000).fixed(0).i16(-120).i16(50).u32(0).u32(0).u32(0).u32(0).u32(0);

  const tables: Table[] = [
    { tag: 'OS/2', data: os2.toBytes() },
    { tag: 'cmap', data: cmapTable(m.glyphs) },
    { tag: 'glyf', data: glyf.toBytes() },
    { tag: 'head', data: head.toBytes() },
    { tag: 'hhea', data: hhea.toBytes() },
    { tag: 'hmtx', data: hmtx.toBytes() },
    { tag: 'loca', data: loca.toBytes() },
    { tag: 'maxp', data: maxp.toBytes() },
    { tag: 'name', data: nameTable(m) },
    { tag: 'post', data: post.toBytes() },
  ].sort((a, b) => (a.tag < b.tag ? -1 : 1));

  const out = new ByteWriter(16384);
  const { searchRange, entrySelector, rangeShift } = searchParams(tables.length, 16);
  out.u32(0x00010000).u16(tables.length).u16(searchRange).u16(entrySelector).u16(rangeShift);
  let offset = 12 + tables.length * 16;
  let headOffset = 0;
  for (const t of tables) {
    if (t.tag === 'head') headOffset = offset;
    out.tag(t.tag).u32(tableChecksum(t.data)).u32(offset).u32(t.data.length);
    offset += Math.ceil(t.data.length / 4) * 4;
  }
  for (const t of tables) out.bytes(t.data).pad(4);
  const bytes = out.toBytes();
  const adjust = (0xb1b0afba - tableChecksum(bytes)) >>> 0;
  new DataView(bytes.buffer).setUint32(headOffset + 8, adjust);
  return bytes;
}
