// Read-only ZIP support (stored + deflate, no ZIP64, no encryption). Used to unpack the FFDec release.
import { inflateRawSync } from "node:zlib";

const EOCD = 0x06054b50;
const CEN = 0x02014b50;
const LOC = 0x04034b50;

/** @returns {Array<{name:string,isDirectory:boolean,data:()=>Buffer,mode:number}>} */
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("zip: end of central directory not found");
  const total = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || off === 0xffffffff) throw new Error("zip: ZIP64 archives are not supported");
  const entries = [];
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(off) !== CEN) throw new Error("zip: bad central directory entry");
    const flags = buf.readUInt16LE(off + 8);
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const usize = buf.readUInt32LE(off + 24);
    const nlen = buf.readUInt16LE(off + 28);
    const elen = buf.readUInt16LE(off + 30);
    const clen = buf.readUInt16LE(off + 32);
    const attrs = buf.readUInt32LE(off + 38);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.toString(flags & 0x800 ? "utf8" : "latin1", off + 46, off + 46 + nlen);
    off += 46 + nlen + elen + clen;
    if (flags & 1) throw new Error(`zip: encrypted entry ${name}`);
    entries.push({
      name,
      isDirectory: name.endsWith("/"),
      mode: (attrs >>> 16) & 0o7777,
      data() {
        if (buf.readUInt32LE(lho) !== LOC) throw new Error(`zip: bad local header for ${name}`);
        const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
        const raw = buf.subarray(start, start + csize);
        const out = method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null;
        if (!out) throw new Error(`zip: unsupported compression method ${method} for ${name}`);
        if (out.length !== usize) throw new Error(`zip: size mismatch for ${name}`);
        return out;
      },
    });
  }
  return entries;
}

/** Reject entries that would escape the extraction root. */
export function safeEntryPath(name) {
  const parts = name.replace(/\\/g, "/").split("/").filter((p) => p !== "" && p !== ".");
  if (parts.some((p) => p === "..") || /^[a-zA-Z]:/.test(parts[0] ?? "") || name.startsWith("/")) {
    throw new Error(`unsafe archive path: ${name}`);
  }
  return parts.join("/");
}
