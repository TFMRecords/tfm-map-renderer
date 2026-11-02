// Deterministic ustar writer + reader for release bundles. Sorted entries, mtime 0, uid/gid 0,
// fixed modes, and a normalized gzip header make identical inputs produce identical bytes on every OS.
import { gzipSync, gunzipSync } from "node:zlib";
import { safeEntryPath } from "./zip.js";

const BLOCK = 512;

function octal(value, length) {
  return value.toString(8).padStart(length - 1, "0") + "\0";
}

function header(name, size) {
  if (Buffer.byteLength(name) > 100) throw new Error(`tar: path too long for ustar name field: ${name}`);
  const h = Buffer.alloc(BLOCK);
  h.write(name, 0, "utf8");
  h.write(octal(0o644, 8), 100, "ascii");
  h.write(octal(0, 8), 108, "ascii");
  h.write(octal(0, 8), 116, "ascii");
  h.write(octal(size, 12), 124, "ascii");
  h.write(octal(0, 12), 136, "ascii");
  h.write("        ", 148, "ascii");
  h.write("0", 156, "ascii");
  h.write("ustar\0", 257, "ascii");
  h.write("00", 263, "ascii");
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += h[i];
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return h;
}

/** @param {Array<{name:string,data:Buffer|string}>} entries */
export function writeTar(entries) {
  const sorted = [...entries].map((e) => ({ name: safeEntryPath(e.name), data: Buffer.from(e.data) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const seen = new Set();
  const parts = [];
  for (const e of sorted) {
    if (seen.has(e.name)) throw new Error(`tar: duplicate entry ${e.name}`);
    seen.add(e.name);
    parts.push(header(e.name, e.data.length), e.data, Buffer.alloc((BLOCK - (e.data.length % BLOCK)) % BLOCK));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}

export function readTar(buf) {
  const out = new Map();
  let off = 0;
  while (off + BLOCK <= buf.length) {
    const h = buf.subarray(off, off + BLOCK);
    if (h.every((b) => b === 0)) break;
    const nameEnd = h.indexOf(0);
    const name = safeEntryPath(h.toString("utf8", 0, nameEnd < 0 || nameEnd > 100 ? 100 : nameEnd));
    const size = parseInt(h.toString("ascii", 124, 136).replace(/\0.*$/, "").trim() || "0", 8);
    const type = String.fromCharCode(h[156] || 48);
    off += BLOCK;
    if (type === "0") out.set(name, Buffer.from(buf.subarray(off, off + size)));
    off += Math.ceil(size / BLOCK) * BLOCK;
  }
  return out;
}

export function gzipDeterministic(buf) {
  const gz = gzipSync(buf, { level: 9 });
  gz[4] = gz[5] = gz[6] = gz[7] = 0; // mtime
  gz[8] = 2; // XFL: max compression
  gz[9] = 3; // OS: Unix, regardless of the host platform
  return gz;
}

export const gunzip = (buf) => gunzipSync(buf);
