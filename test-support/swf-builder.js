// Minimal SWF writer used only to build synthetic fixtures for extractor tests.
// It writes just enough of the format (shapes with solid fills, sprites, lossless
// bitmaps, SymbolClass/ExportAssets) to exercise the reader and FFDec export path.
import { deflateSync } from "node:zlib";

class BitWriter {
  constructor() { this.bytes = []; this.cur = 0; this.nbits = 0; }
  bits(value, count) {
    for (let i = count - 1; i >= 0; i--) {
      this.cur = (this.cur << 1) | ((value >>> i) & 1);
      if (++this.nbits === 8) { this.bytes.push(this.cur); this.cur = 0; this.nbits = 0; }
    }
  }
  sbits(value, count) { this.bits(value < 0 ? (value + 2 ** count) : value, count); }
  align() { while (this.nbits !== 0) this.bits(0, 1); }
  toBuffer() { this.align(); return Buffer.from(this.bytes); }
}

function minSignedBits(...values) {
  let n = 1;
  for (const v of values) {
    let b = 1;
    while (v < -(2 ** (b - 1)) || v > 2 ** (b - 1) - 1) b++;
    if (b > n) n = b;
  }
  return n;
}

export function rect(xmin, xmax, ymin, ymax) {
  const w = new BitWriter();
  const n = minSignedBits(xmin, xmax, ymin, ymax);
  w.bits(n, 5);
  for (const v of [xmin, xmax, ymin, ymax]) w.sbits(v, n);
  return w.toBuffer();
}

const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const cstr = (s) => Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0])]);

export function tag(code, body = Buffer.alloc(0)) {
  if (body.length < 63) return Buffer.concat([u16((code << 6) | body.length), body]);
  return Buffer.concat([u16((code << 6) | 0x3f), u32(body.length), body]);
}

// Filled rectangle shape (twips). Origin (0,0) is the registration point, so a
// rect from (x,y) of size (w,h) exercises non-zero origin offsets.
export function defineShapeRect(id, x, y, w, h, rgba = [255, 0, 0, 255]) {
  const bounds = rect(x, x + w, y, y + h);
  const style = Buffer.concat([
    Buffer.from([1]), // one fill style
    Buffer.from([0x00, rgba[0], rgba[1], rgba[2], rgba[3]]), // solid RGBA (DefineShape3)
    Buffer.from([0]), // zero line styles
  ]);
  const w2 = new BitWriter();
  w2.bits(1, 4); // NumFillBits
  w2.bits(0, 4); // NumLineBits
  // StyleChangeRecord: new move-to + fill style 1
  w2.bits(0, 1); w2.bits(0, 1); w2.bits(0, 1); w2.bits(1, 1); w2.bits(0, 1); w2.bits(1, 1);
  const mb = minSignedBits(x, y);
  w2.bits(mb, 5); w2.sbits(x, mb); w2.sbits(y, mb);
  w2.bits(1, 1); // FillStyle1 = 1 (NumFillBits = 1)
  const edge = (dx, dy) => {
    const nb = Math.max(2, minSignedBits(dx, dy));
    w2.bits(1, 1); w2.bits(1, 1); w2.bits(nb - 2, 4); w2.bits(1, 1);
    w2.sbits(dx, nb); w2.sbits(dy, nb);
  };
  edge(w, 0); edge(0, h); edge(-w, 0); edge(0, -h);
  w2.bits(0, 1); w2.bits(0, 5); // EndShapeRecord
  return tag(32, Buffer.concat([u16(id), bounds, style, w2.toBuffer()]));
}

function matrix(tx = 0, ty = 0) {
  const w = new BitWriter();
  w.bits(0, 1); // no scale
  w.bits(0, 1); // no rotate
  const n = minSignedBits(tx, ty);
  w.bits(n, 5); w.sbits(tx, n); w.sbits(ty, n);
  return w.toBuffer();
}

export function placeObject2(depth, characterId, tx = 0, ty = 0) {
  const flags = 0x02 | 0x04; // HasCharacter | HasMatrix
  return tag(26, Buffer.concat([Buffer.from([flags]), u16(depth), u16(characterId), matrix(tx, ty)]));
}

export const showFrame = () => tag(1);
export const endTag = () => tag(0);

export function defineSprite(id, children, frameCount = 1) {
  return tag(39, Buffer.concat([u16(id), u16(frameCount), ...children, showFrame(), endTag()]));
}

// 32-bit ARGB lossless bitmap. `pixels` is RGBA (non-premultiplied); SWF stores premultiplied ARGB.
export function defineBitsLossless2(id, width, height, rgba) {
  const raw = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2], a = rgba[i * 4 + 3];
    raw[i * 4] = a;
    raw[i * 4 + 1] = Math.round((r * a) / 255);
    raw[i * 4 + 2] = Math.round((g * a) / 255);
    raw[i * 4 + 3] = Math.round((b * a) / 255);
  }
  return tag(36, Buffer.concat([u16(id), Buffer.from([5]), u16(width), u16(height), deflateSync(raw)]));
}

export function symbolClass(entries) {
  return tag(76, Buffer.concat([u16(entries.length), ...entries.flatMap(([id, name]) => [u16(id), cstr(name)])]));
}

export function exportAssets(entries) {
  return tag(56, Buffer.concat([u16(entries.length), ...entries.flatMap(([id, name]) => [u16(id), cstr(name)])]));
}

export function buildSwf(tags, { version = 10, compress = false, stage = [0, 8000, 0, 4000], fps = 24 } = {}) {
  const body = Buffer.concat([
    rect(...stage),
    Buffer.from([0, fps]), // 8.8 fixed frame rate (little-endian: fraction, integer)
    u16(1), // frame count
    ...tags,
    showFrame(),
    endTag(),
  ]);
  const total = 8 + body.length;
  const header = Buffer.concat([Buffer.from(compress ? "CWS" : "FWS"), Buffer.from([version]), u32(total)]);
  return Buffer.concat([header, compress ? deflateSync(body) : body]);
}
