import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { packBundle, writeBundleDirectory } from "../src/assets/bundle.js";
import { loadAssetBundle, loadAssetBundleOrNull, normalizeAssetLocation, githubReleaseUrl, AssetSourceError } from "../src/assets/source.js";
import { createBundleResolver } from "../src/assets/bundle-resolver.js";
import { parseTfmMap, renderTfmSvg } from "../src/index.js";

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
const SHAPE = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="20" height="40" viewBox="-10 -20 20 40"><rect x="-10" y="-20" width="20" height="40" fill="#f00"/></svg>\n`;

function sampleFiles() {
  const manifest = {
    format: "tfm-assets", version: 1,
    source: { swf: { name: "t.swf", sha256: "a".repeat(64), size: 1, swfVersion: 10, stage: { width: 800, height: 600 }, compression: "none" }, ffdec: { version: "0" }, extractor: { version: "0" } },
    assets: {
      1: { id: 1, kind: "shape", names: ["Marker"], frames: [{ file: "shapes/1.svg", width: 20, height: 40, origin: { x: 10, y: 20 } }] },
      4: { id: 4, kind: "image", names: ["tex.png"], file: "images/tex.png", width: 1, height: 1 },
    },
    symbols: { Marker: 1, "tex.png": 4 }, bindings: {}, warnings: [],
  };
  return new Map([["manifest.json", Buffer.from(JSON.stringify(manifest))], ["shapes/1.svg", Buffer.from(SHAPE)], ["images/tex.png", PNG_1X1]]);
}

// Minimal ZIP writer (stored entries) so the zip path can be tested without a dependency.
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const byte of buf) { c = (crc ^ byte) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name), crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data); centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cen = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cen.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cen, end]);
}
const fakeFetch = (bodies, log = []) => async (url) => {
  log.push(url);
  const body = bodies[url];
  return body ? { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) } : { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
};

test("asset locations are configuration: paths, URLs and GitHub releases normalize to one shape", () => {
  assert.deepEqual(normalizeAssetLocation("https://example.org/a.zip"), { type: "url", url: "https://example.org/a.zip" });
  assert.deepEqual(normalizeAssetLocation("./assets"), { type: "path", path: "./assets" });
  assert.deepEqual(normalizeAssetLocation({ type: "directory", path: "x" }), { type: "path", path: "x" });
  assert.equal(normalizeAssetLocation({ type: "github-release", repo: "o/r", asset: "a.tar.gz" }).url, "https://github.com/o/r/releases/latest/download/a.tar.gz");
  assert.equal(githubReleaseUrl({ repo: "o/r", tag: "v1", asset: "a b.zip" }), "https://github.com/o/r/releases/download/v1/a%20b.zip");
  assert.throws(() => normalizeAssetLocation({ type: "github-release", repo: "nope", asset: "a" }), AssetSourceError);
  assert.throws(() => normalizeAssetLocation({ type: "ftp" }), AssetSourceError);
});

test("a bundle loads from a directory, a tar.gz, a zip (with or without a root folder) and a URL", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tfm-src-"));
  try {
    const files = sampleFiles();
    await writeBundleDirectory(path.join(dir, "bundle"), files);
    const tgz = packBundle(files).data;
    await writeFile(path.join(dir, "b.tar.gz"), tgz);
    const flat = zip([...files]);
    const rooted = zip([...files].map(([k, v]) => [`tfm-assets/${k}`, v]));
    await writeFile(path.join(dir, "b.zip"), flat);

    const sources = [path.join(dir, "bundle"), path.join(dir, "b.tar.gz"), path.join(dir, "b.zip")];
    for (const src of sources) assert.ok((await loadAssetBundle(src)).has("Marker"), src);

    const urls = { "https://e.org/flat.zip": flat, "https://e.org/rooted.zip": rooted, "https://e.org/b.tar.gz": tgz };
    for (const url of Object.keys(urls)) assert.ok((await loadAssetBundle(url, { fetch: fakeFetch(urls) })).has("tex.png"), url);
    const gh = await loadAssetBundle({ type: "github-release", repo: "o/r", tag: "v1", asset: "b.zip" }, { fetch: fakeFetch({ "https://github.com/o/r/releases/download/v1/b.zip": flat }) });
    assert.ok(gh.has("Marker"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("downloads are cached, verified by sha256, and a failed source degrades to null instead of throwing", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tfm-src-"));
  try {
    const tgz = packBundle(sampleFiles()).data;
    const sha = createHash("sha256").update(tgz).digest("hex");
    const log = [];
    const loc = { type: "url", url: "https://e.org/b.tar.gz", sha256: sha };
    await loadAssetBundle(loc, { fetch: fakeFetch({ [loc.url]: tgz }, log), cacheDir: dir });
    const offline = await loadAssetBundle(loc, { fetch: async () => { throw new Error("offline"); }, cacheDir: dir, refresh: true });
    assert.ok(offline.has("Marker"), "falls back to the cached archive when the network fails");
    await loadAssetBundle(loc, { fetch: async () => { throw new Error("must not be called"); }, cacheDir: dir });
    assert.equal(log.length, 1);

    await assert.rejects(loadAssetBundle({ ...loc, sha256: "0".repeat(64) }, { fetch: fakeFetch({ [loc.url]: tgz }) }), /sha256 mismatch/);
    const errors = [];
    assert.equal(await loadAssetBundleOrNull("https://e.org/missing.zip", { fetch: fakeFetch({}), onError: (e) => errors.push(e.message) }), null);
    assert.match(errors[0], /404/);
    assert.equal(await loadAssetBundleOrNull(path.join(dir, "nope")), null);
    await assert.rejects(loadAssetBundle("https://e.org/junk", { fetch: fakeFetch({ "https://e.org/junk": Buffer.from("hello") }) }), /neither tar.gz nor zip/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("the bundle resolver feeds the SVG renderer; unknown keys fall back to placeholders", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tfm-src-"));
  try {
    await writeFile(path.join(dir, "b.tar.gz"), packBundle(sampleFiles()).data);
    const resolver = createBundleResolver(await loadAssetBundle(path.join(dir, "b.tar.gz")));
    const image = resolver.resolve({ source: "tex.png" });
    assert.match(image.href, /^data:image\/png;base64,/);
    const vector = resolver.resolve({ key: "Marker" });
    assert.deepEqual([vector.width, vector.height, vector.origin], [20, 40, { x: 10, y: 20 }]);
    assert.equal(resolver.resolve({ source: "nothing.png" }), null);

    const map = parseTfmMap(`<C><P D="tex.png,5,6"/><Z><S><S T="0" X="10" Y="10" L="20" H="20" P="0,0,0.3,0.2,0,0,0,0"/></S><D/><O/></Z></C>`);
    assert.match(renderTfmSvg(map, { assetResolver: resolver }), /<image href="data:image\/png;base64,[^"]+" x="5" y="6"/);
    assert.match(renderTfmSvg(map, { assetResolver: createBundleResolver(await loadAssetBundle(path.join(dir, "b.tar.gz"))), defaultAssets: true }), /<rect/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
