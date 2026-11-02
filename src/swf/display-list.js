// Display-list placements of named sprites: what FFDec's SVG export leaves out.
//
// FFDec writes a sprite as nested `<use>` elements but ignores the colour transform of each placed instance and the
// blend modes it has no CSS name for (`add`). Flash applies both when the game draws the clip,
// so `readSpritePlacements` reads them straight from the PlaceObject2/3 tags of the sprite (no code is decoded).

import { readRect, swfBody } from "./reader.js";

class Bits {
  constructor(buf, offset) { this.buf = buf; this.pos = offset * 8; }
  read(n) { let v = 0; for (let i = 0; i < n; i++) { v = (v << 1) | ((this.buf[this.pos >> 3] >> (7 - (this.pos & 7))) & 1); this.pos++; } return v; }
  readSigned(n) { const v = this.read(n); return n > 0 && v & (1 << (n - 1)) ? v - 2 ** n : v; }
  get byteOffset() { return (this.pos + 7) >> 3; }
}

/** Flash `BlendMode` numbers of PlaceObject3 to the CSS `mix-blend-mode` they correspond to (null = none, normal or layer). */
export const BLEND_MODES = Object.freeze({
  1: null, 2: null, 3: "multiply", 4: "screen", 5: "lighten", 6: "darken", 7: "difference", 8: "plus-lighter",
  13: "overlay", 14: "hard-light",
});

function skipMatrix(buf, offset) {
  const bits = new Bits(buf, offset);
  if (bits.read(1)) { const n = bits.read(5); bits.readSigned(n); bits.readSigned(n); }
  if (bits.read(1)) { const n = bits.read(5); bits.readSigned(n); bits.readSigned(n); }
  const n = bits.read(5);
  const tx = bits.readSigned(n);
  const ty = bits.readSigned(n);
  return { end: bits.byteOffset, x: tx / 20, y: ty / 20 };
}

/** CXFORMWITHALPHA as `{mul:[r,g,b,a] (1 = unchanged), add:[r,g,b,a] (0..255 units)}`. */
function readColorTransform(buf, offset) {
  const bits = new Bits(buf, offset);
  const hasAdd = bits.read(1);
  const hasMul = bits.read(1);
  const n = bits.read(4);
  const mul = [1, 1, 1, 1];
  const add = [0, 0, 0, 0];
  if (hasMul) for (let i = 0; i < 4; i++) mul[i] = bits.readSigned(n) / 256;
  if (hasAdd) for (let i = 0; i < 4; i++) add[i] = bits.readSigned(n);
  return { end: bits.byteOffset, mul, add };
}

const fixed16 = (d, p) => d.readInt32LE(p) / 65536;
const fixed8 = (d, p) => d.readInt16LE(p) / 256;
const rgba = (d, p) => ({ r: d[p], g: d[p + 1], b: d[p + 2], a: d[p + 3] / 255 });

/**
 * A SWF FILTERLIST (PlaceObject3), decoded: `[{ kind: "dropShadow"|"blur"|"glow"|"bevel"|"gradientGlow"|"convolution"|"colorMatrix"|"gradientBevel", ... }]`.
 * Blur sizes are in pixels, `strength` is the Flash strength (1 = as is), `passes` the quality (1 low, 3 high). Returns `end`, the offset after the list.
 */
export function decodeFilterList(d, p) {
  const count = d[p++];
  const list = [];
  for (let i = 0; i < count; i++) {
    const id = d[p++];
    if (id === 0) {
      const f = { kind: "dropShadow", color: rgba(d, p), blurX: fixed16(d, p + 4), blurY: fixed16(d, p + 8), angle: fixed16(d, p + 12), distance: fixed16(d, p + 16), strength: fixed8(d, p + 20) };
      const fl = d[p + 22];
      list.push({ ...f, inner: !!(fl & 0x80), knockout: !!(fl & 0x40), compositeSource: !!(fl & 0x20), passes: fl & 0x1f });
      p += 23;
    } else if (id === 1) {
      list.push({ kind: "blur", blurX: fixed16(d, p), blurY: fixed16(d, p + 4), passes: d[p + 8] >> 3 });
      p += 9;
    } else if (id === 2) {
      const fl = d[p + 14];
      list.push({ kind: "glow", color: rgba(d, p), blurX: fixed16(d, p + 4), blurY: fixed16(d, p + 8), strength: fixed8(d, p + 12), inner: !!(fl & 0x80), knockout: !!(fl & 0x40), compositeSource: !!(fl & 0x20), passes: fl & 0x1f });
      p += 15;
    } else if (id === 3) {
      const fl = d[p + 26];
      list.push({ kind: "bevel", shadow: rgba(d, p), highlight: rgba(d, p + 4), blurX: fixed16(d, p + 8), blurY: fixed16(d, p + 12), angle: fixed16(d, p + 16), distance: fixed16(d, p + 20), strength: fixed8(d, p + 24), inner: !!(fl & 0x80), knockout: !!(fl & 0x40), compositeSource: !!(fl & 0x20), onTop: !!(fl & 0x10), passes: fl & 0x0f });
      p += 27;
    } else if (id === 4 || id === 7) {
      const n = d[p++];
      const colors = [];
      for (let k = 0; k < n; k++) colors.push(rgba(d, p + 4 * k));
      p += 4 * n;
      const ratios = [...d.subarray(p, p + n)];
      p += n;
      const fl = d[p + 18];
      list.push({ kind: id === 4 ? "gradientGlow" : "gradientBevel", colors, ratios, blurX: fixed16(d, p), blurY: fixed16(d, p + 4), angle: fixed16(d, p + 8), distance: fixed16(d, p + 12), strength: fixed8(d, p + 16), inner: !!(fl & 0x80), knockout: !!(fl & 0x40), compositeSource: !!(fl & 0x20), onTop: !!(fl & 0x10), passes: fl & 0x0f });
      p += 19;
    } else if (id === 5) {
      const mx = d[p];
      const my = d[p + 1];
      list.push({ kind: "convolution", matrixX: mx, matrixY: my });
      p += 2 + 8 + 4 * mx * my + 4 + 1;
    } else if (id === 6) {
      list.push({ kind: "colorMatrix", values: Array.from({ length: 20 }, (_, k) => d.readFloatLE(p + 4 * k)) });
      p += 80;
    } else return { list, end: p, unknown: id };
  }
  return { list, end: p };
}

function tags(buf, start, end) {
  const out = [];
  let off = start;
  while (off + 2 <= end) {
    const header = buf.readUInt16LE(off);
    const code = header >> 6;
    let length = header & 0x3f;
    off += 2;
    if (length === 0x3f) { length = buf.readUInt32LE(off); off += 4; }
    out.push({ code, data: buf.subarray(off, off + length) });
    off += length;
    if (code === 0) break;
  }
  return out;
}

/** One PlaceObject2 (26) / PlaceObject3 (70) tag that adds a character, or null for any other tag. */
function readPlacement(tag) {
  if (tag.code !== 26 && tag.code !== 70) return null;
  const d = tag.data;
  const flags = d[0];
  const flags2 = tag.code === 70 ? d[1] : 0;
  let p = tag.code === 70 ? 2 : 1;
  const depth = d.readUInt16LE(p);
  p += 2;
  if (tag.code === 70 && flags2 & 0x08) { while (d[p]) p++; p++; } // class name
  if (!(flags & 0x02)) return null; // moves or modifies an existing object, adds no character
  const characterId = d.readUInt16LE(p);
  p += 2;
  const placement = { depth, characterId, x: 0, y: 0, colorTransform: null, blend: null, filters: false, filterList: null, filterBlend: null, name: null };
  if (flags & 0x04) { const m = skipMatrix(d, p); placement.x = m.x; placement.y = m.y; p = m.end; }
  if (flags & 0x08) {
    const c = readColorTransform(d, p);
    p = c.end;
    if (c.mul.some((v) => v !== 1) || c.add.some((v) => v !== 0)) placement.colorTransform = { mul: c.mul, add: c.add };
  }
  if (flags & 0x10) p += 2;
  if (flags & 0x20) { let e = p; while (d[e]) e++; placement.name = d.toString("latin1", p, e); p = e + 1; }
  if (flags & 0x40) p += 2;
  if (tag.code === 70) {
    if (flags2 & 0x01) {
      placement.filters = true;
      const decoded = decodeFilterList(d, p);
      placement.filterList = decoded.list;
      p = decoded.end;
      // The blend mode that follows a filter list stays unread on purpose: such a placement keeps FFDec's own blend (clip-effects.js).
      if (flags2 & 0x02 && decoded.unknown === undefined) placement.filterBlend = d[p];
    } else if (flags2 & 0x02) placement.blend = d[p];
  }
  return placement;
}

/**
 * Placements of the first frame of the named sprites, in depth order.
 * @param {Buffer} swf
 * @param {string[]} names symbol names (SymbolClass), for example `["$T_1", "$Glacon"]`
 * @returns {Map<string, Array<{depth:number, characterId:number, x:number, y:number, blend:number|null, filters:boolean, name:string|null,
 *   colorTransform:{mul:number[], add:number[]}|null}>>}
 */
export function readSpritePlacements(swf, names) {
  const out = new Map();
  for (const [name, tree] of readSpriteTrees(swf, names)) out.set(name, tree.placements);
  return out;
}

const SHAPE_TAGS = new Set([2, 22, 32, 83]);

/** First-frame placements of a DefineSprite body, in depth order. */
function spritePlacements(sprite) {
  const list = [];
  for (const tag of tags(sprite, 4, sprite.length)) {
    if (tag.code === 1) break; // ShowFrame: only the first frame
    const placement = readPlacement(tag);
    if (placement) list.push(placement);
  }
  return list.sort((a, b) => a.depth - b.depth);
}

/**
 * Like `readSpritePlacements`, plus the placements of every sprite nested inside, keyed by the name FFDec gives that sprite in its
 * SVG export (`sprite0`, `sprite1`, ... in order of first use, depth first, counted apart from `shape0`, `shape1`, ...).
 * @returns {Map<string, {placements: Array<object>, nested: Record<string, Array<object>>}>}
 */
export function readSpriteTrees(swf, names) {
  const body = swfBody(swf);
  const { next } = readRect(body, 0);
  const top = tags(body, next + 4, body.length);
  const ids = new Map();
  for (const t of top) {
    if (t.code !== 76) continue;
    const count = t.data.readUInt16LE(0);
    let p = 2;
    for (let i = 0; i < count; i++) {
      const id = t.data.readUInt16LE(p);
      let e = p + 2;
      while (t.data[e]) e++;
      ids.set(t.data.toString("utf8", p + 2, e), id);
      p = e + 1;
    }
  }
  const sprites = new Map();
  const shapes = new Set();
  for (const t of top) {
    if (t.code === 39) sprites.set(t.data.readUInt16LE(0), t.data);
    else if (SHAPE_TAGS.has(t.code)) shapes.add(t.data.readUInt16LE(0));
  }
  const cache = new Map();
  const placementsOf = (id) => {
    if (!cache.has(id)) cache.set(id, spritePlacements(sprites.get(id)));
    return cache.get(id);
  };
  const out = new Map();
  for (const name of names) {
    const root = ids.get(name);
    if (!sprites.has(root)) continue;
    const counters = { sprite: 0, shape: 0 };
    const nested = {};
    // FFDec writes one `<g id="spriteN">` / `<g id="shapeN">` per distinct (character, colour transform, blend, filters, name) among the
    // children of ONE parent, numbering sprites and shapes apart, depth first in order of use. The same character under another parent is
    // exported again under new ids.
    const keyOf = (p) => `${p.characterId}|${JSON.stringify(p.colorTransform)}|${p.blend}|${p.filters}|${p.name}`;
    const visitChildren = (list) => {
      const seen = new Set();
      for (const p of list) {
        const id = p.characterId;
        p.kind = sprites.has(id) ? "sprite" : shapes.has(id) ? "shape" : "other";
        if (p.kind === "other") continue;
        const key = keyOf(p);
        if (seen.has(key)) continue;
        seen.add(key);
        if (p.kind === "sprite") {
          const label = `sprite${counters.sprite++}`;
          nested[label] = placementsOf(id);
          visitChildren(placementsOf(id));
        } else {
          counters.shape++;
        }
      }
    };
    visitChildren(placementsOf(root));
    out.set(name, { placements: placementsOf(root), nested });
  }
  return out;
}
