import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { readZip, safeEntryPath } from "../src/util/zip.js";
import { writeTar, readTar, gzipDeterministic, gunzip } from "../src/util/tar.js";

function crc32(buf) {
  let c, crc = ~0;
  for (let i = 0; i < buf.length; i++) { c = (crc ^ buf[i]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; }
  return ~crc >>> 0;
}

function buildZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content, deflate] of files) {
    const data = Buffer.from(content);
    const comp = deflate ? deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6);
    lh.writeUInt16LE(deflate ? 8 : 0, 8); lh.writeUInt32LE(crc32(data), 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8);
    ch.writeUInt16LE(deflate ? 8 : 0, 10); ch.writeUInt32LE(crc32(data), 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

test("zip reader handles stored and deflated entries and directories", () => {
  const zip = buildZip([["dir/", ""], ["dir/a.txt", "hello", false], ["dir/b.txt", "world ".repeat(50), true]]);
  const entries = readZip(zip);
  assert.deepEqual(entries.map((e) => [e.name, e.isDirectory]), [["dir/", true], ["dir/a.txt", false], ["dir/b.txt", false]]);
  assert.equal(entries[1].data().toString(), "hello");
  assert.equal(entries[2].data().toString(), "world ".repeat(50));
  assert.throws(() => readZip(Buffer.from("not a zip at all, definitely")), /central directory/);
});

test("archive paths cannot escape the extraction root", () => {
  assert.equal(safeEntryPath("a/./b//c.txt"), "a/b/c.txt");
  for (const bad of ["../x", "a/../../x", "/etc/passwd", "C:/x", "a\\..\\x"]) assert.throws(() => safeEntryPath(bad), /unsafe/, bad);
});

test("tar round-trips, sorts entries and is byte-deterministic regardless of input order", () => {
  const a = [{ name: "b/2.bin", data: Buffer.from([1, 2, 3]) }, { name: "a.txt", data: "x".repeat(600) }, { name: "manifest.json", data: "{}" }];
  const t1 = writeTar(a);
  const t2 = writeTar([...a].reverse());
  assert.deepEqual(t1, t2);
  assert.equal(t1.length % 512, 0);
  const back = readTar(t1);
  assert.deepEqual([...back.keys()], ["a.txt", "b/2.bin", "manifest.json"]);
  assert.equal(back.get("a.txt").toString(), "x".repeat(600));
  assert.deepEqual(back.get("b/2.bin"), Buffer.from([1, 2, 3]));
  assert.deepEqual(gzipDeterministic(t1), gzipDeterministic(t2));
  assert.deepEqual(gunzip(gzipDeterministic(t1)), t1);
});

test("tar rejects duplicates, unsafe names and over-long names", () => {
  assert.throws(() => writeTar([{ name: "a", data: "1" }, { name: "a", data: "2" }]), /duplicate/);
  assert.throws(() => writeTar([{ name: "../a", data: "1" }]), /unsafe/);
  assert.throws(() => writeTar([{ name: "x".repeat(101), data: "1" }]), /too long/);
});

test("tar produced here is readable by the system tar", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "tarcheck-"));
  const file = join(dir, "t.tar");
  writeFileSync(file, writeTar([{ name: "m.json", data: '{"ok":true}' }, { name: "svg/a.svg", data: "<svg/>" }]));
  let listing;
  try { listing = execFileSync("tar", ["-tf", file]).toString().trim().split("\n"); } catch { return; /* no system tar */ }
  assert.deepEqual(listing, ["m.json", "svg/a.svg"]);
  void readFileSync;
});
