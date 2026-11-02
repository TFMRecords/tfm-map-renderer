// Minimal ABC (ActionScript 3 bytecode) file parser: constant pool, methods, classes, traits and method bodies.
// Only what is needed to read and emulate the Transformice.swf loader script (see unwrap.js).

class AbcReader {
  constructor(buf, pos = 0) {
    this.buf = buf;
    this.pos = pos;
  }
  u8() { return this.buf[this.pos++]; }
  u16() { const v = this.buf.readUInt16LE(this.pos); this.pos += 2; return v; }
  u30() {
    let result = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      const b = this.buf[this.pos++];
      result |= (b & 0x7f) << shift;
      if (!(b & 0x80)) break;
    }
    return result >>> 0;
  }
  s32() {
    let result = 0;
    let shift = 0;
    let b;
    do {
      b = this.buf[this.pos++];
      result |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80 && shift < 35);
    return result | 0;
  }
  d64() { const v = this.buf.readDoubleLE(this.pos); this.pos += 8; return v; }
  str() { const n = this.u30(); const s = this.buf.toString("utf8", this.pos, this.pos + n); this.pos += n; return s; }
}

function readTraits(r) {
  const traits = [];
  const count = r.u30();
  for (let i = 0; i < count; i++) {
    const name = r.u30();
    const kindByte = r.u8();
    const kind = kindByte & 0x0f;
    const attrs = kindByte >> 4;
    const trait = { name, kind };
    if (kind === 0 || kind === 6) {
      trait.slotId = r.u30();
      trait.type = r.u30();
      trait.vindex = r.u30();
      if (trait.vindex) trait.vkind = r.u8();
    } else if (kind === 4 || kind === 5) {
      trait.slotId = r.u30();
      trait.target = r.u30();
    } else if (kind >= 1 && kind <= 3) {
      r.u30();
      trait.method = r.u30();
    } else {
      throw new Error(`ABC: unknown trait kind ${kind}`);
    }
    if (attrs & 0x4) { const n = r.u30(); for (let k = 0; k < n; k++) r.u30(); }
    traits.push(trait);
  }
  return traits;
}

/**
 * @param {Buffer} buf raw ABC bytes (the part of a DoABC tag after the flags and name)
 * @returns {{strings:string[],multinames:object[],methods:object[],instances:object[],classes:object[],scripts:object[],bodies:Map<number,object>}}
 */
export function parseAbc(buf) {
  const r = new AbcReader(buf);
  r.u16(); r.u16();
  let n = r.u30(); for (let i = 1; i < n; i++) r.s32();
  n = r.u30(); for (let i = 1; i < n; i++) r.u30();
  n = r.u30(); for (let i = 1; i < n; i++) r.d64();
  n = r.u30();
  const strings = [""];
  for (let i = 1; i < n; i++) strings.push(r.str());
  n = r.u30(); for (let i = 1; i < n; i++) { r.u8(); r.u30(); }
  n = r.u30(); for (let i = 1; i < n; i++) { const c = r.u30(); for (let k = 0; k < c; k++) r.u30(); }
  n = r.u30();
  const multinames = [null];
  for (let i = 1; i < n; i++) {
    const kind = r.u8();
    const mn = { kind, name: undefined, runtimeName: false, runtimeNs: false };
    if (kind === 0x07 || kind === 0x0d) { r.u30(); mn.name = strings[r.u30()]; }
    else if (kind === 0x0f || kind === 0x10) { mn.name = strings[r.u30()]; mn.runtimeNs = true; }
    else if (kind === 0x11 || kind === 0x12) { mn.runtimeName = true; mn.runtimeNs = true; }
    else if (kind === 0x09 || kind === 0x0e) { mn.name = strings[r.u30()]; r.u30(); }
    else if (kind === 0x1b || kind === 0x1c) { r.u30(); mn.runtimeName = true; }
    else if (kind === 0x1d) { mn.name = strings[r.u30()]; const c = r.u30(); for (let k = 0; k < c; k++) r.u30(); }
    else throw new Error(`ABC: unknown multiname kind 0x${kind.toString(16)}`);
    multinames.push(mn);
  }
  n = r.u30();
  const methods = [];
  for (let i = 0; i < n; i++) {
    const paramCount = r.u30();
    r.u30();
    for (let k = 0; k < paramCount; k++) r.u30();
    r.u30();
    const flags = r.u8();
    if (flags & 0x08) { const c = r.u30(); for (let k = 0; k < c; k++) { r.u30(); r.u8(); } }
    if (flags & 0x80) { for (let k = 0; k < paramCount; k++) r.u30(); }
    methods.push({ paramCount, flags });
  }
  n = r.u30();
  for (let i = 0; i < n; i++) { r.u30(); const c = r.u30(); for (let k = 0; k < c * 2; k++) r.u30(); }
  n = r.u30();
  const instances = [];
  for (let i = 0; i < n; i++) {
    const name = multinames[r.u30()].name;
    r.u30();
    const flags = r.u8();
    if (flags & 0x08) r.u30();
    const ic = r.u30(); for (let k = 0; k < ic; k++) r.u30();
    const init = r.u30();
    instances.push({ name, init, traits: readTraits(r) });
  }
  const classes = [];
  for (let i = 0; i < n; i++) classes.push({ init: r.u30(), traits: readTraits(r) });
  const scripts = [];
  const sc = r.u30();
  for (let i = 0; i < sc; i++) scripts.push({ init: r.u30(), traits: readTraits(r) });
  const bodies = new Map();
  const bc = r.u30();
  for (let i = 0; i < bc; i++) {
    const method = r.u30();
    const maxStack = r.u30(); const localCount = r.u30(); r.u30(); r.u30();
    const len = r.u30();
    const code = buf.subarray(r.pos, r.pos + len);
    r.pos += len;
    const ec = r.u30();
    for (let k = 0; k < ec * 5; k++) r.u30();
    readTraits(r);
    bodies.set(method, { method, maxStack, localCount, code });
  }
  return { strings, multinames, methods, instances, classes, scripts, bodies };
}

export { AbcReader };
