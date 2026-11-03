import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import * as b from "../test-support/swf-builder.js";
import { buildRelease, loadRelease, RELEASE_SOURCES, createLayeredResolver, orderBundles, BUNDLE_PRECEDENCE, CLIENT_BUNDLE_PRECEDENCE } from "../src/assets/release.js";
import { AssetBundle } from "../src/assets/bundle.js";

test("a release has one bundle per source and loads back into a layered resolver", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tfm-release-"));
  const swf = b.buildSwf([b.defineShapeRect(1, 0, 0, 100, 100), b.symbolClass([[1, "$F_3"]])], { compress: true });
  const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => swf.buffer.slice(swf.byteOffset, swf.byteOffset + swf.length) });
  // The synthetic SWF is not a loader, so only the plain-SWF sources can be built; extraction is faked (no Java in unit tests).
  const only = RELEASE_SOURCES.filter((s) => !s.embedded).map((s) => s.name);
  const extract = async ({ swfPath }) => {
    assert.ok((await readFile(swfPath)).length > 0);
    return fakeBundle();
  };
  const index = await buildRelease({ outDir: path.join(dir, "out"), workDir: path.join(dir, "work"), only, fetchImpl, extract });
  assert.deepEqual(index.bundles.map((x) => x.name), only);
  const release = await loadRelease(path.join(dir, "out"));
  assert.equal(release.bundles.size, only.length);
  assert.ok(release.resolver.resolve({ key: "$F_3" }));
  assert.equal(release.resolver.resolve({ key: "$Missing" }), null);
});

test("an embedded source that is missing is reported by name", async () => {
  const swf = b.buildSwf([b.defineShapeRect(1, 0, 0, 10, 10)], {});
  const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => swf.buffer.slice(swf.byteOffset, swf.byteOffset + swf.length) });
  await assert.rejects(
    buildRelease({ outDir: "x", workDir: "y", only: ["game-resources"], fetchImpl, extract: async () => fakeBundle() }),
    /DoABC|no embedded SWF/,
  );
});

test("createLayeredResolver asks each bundle in turn", () => {
  const a = new AssetBundle(fakeBundle().files);
  const resolver = createLayeredResolver([a]);
  assert.equal(resolver.resolve({ key: "nothing" }), null);
});

// A genuine (valid) bundle without Java: one shape named $F_3.
function fakeBundle() {
  const files = new Map();
  files.set("svg/shapes/1.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><path d="M0 0H100V100H0Z"/></svg>'));
  const manifest = {
    format: "tfm-assets", version: 1, source: { swf: { name: "x.swf", sha256: "0".repeat(64), size: 1 } }, extractor: { version: "test", ffdec: "test" },
    assets: { 1: { id: 1, kind: "shape", names: ["$F_3"], frames: [{ file: "svg/shapes/1.svg", width: 100, height: 100, origin: { x: 0, y: 0 } }] } },
    symbols: { $F_3: 1 }, warnings: [],
  };
  files.set("manifest.json", Buffer.from(JSON.stringify(manifest)));
  return { manifest, files };
}

test("bundle precedence: the everyday look puts game-fla first, the client code's order puts game-resources first and game-fla last", () => {
  const names = ["pictos", "game-fla", "shaman-items", "game-resources"];
  assert.deepEqual(orderBundles(names, BUNDLE_PRECEDENCE), ["game-fla", "game-resources", "pictos", "shaman-items"]);
  assert.deepEqual(orderBundles(names, CLIENT_BUNDLE_PRECEDENCE), ["game-resources", "shaman-items", "pictos", "game-fla"]);
  assert.deepEqual(orderBundles(["x", "game-fla"], ["game-fla"]), ["game-fla", "x"]);
});

test("loadRelease refuses a release of another format version", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tfm-release-version-"));
  try {
    await writeFile(path.join(dir, "release.json"), JSON.stringify({ format: "tfm-assets-release", version: 99, bundles: [] }));
    await assert.rejects(loadRelease(dir), /format version 99/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a release built from local SWF files records their hashes and the code version", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tfm-release-swfdir-"));
  try {
    const swf = b.buildSwf([b.defineShapeRect(1, 0, 0, 100, 100), b.symbolClass([[1, "$F_3"]])], { compress: true });
    const only = RELEASE_SOURCES.filter((s) => !s.embedded).map((s) => s.name);
    const names = [...new Set(RELEASE_SOURCES.filter((s) => only.includes(s.name)).map((s) => s.swf))];
    await mkdir(path.join(dir, "swfs"));
    for (const name of names) await writeFile(path.join(dir, "swfs", name), swf);
    const fetchImpl = async () => { throw new Error("must not download"); };
    const index = await buildRelease({
      outDir: path.join(dir, "out"), workDir: path.join(dir, "work"), only, fetchImpl, swfDir: path.join(dir, "swfs"),
      code: { ref: "v9.9.9" }, extract: async () => fakeBundle(),
    });
    const sha256 = createHash("sha256").update(swf).digest("hex");
    assert.deepEqual(index.swfs, names.map((name) => ({ name, sha256, bytes: swf.length })));
    assert.deepEqual(index.code, { ref: "v9.9.9" });
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, "out", "release.json"), "utf8")).swfs, index.swfs);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
