import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { ensureFfdec, detectJava, runFfdec, idRanges, buildExportArgs, FFDEC_RELEASE, defaultCacheDir } from "../src/assets/ffdec.js";

function crc32(buf) { let c, crc = ~0; for (let i = 0; i < buf.length; i++) { c = (crc ^ buf[i]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function zipOf(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.from(content), comp = deflateRawSync(data), nb = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc32(data), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nb.length, 26);
    locals.push(lh, nb, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc32(data), 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(0o100755 << 16 >>> 0, 38); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nb); offset += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(centrals); const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, e]);
}

const sha = (b) => createHash("sha256").update(b).digest("hex");
const okFetch = (buf) => async () => ({ ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });

test("pinned release metadata is well-formed", () => {
  assert.match(FFDEC_RELEASE.sha256, /^[0-9a-f]{64}$/);
  assert.ok(FFDEC_RELEASE.url.includes(FFDEC_RELEASE.version));
  assert.equal(defaultCacheDir({ TFM_ASSETS_CACHE: "/x" }), "/x");
  assert.equal(defaultCacheDir({ XDG_CACHE_HOME: "/c" }), path.join("/c", "tfm-map-renderer"));
});

test("ensureFfdec downloads, verifies, installs atomically and then reuses the cache", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ffdec-test-"));
  try {
    const zip = zipOf([["ffdec-cli.jar", "JAR"], ["lib/dep.jar", "DEP"]]);
    const release = { version: "9.9.9", url: "https://example.invalid/ffdec.zip", sha256: sha(zip), entry: "ffdec-cli.jar" };
    let calls = 0;
    const fetchImpl = async (...a) => { calls++; return okFetch(zip)(...a); };
    const first = await ensureFfdec({ cacheDir: dir, release, fetchImpl, jar: "" });
    assert.equal(first.installed, true);
    assert.equal(await readFile(first.jar, "utf8"), "JAR");
    assert.equal(await readFile(path.join(path.dirname(first.jar), "lib", "dep.jar"), "utf8"), "DEP");
    const second = await ensureFfdec({ cacheDir: dir, release, fetchImpl, jar: "" });
    assert.equal(second.installed, false);
    assert.equal(calls, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("ensureFfdec refuses a tampered download and leaves nothing installed", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ffdec-test-"));
  try {
    const zip = zipOf([["ffdec-cli.jar", "JAR"]]);
    const release = { version: "9.9.9", url: "x", sha256: "0".repeat(64), entry: "ffdec-cli.jar" };
    await assert.rejects(ensureFfdec({ cacheDir: dir, release, fetchImpl: okFetch(zip), jar: "" }), /checksum mismatch/);
    await assert.rejects(stat(path.join(dir, "ffdec-9.9.9")));
    await assert.rejects(ensureFfdec({ cacheDir: dir, release, fetchImpl: async () => ({ ok: false, status: 503 }), jar: "" }), /HTTP 503/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("ensureFfdec rejects archives that try to escape the install directory", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ffdec-test-"));
  try {
    const zip = zipOf([["../evil.txt", "x"], ["ffdec-cli.jar", "J"]]);
    const release = { version: "9.9.9", url: "x", sha256: sha(zip), entry: "ffdec-cli.jar" };
    await assert.rejects(ensureFfdec({ cacheDir: dir, release, fetchImpl: okFetch(zip), jar: "" }), /unsafe archive path/);
    await assert.rejects(stat(path.join(path.dirname(dir), "evil.txt")));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("an explicit jar path wins and must exist", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ffdec-test-"));
  try {
    const jar = path.join(dir, "my.jar"); await writeFile(jar, "x");
    assert.deepEqual(await ensureFfdec({ jar }), { jar, version: "custom", installed: false });
    await assert.rejects(ensureFfdec({ jar: path.join(dir, "nope.jar") }), /not found/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("detectJava parses modern and legacy version strings and explains a missing runtime", async () => {
  const fake = (stderr) => (file, args, opts, cb) => cb(null, "", stderr);
  assert.equal((await detectJava({ execFileImpl: fake('openjdk version "21.0.10" 2026-01-20') })).major, 21);
  assert.equal((await detectJava({ execFileImpl: fake('java version "1.8.0_391"') })).major, 8);
  await assert.rejects(detectJava({ execFileImpl: (f, a, o, cb) => cb(Object.assign(new Error("ENOENT"), { code: "ENOENT" })) }), /Java runtime not found/);
  await assert.rejects(detectJava({ execFileImpl: fake("garbage") }), /could not parse/);
});

test("runFfdec adds headless flags and surfaces FAIL lines even when the exit code is 0", async () => {
  let seen;
  const good = (f, a, o, cb) => { seen = [f, a]; cb(null, "OK\n", ""); };
  await runFfdec({ jar: "/j.jar", args: ["-export", "shape", "o", "in.swf"], execFileImpl: good });
  assert.deepEqual(seen, ["java", ["-Djava.awt.headless=true", "-jar", "/j.jar", "-export", "shape", "o", "in.swf"]]);
  const failing = (f, a, o, cb) => cb(null, "FAIL: Exporting Failed on Exception\njava.lang.NullPointerException: boom\n", "");
  await assert.rejects(runFfdec({ jar: "j", args: [], execFileImpl: failing }), /reported failure.*NullPointerException/s);
  const crashed = (f, a, o, cb) => cb(Object.assign(new Error("x"), { code: 1, stdout: "SEVERE: bad\n" }), "SEVERE: bad\n", "");
  await assert.rejects(runFfdec({ jar: "j", args: [], execFileImpl: crashed }), /SEVERE: bad/);
});

test("idRanges compacts ids and buildExportArgs avoids the broken -select all form", () => {
  assert.equal(idRanges([7, 1, 2, 3, 3, 9, 10]), "1-3,7,9-10");
  assert.equal(idRanges([]), "");
  const args = buildExportArgs({ swfPath: "in.swf", outDir: "out", selectIds: [1, 2, 3, 8], firstFrameIds: [3, 8] });
  assert.deepEqual(args, ["-format", "shape:svg,sprite:svg,image:png", "-onerror", "ignore", "-selectid", "1-3,8", "-select", "3:1,8:1", "-export", "shape,sprite,image", "out", "in.swf"]);
  assert.ok(!args.join(" ").includes("all:"));
});
