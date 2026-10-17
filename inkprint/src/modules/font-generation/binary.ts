/** A growable big-endian byte writer for building font tables. */
export class ByteWriter {
  private buf: Uint8Array;
  private view: DataView;
  length = 0;

  constructor(initial = 1024) {
    this.buf = new Uint8Array(initial);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(n: number) {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v: number) { this.ensure(1); this.view.setUint8(this.length, v); this.length += 1; return this; }
  i8(v: number) { this.ensure(1); this.view.setInt8(this.length, v); this.length += 1; return this; }
  u16(v: number) { this.ensure(2); this.view.setUint16(this.length, v); this.length += 2; return this; }
  i16(v: number) { this.ensure(2); this.view.setInt16(this.length, v); this.length += 2; return this; }
  u32(v: number) { this.ensure(4); this.view.setUint32(this.length, v >>> 0); this.length += 4; return this; }
  i32(v: number) { this.ensure(4); this.view.setInt32(this.length, v); this.length += 4; return this; }
  /** 16.16 fixed point. */
  fixed(v: number) { return this.i32(Math.round(v * 65536)); }
  /** LONGDATETIME: seconds since 1904-01-01T00:00:00Z, as a signed 64-bit number. */
  longDateTime(date: Date) {
    const secs = Math.floor(date.getTime() / 1000) + 2082844800;
    this.u32(Math.floor(secs / 0x100000000));
    return this.u32(secs % 0x100000000);
  }
  tag(t: string) {
    if (t.length !== 4) throw new Error(`bad tag ${t}`);
    for (let i = 0; i < 4; i++) this.u8(t.charCodeAt(i));
    return this;
  }
  bytes(b: Uint8Array) { this.ensure(b.length); this.buf.set(b, this.length); this.length += b.length; return this; }
  pad(align: number) { while (this.length % align) this.u8(0); return this; }
  setU16(at: number, v: number) { this.view.setUint16(at, v); }
  setU32(at: number, v: number) { this.view.setUint32(at, v >>> 0); }
  toBytes(): Uint8Array { return this.buf.slice(0, this.length); }
}

/** OpenType table checksum: the sum of the data as big-endian uint32s, zero-padded. */
export function tableChecksum(data: Uint8Array): number {
  let sum = 0;
  const n = Math.ceil(data.length / 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const word = ((data[o] ?? 0) << 24) | ((data[o + 1] ?? 0) << 16) | ((data[o + 2] ?? 0) << 8) | (data[o + 3] ?? 0);
    sum = (sum + (word >>> 0)) >>> 0;
  }
  return sum;
}

export function utf16be(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i * 2] = c >> 8;
    out[i * 2 + 1] = c & 0xff;
  }
  return out;
}

/** The largest power of two not above n, and its log2 (for binary-search headers). */
export function searchParams(n: number, unit: number) {
  let pow = 1, log = 0;
  while (pow * 2 <= n) { pow *= 2; log++; }
  return { searchRange: pow * unit, entrySelector: log, rangeShift: n * unit - pow * unit };
}
