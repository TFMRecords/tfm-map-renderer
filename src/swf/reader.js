// Minimal SWF container reader: header, top-level tags, character table, symbol names.
// It deliberately does not decode shape geometry or ABC code; FFDec does the heavy lifting.
// Its job is to give the extractor an FFDec-independent view of "what is in this SWF".
import { inflateSync } from "node:zlib";

export class UnsupportedSwfError extends Error {
  constructor(message) { super(message); this.name = "UnsupportedSwfError"; }
}

const TWIPS = 20;

export const TAG_NAMES = Object.freeze({
  0: "End", 1: "ShowFrame", 2: "DefineShape", 6: "DefineBits", 7: "DefineButton", 8: "JPEGTables",
  9: "SetBackgroundColor", 10: "DefineFont", 11: "DefineText", 14: "DefineSound", 20: "DefineBitsLossless",
  21: "DefineBitsJPEG2", 22: "DefineShape2", 32: "DefineShape3", 33: "DefineText2", 34: "DefineButton2",
  35: "DefineBitsJPEG3", 36: "DefineBitsLossless2", 37: "DefineEditText", 39: "DefineSprite", 46: "DefineMorphShape",
  48: "DefineFont2", 56: "ExportAssets", 60: "DefineVideoStream", 69: "FileAttributes", 75: "DefineFont3",
  76: "SymbolClass", 82: "DoABC", 83: "DefineShape4", 84: "DefineMorphShape2", 87: "DefineBinaryData",
  90: "DefineBitsJPEG4", 91: "DefineFont4",
});

const CHARACTER_KIND = Object.freeze({
  2: "shape", 22: "shape", 32: "shape", 83: "shape",
  46: "morphshape", 84: "morphshape",
  39: "sprite",
  6: "image", 20: "image", 21: "image", 35: "image", 36: "image", 90: "image",
  11: "text", 33: "text", 37: "text",
  7: "button", 34: "button",
  10: "font", 48: "font", 75: "font", 91: "font",
  14: "sound", 60: "video", 87: "binary",
});

class Bits {
  constructor(buf, offset) { this.buf = buf; this.pos = offset * 8; }
  read(n) { let v = 0; for (let i = 0; i < n; i++) { v = (v << 1) | ((this.buf[this.pos >> 3] >> (7 - (this.pos & 7))) & 1); this.pos++; } return v; }
  readSigned(n) { const v = this.read(n); return n > 0 && v & (1 << (n - 1)) ? v - 2 ** n : v; }
  get byteOffset() { return (this.pos + 7) >> 3; }
}

export function readRect(buf, offset) {
  const bits = new Bits(buf, offset);
  const n = bits.read(5);
  const xmin = bits.readSigned(n), xmax = bits.readSigned(n), ymin = bits.readSigned(n), ymax = bits.readSigned(n);
  return { rect: { xmin, xmax, ymin, ymax }, next: bits.byteOffset };
}

export function rectToPixels(r) {
  return { x: r.xmin / TWIPS, y: r.ymin / TWIPS, width: (r.xmax - r.xmin) / TWIPS, height: (r.ymax - r.ymin) / TWIPS };
}

function readCString(buf, offset, end) {
  let i = offset;
  while (i < end && buf[i] !== 0) i++;
  return { value: buf.toString("utf8", offset, i), next: i + 1 };
}

function readSymbolList(body, source) {
  const out = [];
  const count = body.readUInt16LE(0);
  let off = 2;
  for (let i = 0; i < count && off + 2 <= body.length; i++) {
    const id = body.readUInt16LE(off);
    const { value, next } = readCString(body, off + 2, body.length);
    out.push({ id, name: value, source });
    off = next;
  }
  return out;
}

/** Decompress (if needed) and return the SWF body after the 8-byte header. */
export function swfBody(buf) {
  const sig = buf.toString("latin1", 0, 3);
  if (sig === "FWS") return buf.subarray(8);
  if (sig === "CWS") return inflateSync(buf.subarray(8));
  if (sig === "ZWS") {
    throw new UnsupportedSwfError("LZMA-compressed SWF (ZWS) is not supported by the built-in reader; decompress it first (ffdec-cli -decompress in.swf out.swf)");
  }
  throw new UnsupportedSwfError("Not a SWF file (bad signature)");
}

/**
 * @param {Buffer} buf
 * @returns {{version:number,compression:string,frameSize:object,frameRate:number,frameCount:number,
 *   characters:Map<number,object>,symbols:Array<{id:number,name:string,source:string}>,tagCounts:Record<string,number>}}
 */
export function readSwf(buf) {
  const sig = buf.toString("latin1", 0, 3);
  const body = swfBody(buf);
  const version = buf[3];
  const { rect, next } = readRect(body, 0);
  const frameRate = body.readUInt16LE(next) / 256;
  const frameCount = body.readUInt16LE(next + 2);
  let off = next + 4;

  const characters = new Map();
  const symbols = [];
  const tagCounts = {};

  while (off + 2 <= body.length) {
    const header = body.readUInt16LE(off);
    const code = header >> 6;
    let length = header & 0x3f;
    off += 2;
    if (length === 0x3f) { length = body.readUInt32LE(off); off += 4; }
    const data = body.subarray(off, off + length);
    off += length;
    const name = TAG_NAMES[code] ?? `Tag${code}`;
    tagCounts[name] = (tagCounts[name] ?? 0) + 1;
    if (code === 0) break;

    const kind = CHARACTER_KIND[code];
    if (kind) {
      const id = data.readUInt16LE(0);
      const entry = { id, kind, tag: name };
      if (kind === "shape" || kind === "text") {
        entry.bounds = rectToPixels(readRect(data, 2).rect);
      } else if (kind === "morphshape") {
        entry.bounds = rectToPixels(readRect(data, 2).rect);
      } else if (kind === "sprite") {
        entry.frameCount = data.readUInt16LE(2);
      } else if (code === 20 || code === 36) {
        entry.format = data[2];
        entry.width = data.readUInt16LE(3);
        entry.height = data.readUInt16LE(5);
      }
      characters.set(id, entry);
    } else if (code === 76) {
      symbols.push(...readSymbolList(data, "SymbolClass"));
    } else if (code === 56) {
      symbols.push(...readSymbolList(data, "ExportAssets"));
    }
  }

  for (const s of symbols) {
    const c = characters.get(s.id);
    if (!c) continue;
    (c.names ??= []);
    if (!c.names.includes(s.name)) c.names.push(s.name);
  }

  return {
    version,
    compression: sig === "FWS" ? "none" : sig === "CWS" ? "zlib" : "lzma",
    frameSize: rectToPixels(rect),
    frameRate,
    frameCount,
    characters,
    symbols,
    tagCounts,
  };
}
